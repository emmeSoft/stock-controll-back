const prisma = require(`../db/database.prisma`)

const create = async (dataSuppliers, user) => {
    console.log('Creating supplier...');
    if (!user.storeId) {
        throw new Error('Debe seleccionar una tienda para asignar al proveedor.');
    }
    const response = await prisma.supplier.create({ data: { ...dataSuppliers, storeId: user.storeId } });
    console.log('Supplier created:');
    return response;
}

const getAll = async (user) => {
    try {
        console.log('Fetching all suppliers...');
        const whereClause = user.storeId ? { storeId: user.storeId } : {};
        const response = await prisma.supplier.findMany({ where: whereClause });
        console.log('Suppliers fetched:');
        return response;
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        throw error;
    }
}

const getById = async (id, user) => {
    console.log(`Fetching supplier with ID: ${id}`);
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
    console.log('Supplier found:');
    return response;
}

const update = async (id, dataSuppliers, user) => {
    console.log(`Updating supplier with ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.supplier.findFirst({ where: whereClause });
    if (!existing) throw new Error("Supplier not found or access denied");

    const response = await prisma.supplier.update({
        where: { id: id },
        data: dataSuppliers
    });
    console.log('Supplier Actualizado Correctamente:');
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} supplier with ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.supplier.findFirst({ where: whereClause });
    if (!existing) throw new Error("Supplier not found or access denied");

    const response = await prisma.supplier.update({  
        where: { id },
        data: { isActive }
    });
    console.log(`Supplier ${isActive ? "enabled" : "disabled"}:`);
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
