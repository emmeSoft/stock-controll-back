const prisma = require(`../db/database.prisma`);
const bcrypt = require('bcrypt');
const crypto = require('crypto');
// Roles nuevos: SISTEMA, ADMINISTRADOR, ENCARGADO, VENDEDOR
const ALLOWED_ROLES = ["SISTEMA", "ADMINISTRADOR", "ENCARGADO", "VENDEDOR"];
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");

const verifySudoMode = (req) => {
    if (!req.cookies || req.cookies.sudo !== 'true') {
        throw new Error("Acción bloqueada. Se requiere validación reciente de contraseña (Sudo Mode).");
    }
    return true;
};

const getRoleName = (roleValue) => {
    if (!roleValue) return null;
    if (typeof roleValue === 'string') return roleValue;
    return roleValue.name || null;
};

const getActorRole = (user) => getRoleName(user?.rbacRole) || user?.role;

const assertAllowedRole = (roleName) => {
    if (!ALLOWED_ROLES.includes(roleName)) {
        throw new Error('Rol inválido');
    }

    return roleName;
};

const resolveRole = async (roleName) => {
    const normalizedRole = assertAllowedRole(roleName);
    const roleRecord = await prisma.role.findUnique({ where: { name: normalizedRole } });

    if (!roleRecord) {
        throw new Error(`No existe el rol RBAC "${normalizedRole}" configurado en la base de datos.`);
    }

    return roleRecord;
};

const mapUserResponse = (userRecord) => {
    if (!userRecord) return userRecord;

    const { password, ...userWithoutPassword } = userRecord;

    return {
        ...userWithoutPassword,
        password: "HIDDEN", // Placeholder para que el frontend renderice el botón de blanqueo sin exponer el hash
        role: getRoleName(userRecord.rbacRole) || userRecord.role || null
    };
};

const normalizeUserData = async (dataEmployee, { keepEmptyStrings = false } = {}) => {
    const allowedFields = [
        'name',
        'fullName',
        'firstName',
        'lastName',
        'email',
        'password',
        'phoneNumber',
        'address',
        'city',
        'dni',
        'cuit',
        'description',
        'price',
        'stock',
        'profilePicture',
        'isActive'
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataEmployee).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined && (keepEmptyStrings || value !== '')
        )
    );

    if ('dni' in cleanData) {
        const normalized = normalizeDni(cleanData.dni);

        if (!isValidDni(normalized)) {
            throw new Error('DNI inválido');
        }

        cleanData.dni = normalized;
    }

    if ('email' in cleanData) {
        const normalized = normalizeEmail(cleanData.email);

        if (!isValidEmail(normalized)) {
            throw new Error('Email inválido');
        }

        cleanData.email = normalized;
    }

    if ('cuit' in cleanData) {
        const normalized = normalizeCuit(cleanData.cuit);

        if (!isValidCuit(normalized)) {
            throw new Error('CUIT inválido');
        }

        cleanData.cuit = normalized;
    }

    if ('phoneNumber' in cleanData) {
        const normalized = normalizeArPhone(cleanData.phoneNumber);

        if (!isValidArPhone(normalized)) {
            throw new Error('Número de teléfono inválido');
        }

        cleanData.phoneNumber = normalized;
    }

    return cleanData;
};

const ensureAdminPinAuthority = (user) => {
    const actorRole = getActorRole(user);

    if (actorRole !== 'SISTEMA' && actorRole !== 'ADMINISTRADOR') {
        throw new Error('Solo SISTEMA o ADMINISTRADOR pueden crear usuarios o blanquear claves.');
    }
};

const generateTemporaryPin = () => crypto.randomInt(1000, 10000).toString();

const create = async (dataEmployee, user) => {
    ensureAdminPinAuthority(user);

    const requestedRoleName = assertAllowedRole(dataEmployee.role);
    const targetRole = await resolveRole(requestedRoleName);
    const cleanData = await normalizeUserData(dataEmployee);

    // 0. Verificar si el email ya existe para evitar error de constraint
    const existingEmail = await prisma.user.findUnique({ where: { email: cleanData.email } });
    if (existingEmail) {
        throw new Error(`El email "${cleanData.email}" ya está registrado en el sistema.`);
    }
    
    // Un ADMINISTRADOR no puede crear un SISTEMA
    if (getActorRole(user) === 'ADMINISTRADOR' && requestedRoleName === 'SISTEMA') {
        throw new Error('No tienes permisos para crear un usuario de nivel SISTEMA.');
    }

    // Si se crea un ADMINISTRADOR o SISTEMA, verificar Sudo Mode
    if (requestedRoleName === 'ADMINISTRADOR' || requestedRoleName === 'SISTEMA') {
        verifySudoMode(user.req); // Pasamos req para chequear cookies
    }
    
    // Ya validada la autoridad, quitamos el adminPassword del body si venía
    delete dataEmployee.adminPassword;

    // El empleado se asigna a la tienda del creador (a menos que el creador sea SISTEMA y haya especificado storeId explicitamente)
    // El middleware authMiddleware inyecta el x-store-id en user.storeId temporalmente si es "SISTEMA"
    let assignedStoreId = user.storeId;
    if (getActorRole(user) === 'SISTEMA' && dataEmployee.storeId) {
        assignedStoreId = dataEmployee.storeId;
    }

    // SISTEMA puede no tener tienda asignada (es global)
    // Pero si está creando un usuario que no sea SISTEMA, necesita tienda
    if (!assignedStoreId && requestedRoleName !== 'SISTEMA') {
       throw new Error('Debe seleccionar una tienda para asignar al empleado.');
    }

    // Generar un PIN aleatorio de 4 dígitos
    const tempPin = generateTemporaryPin();
    const hashedPassword = await bcrypt.hash(tempPin, 10);

    // No tomamos `dataEmployee.password` enviado por frontend (se ignorará si lo mandan)
    delete dataEmployee.password;

    const response = await prisma.user.create({ 
        data: { 
            ...cleanData,
            password: hashedPassword, 
            mustChangePassword: true,
            store: assignedStoreId ? { connect: { id: assignedStoreId } } : undefined,
            roleId: targetRole.id
        },
        include: { rbacRole: true, Image: true }
    });
    
    return { ...mapUserResponse(response), generatedPin: tempPin }; // Regla Negocio: Retorna solo en tiempo de req
}

