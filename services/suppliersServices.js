const prisma = require(`../db/database.prisma`)


const create = async (dataSuppliers) => {
    console.log('Creating supplier...');
    const response = await prisma.supplier.create({ data: dataSuppliers });
    console.log('Supplier created:');
    return response;
}

const getAll = async () => {
    try {

        console.log('Fetching all suppliers...');
        const response = await prisma.supplier.findMany();
        console.log('Suppliers fetched:');
        return response;
    } catch (error) {
        console.error('Error fetching suppliers:', error);
        throw error;
    }
}

const getById = async (id) => {
    console.log(`Fetching supplier with ID: ${id}`);
    const response = await prisma.supplier.findUnique({ 
        where: { id: id },
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

const update = async (id, dataSuppliers) => {
    console.log(`Updating supplier with ID: ${id}`);
    const response = await prisma.supplier.update({
        where: { id: id },
        data: dataSuppliers
    });
    console.log('Supplier Actualizado Correctamente:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} supplier with ID: ${id}`);
    const response = await prisma.supplier.update({  
        where: { id },
        data: { isActive }
    });
    console.log(`Supplier ${isActive ? "enabled" : "disabled"}:`);
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };

