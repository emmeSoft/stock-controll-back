const prisma = require(`../db/database.prisma`)


const create = async (dataSuppliers) => {
    console.log('Creating supplier...');
    const response = await prisma.suplier.create({ data: dataSuppliers });
    console.log('Supplier created:');
    return response;
}

const getAll = async () => {
    console.log('Fetching all suppliers...');
    const response = await prisma.suplier.findMany();
    console.log('Suppliers fetched:');
    return response;
}

const getById = async (id) => {
    console.log(`Fetching supplier with ID: ${id}`);
    const response = await prisma.suplier.findUnique({ where: { id: id } });
    if (!response) {
        throw new Error(`Supplier with ID ${id} not found`);
    }
    console.log('Supplier found:');
    return response;
}

const update = async (id, dataSuppliers) => {
    console.log(`Updating supplier with ID: ${id}`);
    const response = await prisma.suplier.update({
        where: { id: id },
        data: dataSuppliers
    });
    console.log('Supplier Actualizado Correctamente:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} supplier with ID: ${id}`);
    const response = await prisma.suplier.update({  
        where: { id },
        data: { isActive }
    });
    console.log(`Supplier ${isActive ? "enabled" : "disabled"}:`);
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };

