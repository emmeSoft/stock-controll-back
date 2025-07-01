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

const getById = async (id) => {
    console.log(`Fetching category with ID: ${id}`);
    const response = await prisma.categories.findUnique({ where: { id: id } });
    if (!response) {
        throw new Error(`Category with ID ${id} not found`);
    }
    console.log('Category found:');
    return response;
}

const update = async (id, dataCategory) => {
    console.log(`Updating category with ID: ${id}`);
    const response = await prisma.categories.update({
        where: { id: id },
        data: dataCategory
    });
    console.log('Category updated:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} category with ID: ${id}`);
    
    const response = await prisma.categories.update({
        where: { id },
        data: { isActive }
    });

    console.log(`Category ${isActive ? "enabled" : "disabled"}:`);
    return response;
}   


module.exports = { create, getAll, getById, update, setActiveStatus };


    