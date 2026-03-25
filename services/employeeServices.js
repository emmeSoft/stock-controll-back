const prisma = require(`../db/database.prisma`);
const bcrypt = require('bcrypt');
// Roles nuevos: SISTEMA, ADMINISTRADOR, ENCARGADO, VENDEDOR
const ALLOWED_ROLES = ["SISTEMA", "ADMINISTRADOR", "ENCARGADO", "VENDEDOR"];
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");

const verifySudoMode = (req) => {
    if (!req.cookies || req.cookies.sudo !== 'true') {
        throw new Error("Acción bloqueada. Se requiere validación reciente de contraseña (Sudo Mode).");
    }
    return true;
};

const create = async (dataEmployee, user) => {
    console.log('Creando Empleado...');

    // 0. Verificar si el email ya existe para evitar error de constraint
    const existingEmail = await prisma.user.findUnique({ where: { email: dataEmployee.email } });
    if (existingEmail) {
        throw new Error(`El email "${dataEmployee.email}" ya está registrado en el sistema.`);
    }
    
    // Un ADMINISTRADOR no puede crear un SISTEMA
    if (user.role === 'ADMINISTRADOR' && dataEmployee.role === 'SISTEMA') {
        throw new Error('No tienes permisos para crear un usuario de nivel SISTEMA.');
    }

    // Si se crea un ADMINISTRADOR o SISTEMA, verificar Sudo Mode
    if (dataEmployee.role === 'ADMINISTRADOR' || dataEmployee.role === 'SISTEMA') {
        verifySudoMode(user.req); // Pasamos req para chequear cookies
    }
    
    // Ya validada la autoridad, quitamos el adminPassword del body si venía
    delete dataEmployee.adminPassword;

    // El empleado se asigna a la tienda del creador (a menos que el creador sea SISTEMA y haya especificado storeId explicitamente)
    // El middleware authMiddleware inyecta el x-store-id en user.storeId temporalmente si es "SISTEMA"
    let assignedStoreId = user.storeId;
    if (user.role === 'SISTEMA' && dataEmployee.storeId) {
        assignedStoreId = dataEmployee.storeId;
    }

    // SISTEMA puede no tener tienda asignada (es global)
    // Pero si está creando un usuario que no sea SISTEMA, necesita tienda
    if (!assignedStoreId && dataEmployee.role !== 'SISTEMA') {
       throw new Error('Debe seleccionar una tienda para asignar al empleado.');
    }

    // Generar un PIN aleatorio de 4 dígitos
    const tempPin = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedPassword = await bcrypt.hash(tempPin, 10);

    // No tomamos `dataEmployee.password` enviado por frontend (se ignorará si lo mandan)
    delete dataEmployee.password;

    const response = await prisma.user.create({ 
        data: { 
            ...dataEmployee, 
            password: hashedPassword, 
            mustChangePassword: true,
            storeId: assignedStoreId 
        } 
    });
    
    return { ...response, generatedPin: tempPin }; // Regla Negocio: Retorna solo en tiempo de req
}

const getAll = async (user) => {
    console.log('Trayendo todos los empleados...', user);
    // SISTEMA puede ver todos los usuarios de todas las tiendas
    // Si hay override de tienda (isGlobalOverride), filtrar por esa tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const canSeeAll = isSistema && !user.isGlobalOverride;
    
    console.log('isSistema:', isSistema, 'isGlobalOverride:', user.isGlobalOverride, 'canSeeAll:', canSeeAll);
    
    const whereClause = canSeeAll ? {} : { storeId: user.storeId };
    const response = await prisma.user.findMany({ where: whereClause });
    console.log('Empleados Cargados:', response.length);
    return response;
}

