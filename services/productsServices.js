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

    if (!user.storeId) {
        throw new Error('Debe seleccionar una tienda para asignar al producto.');
    }

    const response = await prisma.product.create({
        data: {
            ...dataProduct,
            price,
            stock,
            storeId: user.storeId
        }
    });

    if (stock > 0) {
        await prisma.stockHistory.create({
            data: {
                storeId: user.storeId,
                productId: response.id,
                userId: user.id || null,
                type: 'INITIAL',
                previousStock: 0,
                movementAmount: stock,
                currentStock: stock,
                description: 'Carga inicial del producto'
            }
        });
    }

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

    if ("stock" in cleanData && cleanData.stock !== existingProduct.stock) {
        const difference = cleanData.stock - existingProduct.stock;
        await prisma.stockHistory.create({
            data: {
                storeId: existingProduct.storeId,
                productId: id,
                userId: user.id || null,
                type: 'MANUAL_ADJUSTMENT',
                previousStock: existingProduct.stock,
                movementAmount: difference,
                currentStock: cleanData.stock,
                description: 'Ajuste manual de stock desde el panel'
            }
        });
    }

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

const adjustStock = async (id, amount, description, user) => {
    console.log(`Adjusting stock for product ID: ${id} by ${amount}`);
    
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    
    return await prisma.$transaction(async (tx) => {
        const existingProduct = await tx.product.findFirst({ where: whereClause });
        if (!existingProduct) throw new Error(`Product with ID ${id} not found or access denied`);

        const newStock = existingProduct.stock + amount;
        if (newStock < 0) {
            throw new Error(`El ajuste resulta en stock negativo. Stock actual: ${existingProduct.stock}`);
        }

        const updatedProduct = await tx.product.update({
            where: { id },
            data: { stock: newStock },
            include: {
                category: {
                    select: {
                        name: true
                    }
                }
            }
        });

        await tx.stockHistory.create({
            data: {
                storeId: existingProduct.storeId,
                productId: id,
                userId: user.id || null,
                type: 'MANUAL_ADJUSTMENT',
                previousStock: existingProduct.stock,
                movementAmount: amount,
                currentStock: newStock,
                description: description
            }
        });

        return updatedProduct;
    });
};

module.exports = { create, getAll, getById, update, setActiveStatus, adjustStock };
