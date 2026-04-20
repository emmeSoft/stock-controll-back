const prisma = require(`../db/database.prisma`)


const create = async (dataCategory, user) => {
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

    const allowedFields = [
        "name", 
        "description", 
        "profilePicture", 
        "isActive"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataCategory).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.categories.create({ 
        data: { 
            ...cleanData, 
            barcodePrefix,
            store: { connect: { id: user.storeId } }
        },
        include: { Image: true }
    });
    return response;
}

const getAll = async (user) => {
    // SISTEMA puede ver todas las categorías si no hay override de tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const canSeeAll = isSistema && !user.isGlobalOverride;
    const whereClause = canSeeAll ? {} : { storeId: user.storeId };
    const response = await prisma.categories.findMany({ where: whereClause });
    return response;
}

const getById = async (id, user) => {
    // console.log(`Fetching category with ID: ${id}`);
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
    return response;
}

const update = async (id, dataCategory, user) => {

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.categories.findFirst({ where: whereClause });
    if (!existing) throw new Error("Category not found or access denied");

    const allowedFields = [
        "name", 
        "description", 
        "profilePicture", 
        "isActive"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataCategory).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.categories.update({
        where: { id: id },
        data: cleanData,
        include: { Image: true }
    });
    return response;
}

const setActiveStatus = async (id, isActive, user) => {

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
    }

    return response;
}


module.exports = { create, getAll, getById, update, setActiveStatus };


