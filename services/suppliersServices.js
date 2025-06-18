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

module.exports = { create, getAll };


