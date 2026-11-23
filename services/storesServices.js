const prisma = require(`../db/database.prisma`)

const create = async (dataStore, user) => {
    // console.log('Creating store...', user);
    // console.log('User role:', user.role);
    // console.log('User isSistema:', user.isSistema);
    // SISTEMA puede crear tiendas
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    // console.log('Is Sistema:', isSistema);
    if (!isSistema) {
        throw new Error('Solo el usuario SISTEMA puede crear tiendas.');
    }
    const allowedFields = [
        "name", 
        "address", 
        "phone", 
        "profilePicture", 
        "isActive"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataStore).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.store.create({ 
        data: cleanData,
        include: { Image: true }
    });
    return response;
}

const getAll = async (user) => {
    // console.log('Fetching stores...');
    // SISTEMA puede ver todas las tiendas (soporta role o isSistema)
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    if (isSistema) {
        return await prisma.store.findMany({
            include: { Image: true }
        });
    } else {
        // ADMINISTRADOR, ENCARGADO, VENDEDOR solo ven su tienda
        return await prisma.store.findMany({
            where: { id: user.storeId },
            include: { Image: true }
        });
    }
}

const getById = async (id, user) => {
    
    // SISTEMA puede ver cualquier tienda
    // Otros roles solo pueden ver su propia tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    if (!isSistema && user.storeId !== id) {
        throw new Error(`Acceso denegado a la tienda ${id}`);
    }

    const response = await prisma.store.findUnique({
        where: { id: id },
        include: {
            Image: {
                orderBy: {
                    order: 'asc'
                }
            }
        }
    });
    
    if (!response) {
        throw new Error(`Tienda con ID ${id} no encontrada`);
    }
    return response;
}

const update = async (id, dataStore, user) => {
    
    // SISTEMA puede actualizar cualquier tienda
    // ADMINISTRADOR puede actualizar solo su tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const isAdmin = user.role === 'ADMINISTRADOR';
    if (!isSistema && (!isAdmin || user.storeId !== id)) {
        throw new Error("Acceso denegado. Solo SISTEMA o el ADMINISTRADOR de la tienda pueden editar.");
    }

    const allowedFields = [
        "name", 
        "address", 
        "phone", 
        "profilePicture", 
        "isActive"
    ];

    if (isSistema) {
        allowedFields.push("maxDiscountPct", "isFreeTier");
    }

    const cleanData = Object.fromEntries(
        Object.entries(dataStore).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    // DynamicForm/EntityDetailsForm mandan siempre string (el input es type="text").
    // El schema espera Float — sin esta coerción, Prisma tira PrismaClientValidationError
    // y storesController la devuelve como 403, como si fuera un problema de permisos.
    if (cleanData.maxDiscountPct !== undefined) {
        const parsed = Number(cleanData.maxDiscountPct);
        if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
            throw Object.assign(
                new Error("maxDiscountPct debe ser un número entre 1 y 100."),
                { status: 400, code: "INVALID_MAX_DISCOUNT_PCT" }
            );
        }
        cleanData.maxDiscountPct = parsed;
    }

    // DynamicForm envía strings; el whitelist es la frontera autoritativa, acá normalizamos.
    // Un valor no reconocido (null, number, "TRUE", etc.) no se toca en vez de
    // caer silenciosamente a false — evitar que un dato inesperado cambie el tier.
    if (cleanData.isFreeTier !== undefined) {
        if (cleanData.isFreeTier === true || cleanData.isFreeTier === "true") {
            cleanData.isFreeTier = true;
        } else if (cleanData.isFreeTier === false || cleanData.isFreeTier === "false") {
            cleanData.isFreeTier = false;
        } else {
            delete cleanData.isFreeTier;
        }
    }

    const response = await prisma.store.update({
        where: { id: id },
        data: cleanData,
        include: { Image: true }
    });
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    
    // Solo SISTEMA puede habilitar/deshabilitar una tienda
    if (user.role !== 'SISTEMA') {
        throw new Error("Solo el usuario SISTEMA puede activar o desactivar una tienda.");
    }

    const response = await prisma.store.update({
        where: { id },
        data: { isActive }
    });
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
