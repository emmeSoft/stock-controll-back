const prisma = require(`../db/database.prisma`)


const create = async (dataCategory, user) => {
    console.log('Creating category...');
    if (!user.storeId) {
        throw new Error('Debe seleccionar una tienda para asignar a la categoría.');
    }
    // Generate a unique 3-digit barcode prefix
    // Generate a unique 3-digit barcode prefix (Sequential)
    let barcodePrefix;
    
    // Find the category with the highest barcodePrefix for this store
    const lastCategory = await prisma.categories.findFirst({
        where: { storeId: user.storeId },
        orderBy: { barcodePrefix: 'desc' },
        select: { barcodePrefix: true }
    });

    if (lastCategory && lastCategory.barcodePrefix) {
        const lastPrefix = parseInt(lastCategory.barcodePrefix, 10);
        if (lastPrefix >= 999) {
            throw new Error("Se ha alcanzado el límite de categorías (999). No se pueden crear más prefijos de 3 dígitos.");
        }
        // Increment and pad to 3 digits
        barcodePrefix = (lastPrefix + 1).toString().padStart(3, '0');
    } else {
        // Start at 100 for the first category (as per user's seed preference)
        barcodePrefix = "100";
    }

    const response = await prisma.categories.create({ 
        data: { 
            ...dataCategory, 
            barcodePrefix,
            storeId: user.storeId 
        } 
    });
    console.log('Category created:', response.id);
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

    // Si se está dando de baja la categoría, dar de baja todos sus productos en cascada
    if (isActive === false) {
        await prisma.product.updateMany({
            where: { categoryId: id, storeId: user.storeId },
            data: { isActive: false }
        });
        console.log(`All products in category ${id} have been deactivated.`);
    }

    console.log(`Category ${isActive ? "enabled" : "disabled"}:`);
    return response;
}


module.exports = { create, getAll, getById, update, setActiveStatus };