const getAll = async (user) => {
    // SISTEMA puede ver todos los usuarios de todas las tiendas
    // Si hay override de tienda (isGlobalOverride), filtrar por esa tienda
    const isSistema = getActorRole(user) === 'SISTEMA' || user.isSistema;
    const canSeeAll = isSistema && !user.isGlobalOverride;
    
    
    const whereClause = canSeeAll ? {} : { storeId: user.storeId };
    const response = await prisma.user.findMany({
        where: whereClause,
        include: { rbacRole: true }
    });
    return response.map(mapUserResponse);
}

const getById = async (id, user) => {
    // SISTEMA puede ver cualquier usuario
    const isSistema = getActorRole(user) === 'SISTEMA' || user.isSistema;
    const whereClause = isSistema ? { id: id } : { id: id, storeId: user.storeId };
    const response = await prisma.user.findFirst({
        where: whereClause,
        include: {
            rbacRole: true,
            Image: {
                orderBy: {
                    order: "asc" // 👈 orden visual correcto
                }
            }
        }
    });
    if (!response) {
        throw new Error(`Empleado con ID ${id} no encontrado`);
    }
    return mapUserResponse(response);
}

const update = async (id, dataEmployee, user) => {

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.user.findFirst({
        where: whereClause,
        include: { rbacRole: true }
    });
    if (!existing) throw new Error("Empleado no encontrado o denegado");

    const requestedRoleName = dataEmployee.role ? assertAllowedRole(dataEmployee.role) : null;
    const currentRoleName = getRoleName(existing.rbacRole);
    
    // Un ADMINISTRADOR no puede promoverse o promover a alguien a SISTEMA
    if (getActorRole(user) === 'ADMINISTRADOR' && requestedRoleName === 'SISTEMA') {
        throw new Error('No tienes permisos para otorgar nivel SISTEMA.');
    }

    if (requestedRoleName && requestedRoleName !== currentRoleName) {
        verifySudoMode(user.req);
    }

    const cleanData = await normalizeUserData(dataEmployee);

    // Hash password if updating
    if (cleanData.password) {
        cleanData.password = await bcrypt.hash(cleanData.password, 10);
    }

    if ("email" in cleanData) {
        // Verificar si el nuevo email ya lo tiene otro usuario
        const emailConflict = await prisma.user.findFirst({
            where: {
                email: cleanData.email,
                NOT: { id: id }
            }
        });
        if (emailConflict) {
            throw new Error(`El email "${cleanData.email}" ya está siendo utilizado por otro empleado.`);
        }
    }

    if (requestedRoleName) {
        const targetRole = await resolveRole(requestedRoleName);
        cleanData.roleId = targetRole.id;
    }

    const response = await prisma.user.update({
        where: { id: id },
        data: cleanData,
        include: { rbacRole: true, Image: true }
    });
    return mapUserResponse(response);
}

const setActiveStatus = async (id, isActive, user) => {
    
    // 1. Verificar Sudo Mode en lugar de contraseña en el body
    verifySudoMode(user.req);
    
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.user.findFirst({ where: whereClause });
    if (!existing) throw new Error("Empleado no encontrado o denegado");

    const response = await prisma.user.update({
        where: { id },
        data: { isActive }
    });


    return response;
}
const resetPassword = async (employeeId, adminUser) => {
    ensureAdminPinAuthority(adminUser);

    // 1. Verificar Sudo Mode
    verifySudoMode(adminUser.req);

    // 2. Buscar al empleado a blanquear
    const isAdminSistema = getActorRole(adminUser) === 'SISTEMA' || adminUser.isSistema;
    const whereClause = isAdminSistema ? { id: employeeId } : { id: employeeId, storeId: adminUser.storeId };
    const employeeRecord = await prisma.user.findFirst({
        where: whereClause,
        include: { rbacRole: true }
    });
    if (!employeeRecord) throw new Error("Empleado no encontrado o no pertenece a tu tienda.");

    // No se puede blanquear un SISTEMA por este medio (solo el propio SISTEMA puede)
    if (employeeRecord.rbacRole?.name === 'SISTEMA' && !isAdminSistema) {
        throw new Error("No tienes permisos para blanquear la clave de un usuario SISTEMA.");
    }

    // 3. Generar nuevo PIN y actualizar
    const newTempPin = generateTemporaryPin();
    const hashedPassword = await bcrypt.hash(newTempPin, 10);

    const updatedEmployee = await prisma.user.update({
        where: { id: employeeId },
        data: {
            password: hashedPassword,
            mustChangePassword: true
        }
    });

    return { 
        message: "Clave blanqueada exitosamente.", 
        newPin: newTempPin,
        employeeEmail: updatedEmployee.email 
    };
};

module.exports = { create, getAll, getById, update, setActiveStatus, resetPassword };
