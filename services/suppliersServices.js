const prisma = require(`../db/database.prisma`)

const create = async (dataSuppliers, user) => {
    if (!user.storeId) {
        throw new Error('Debe seleccionar una tienda para asignar al proveedor.');
    }
    const allowedFields = [
        "fullName",
        "email",
        "cuit",
        "phoneNumber",
        "address",
        "city",
        "description",
        "profilePicture",
        "isActive"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataSuppliers).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.supplier.create({ 
        data: { 
            ...cleanData, 
            store: { connect: { id: user.storeId } }
        },
        include: { Image: true }
    });
    return response;
}

const getAll = async (user) => {
    try {
        // SISTEMA puede ver todos los proveedores si no hay override de tienda
        const isSistema = user.role === 'SISTEMA' || user.isSistema;
        const canSeeAll = isSistema && !user.isGlobalOverride;
        const whereClause = canSeeAll ? {} : { storeId: user.storeId };
        const response = await prisma.supplier.findMany({ where: whereClause });
        return response;
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        throw error;
    }
}

const getById = async (id, user) => {
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const response = await prisma.supplier.findFirst({ 
        where: whereClause,
        include: {
            Image: {
                orderBy: {
                    order: "asc" // 👈 orden visual correcto
                }
            }
        } });
    if (!response) {
        throw new Error(`Supplier with ID ${id} not found`);
    }
    return response;
}

const update = async (id, dataSuppliers, user) => {
    // console.log(`Updating supplier with ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.supplier.findFirst({ where: whereClause });
    if (!existing) throw new Error("Supplier not found or access denied");

    const allowedFields = [
        "fullName",
        "email",
        "cuit",
        "phoneNumber",
        "address",
        "city",
        "description",
        "profilePicture",
        "isActive"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataSuppliers).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.supplier.update({
        where: { id: id },
        data: cleanData,
        include: { Image: true }
    });
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.supplier.findFirst({ where: whereClause });
    if (!existing) throw new Error("Supplier not found or access denied");

    const response = await prisma.supplier.update({  
        where: { id },
        data: { isActive }
    });
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
