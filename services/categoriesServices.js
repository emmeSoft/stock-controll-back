const prisma = require(`../db/database.prisma`)


const create = async (dataCategory) => {
    console.log('Creating category...');
    const response = await prisma.categories.create({ data: dataCategory });
    console.log('Category created:');
    return response;
}

const getAll = async () => {
    console.log('Fetching all categories...');
    const response = await prisma.categories.findMany();
    console.log('Categories fetched:');
    return response;
}

module.exports = { create, getAll };


    