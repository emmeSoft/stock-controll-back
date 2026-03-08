const prisma = require(`../db/database.prisma`)


const create = async (dataCategory, user) => {
    console.log('Creating category...');
    const response = await prisma.categories.create({ data: { ...dataCategory, storeId: user.storeId } });
    console.log('Category created:');
    return response;
}

const getAll = async (user) => {
    console.log('Fetching all categories...');
    const whereClause = user.storeId ? { storeId: user.storeId } : {};
    const response = await prisma.categories.findMany({ where: whereClause });
    console.log('Categories fetched:');
    return response;
}

const getById = async (id, user) => {
    console.log(`Fetching category with ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const response = await prisma.categories.findFirst({
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
        throw new Error(`Category with ID ${id} not found`);
    }
    console.log('Category found:');
    return response;
}

const update = async (id, dataCategory, user) => {
    console.log(`Updating category with ID: ${id}`);

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.categories.findFirst({ where: whereClause });
    if (!existing) throw new Error("Category not found or access denied");

    const response = await prisma.categories.update({
        where: { id: id },
        data: dataCategory
    });
    console.log('Category updated:');
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} category with ID: ${id}`);

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.categories.findFirst({ where: whereClause });
    if (!existing) throw new Error("Category not found or access denied");

    const response = await prisma.categories.update({
        where: { id },
        data: { isActive }
    });

    console.log(`Category ${isActive ? "enabled" : "disabled"}:`);
    return response;
}


module.exports = { create, getAll, getById, update, setActiveStatus };


