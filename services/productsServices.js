const prisma = require(`../db/database.prisma`)


const create = async (dataProduct, user) => {

    console.log('Creating product...');

    const price = parseFloat(dataProduct.price);
    const stock = parseInt(dataProduct.stock);

    if (isNaN(price) || price < 0) {
        throw new Error("the Price cannot be a negative or invalid value");
    }

    if (isNaN(stock) || stock < 0) {
        throw new Error("the Stock cannot be a negative or invalid value");
    }

    const response = await prisma.product.create({
        data: {
            ...dataProduct,
            price,
            stock,
            storeId: user.storeId
        }
    });

    console.log('Product created:');
    return response;
}

const getAll = async (user) => {
    console.log('Fetching all products...');

    const whereClause = user.storeId ? { storeId: user.storeId } : {};

    const response = await prisma.product.findMany(
        {
            where: whereClause,
            include: {
                category: true
            }
        }
    );
    console.log('Products fetched:');
    return response;
}

const getById = async (id, user) => {
    console.log(`Fetching product with ID: ${id}`);

    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };

    const response = await prisma.product.findFirst({
        where: whereClause,
        include: {
            Image: {
                orderBy: {
                    order: "asc" // 👈 orden visual correcto
                }
            },
            category: {
                select: {
                    name: true
                }
            }
        }
    });
    if (!response) {
        throw new Error(`Product with ID ${id} not found`);
    }
    console.log('Product found:');
    return response;
}

const update = async (id, dataProduct, user) => {
    console.log(`Updating product with ID: ${id}`);

    // Verify ownership first
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existingProduct = await prisma.product.findFirst({ where: whereClause });
    if (!existingProduct) throw new Error(`Product with ID ${id} not found or access denied`);

    const allowedFields = [
        "name",
        "description",
        "price",
        "stock",
        "profilePicture",
        "isActive",
        "categoryId",
        "category"

    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataProduct).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    if ("price" in cleanData) {
        cleanData.price = parseFloat(cleanData.price);
    }

    if ("stock" in cleanData) {
        cleanData.stock = parseInt(cleanData.stock);
    }

    console.log("Updating with:", cleanData);

    if (Object.keys(cleanData).length === 0) {
        throw new Error("No hay campos válidos para actualizar");
    }

    const response = await prisma.product.update({
        where: { id },
        data: cleanData,

        include: {
            category: {
                select: {
                    name: true
                }
            }
        }
    });

    return response;
};


const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} product with ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existingProduct = await prisma.product.findFirst({ where: whereClause });
    if (!existingProduct) throw new Error(`Product with ID ${id} not found or access denied`);

    const response = await prisma.product.update({
        where: { id },
        data: { isActive }
    });
    console.log(`Product ${isActive ? "enabled" : "disabled"}:`);
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