const getById = async (id, user) => {
    console.log(`Trayendo empleado con ID: ${id}`);
    // SISTEMA puede ver cualquier usuario
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const whereClause = isSistema ? { id: id } : { id: id, storeId: user.storeId };
    const response = await prisma.user.findFirst({
        where: whereClause,
        include: {
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
    console.log('Empleado encontrado:');
    return response;
}

const update = async (id, dataEmployee, user) => {
    console.log(`actualizando empleado con ID: ${id}`);

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.user.findFirst({ where: whereClause });
    if (!existing) throw new Error("Empleado no encontrado o denegado");
    
    // Un ADMINISTRADOR no puede promoverse o promover a alguien a SISTEMA
    if (user.role === 'ADMINISTRADOR' && dataEmployee.role === 'SISTEMA') {
        throw new Error('No tienes permisos para otorgar nivel SISTEMA.');
    }

    if (dataEmployee.role && dataEmployee.role !== existing.role) {
        await verifyAdminPassword(user.id, dataEmployee.adminPassword);
    }

    const allowedFields = [
        "name",
        "fullName",
        "firstName",
        "lastName",
        "email",
        "password",
        "phoneNumber",
        "address",
        "city",
        "dni",
        "cuit",
        "description",
        "price",
        "stock",
        "profilePicture",
        "isActive",

    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataEmployee).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined && value !== ""
        )
    );

    if ("role" in cleanData) {
        if (!ALLOWED_ROLES.includes(cleanData.role)) {
            throw new Error("Rol inválido");
        }
    }

    // Hash password if updating
    if (cleanData.password) {
        cleanData.password = await bcrypt.hash(cleanData.password, 10);
    }

    if ("dni" in cleanData) {
        const normalized = normalizeDni(cleanData.dni);

        if (!isValidDni(normalized)) {
            throw new Error("DNI inválido");
        }

        cleanData.dni = normalized;
    }

    if ("email" in cleanData) {
        const normalized = normalizeEmail(cleanData.email);

        if (!isValidEmail(normalized)) {
            throw new Error("Email inválido");
        }

        // Verificar si el nuevo email ya lo tiene otro usuario
        const emailConflict = await prisma.user.findFirst({
            where: {
                email: normalized,
                NOT: { id: id }
            }
        });
        if (emailConflict) {
            throw new Error(`El email "${normalized}" ya está siendo utilizado por otro empleado.`);
        }

        cleanData.email = normalized;
    }

    if ("cuit" in cleanData) {
        const normalized = normalizeCuit(cleanData.cuit);

        if (!isValidCuit(normalized)) {
            throw new Error("CUIT inválido");
        }

        cleanData.cuit = normalized;
    }

    if ("phoneNumber" in cleanData) {
        const normalized = normalizeArPhone(cleanData.phoneNumber);

        if (!isValidArPhone(normalized)) {
            throw new Error("Número de teléfono inválido");
        }

    }

    const response = await prisma.user.update({
        where: { id: id },
        data: cleanData
    });
    console.log('Empleado Actualizado:');
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Habilitando" : "Deshabilitando"} empleado con ID: ${id}`);
    
    // 1. Verificar Sudo Mode en lugar de contraseña en el body
    verifySudoMode(user.req);
    
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.user.findFirst({ where: whereClause });
    if (!existing) throw new Error("Empleado no encontrado o denegado");

    const response = await prisma.user.update({
        where: { id },
        data: { isActive }
    });

    console.log(`Empleado ${isActive ? "habilitado" : "deshabilitado"}`);

    return response;
}
const resetPassword = async (employeeId, adminUser) => {
    // 1. Verificar Sudo Mode
    verifySudoMode(adminUser.req);

    // 2. Buscar al empleado a blanquear
    const isAdminSistema = adminUser.role === 'SISTEMA' || adminUser.isSistema;
    const whereClause = isAdminSistema ? { id: employeeId } : { id: employeeId, storeId: adminUser.storeId };
    const employeeRecord = await prisma.user.findFirst({ where: whereClause });
    if (!employeeRecord) throw new Error("Empleado no encontrado o no pertenece a tu tienda.");

    // No se puede blanquear un SISTEMA por este medio (solo el propio SISTEMA puede)
    if (employeeRecord.role === 'SISTEMA' && !isAdminSistema) {
        throw new Error("No tienes permisos para blanquear la clave de un usuario SISTEMA.");
    }

    // 3. Generar nuevo PIN y actualizar
    const newTempPin = Math.floor(1000 + Math.random() * 9000).toString();
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
