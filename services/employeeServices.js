const prisma = require(`../db/database.prisma`);
const bcrypt = require('bcrypt');
const ALLOWED_ROLES = ["SUPERADMIN", "ADMIN", "USUARIO"];
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");

const verifyAdminPassword = async (adminId, adminPassword) => {
    if (!adminPassword) throw new Error("La contraseña del administrador es requerida.");
    const adminRecord = await prisma.user.findUnique({ where: { id: adminId } });
    if (!adminRecord) throw new Error("Administrador no encontrado");

    const isAdminPasswordValid = await bcrypt.compare(adminPassword, adminRecord.password);
    if (!isAdminPasswordValid) throw new Error("Contraseña de administrador incorrecta. Autorización denegada.");
    return true;
};

const create = async (dataEmployee, user) => {
    console.log('Creando Empleado...');
    
    // Un ADMIN no puede crear un SUPERADMIN
    if (user.role === 'ADMIN' && dataEmployee.role === 'SUPERADMIN') {
        throw new Error('No tienes permisos para crear un usuario de nivel SUPERADMIN.');
    }

    // Si se crea un ADMIN o SUPERADMIN, verificar contraseña del creador
    if (dataEmployee.role === 'ADMIN' || dataEmployee.role === 'SUPERADMIN') {
        await verifyAdminPassword(user.id, dataEmployee.adminPassword);
    }
    // Ya validada, quitamos el adminPassword para que no interfiera
    delete dataEmployee.adminPassword;

    // El empleado se asigna a la tienda del creador (a menos que el creador sea un SUPERADMIN y haya especificado storeId explicitamente)
    // El middleware authMiddleware inyecta el x-store-id en user.storeId temporalmente si es "SUPERADMIN"
    let assignedStoreId = user.storeId;
    if (user.role === 'SUPERADMIN' && dataEmployee.storeId) {
        assignedStoreId = dataEmployee.storeId;
    }

    if (!assignedStoreId) {
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
            tempPassword: tempPin,
            mustChangePassword: true,
            storeId: assignedStoreId 
        } 
    });
    console.log(`Empleado creado con PIN temporal: ${tempPin}`);
    return { ...response, generatedPin: tempPin }; // Retornamos el PIN para que el frontend lo vea
}

const getAll = async (user) => {
    console.log('Trayendo todos los empleados...');
    const whereClause = user.storeId ? { storeId: user.storeId } : {};
    const response = await prisma.user.findMany({ where: whereClause });
    console.log('Empleados Cargados:');
    return response;
}

const getById = async (id, user) => {
    console.log(`Trayendo empleado con ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
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
    
    // Un ADMIN no puede promoverse o promover a alguien a SUPERADMIN
    if (user.role === 'ADMIN' && dataEmployee.role === 'SUPERADMIN') {
        throw new Error('No tienes permisos para otorgar nivel SUPERADMIN.');
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
const resetPassword = async (employeeId, adminPassword, adminUser) => {
    // 1. Verificar la contraseña del administrador
    await verifyAdminPassword(adminUser.id, adminPassword);

    // 2. Buscar al empleado a blanquear
    const whereClause = adminUser.storeId ? { id: employeeId, storeId: adminUser.storeId } : { id: employeeId };
    const employeeRecord = await prisma.user.findFirst({ where: whereClause });
    if (!employeeRecord) throw new Error("Empleado no encontrado o no pertenece a tu tienda.");

    // No se puede blanquear un superadmin por este medio
    if (employeeRecord.role === 'SUPERADMIN' && adminUser.role !== 'SUPERADMIN') {
        throw new Error("No tienes permisos para blanquear la clave de un SUPERADMIN.");
    }

    // 3. Generar nuevo PIN y actualizar
    const newTempPin = Math.floor(1000 + Math.random() * 9000).toString();
    const hashedPassword = await bcrypt.hash(newTempPin, 10);

    const updatedEmployee = await prisma.user.update({
        where: { id: employeeId },
        data: {
            password: hashedPassword,
            tempPassword: newTempPin,
            mustChangePassword: true
        }
    });

    console.log(`Clave blanqueada para ${updatedEmployee.email}. Nuevo PIN: ${newTempPin}`);
    return { 
        message: "Clave blanqueada exitosamente.", 
        newPin: newTempPin,
        employeeEmail: updatedEmployee.email 
    };
};

module.exports = { create, getAll, getById, update, setActiveStatus, resetPassword };
