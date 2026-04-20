const prisma = require(`../db/database.prisma`)


const create = async (dataProduct, user) => {

    // console.log('Creating product...');

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

    // Generate 9-digit barcode
    let barcode;
    if (dataProduct.categoryId) {
        const category = await prisma.categories.findUnique({
            where: { id: dataProduct.categoryId }
        });
        if (category && category.barcodePrefix) {
            let isUnique = false;
            let attempts = 0;
            while (!isUnique && attempts < 50) {
                const suffix = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
                barcode = category.barcodePrefix + suffix;
                const existing = await prisma.product.findFirst({
                    where: { barcode, storeId: user.storeId }
                });
                if (!existing) isUnique = true;
                attempts++;
            }
            if (!isUnique) throw new Error("No se pudo generar un código de barras único.");
        }
    }

    const allowedFields = [
        "name",
        "description",
        "price",
        "stock",
        "profilePicture",
        "isActive",
        "categoryId"
    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataProduct).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    const response = await prisma.product.create({
        data: {
            ...cleanData,
            price,
            stock,
            barcode,
            storeId: user.storeId
        },
        include: { Image: true }
    });

    if (stock > 0) {
        await prisma.stockHistory.create({
            data: {
                store: { connect: { id: user.storeId } },
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

    // console.log('Product created:');
    return response;
}

const getAll = async (user, filters = {}) => {
    // console.log('Fetching all products with filters:', filters);

    // SISTEMA puede ver todos los productos si no hay override de tienda
    // Si hay override (isGlobalOverride), filtra por esa tienda
    const isSistema = user.role === 'SISTEMA' || user.isSistema;
    const canSeeAll = isSistema && !user.isGlobalOverride;

    const whereClause = {
        ...(canSeeAll ? {} : (user.storeId ? { storeId: user.storeId } : {})),
        ...(filters.categoryId ? { categoryId: filters.categoryId } : {})
    };

    const response = await prisma.product.findMany(
        {
            where: whereClause,
            include: {
                category: true
            }
        }
    );
    // console.log('Products fetched:');
    return response;
}

const getById = async (id, user) => {
    // console.log(`Fetching product with ID: ${id}`);

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
    // console.log('Product found:');
    return response;
}

const update = async (id, dataProduct, user) => {
    // console.log(`Updating product with ID: ${id}`);

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

    // Si cambió la categoría, regenerar el código de barras
    if (cleanData.categoryId && cleanData.categoryId !== existingProduct.categoryId) {
        const category = await prisma.categories.findUnique({
            where: { id: cleanData.categoryId }
        });
        if (category && category.barcodePrefix) {
            let barcode;
            let isUnique = false;
            let attempts = 0;
            while (!isUnique && attempts < 50) {
                const suffix = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digits
                barcode = category.barcodePrefix + suffix;
                const existing = await prisma.product.findFirst({
                    where: { barcode, storeId: existingProduct.storeId }
                });
                if (!existing) isUnique = true;
                attempts++;
            }
            if (isUnique) {
                cleanData.barcode = barcode;
            } else {
                throw new Error("No se pudo generar un nuevo código de barras único para la nueva categoría.");
            }
        }
    }

    if ("price" in cleanData) {
        cleanData.price = parseFloat(cleanData.price);
    }

    if ("stock" in cleanData) {
        cleanData.stock = parseInt(cleanData.stock);
    }

    // console.log("Updating with:", cleanData);

    if (Object.keys(cleanData).length === 0) {
        throw new Error("No hay campos válidos para actualizar");
    }

    const response = await prisma.product.update({
        where: { id },
        data: cleanData,

        include: {
            Image: true,
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
                store: { connect: { id: existingProduct.storeId } },
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
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existingProduct = await prisma.product.findFirst({ where: whereClause });
    if (!existingProduct) throw new Error(`Product with ID ${id} not found or access denied`);

    const response = await prisma.product.update({
        where: { id },
        data: { isActive },
        include: { Image: true, category: true }
    });

    // Validar que la categoría esté activa si se intenta dar de alta el producto
    if (isActive === true && response.categoryId) {
        if (response.category && response.category.isActive === false) {
            // Revertir el estado del producto si la categoría está inactiva
            await prisma.product.update({
                where: { id },
                data: { isActive: false }
            });
            throw new Error(`No se puede dar de alta el producto porque su categoría (${response.category.name}) está dada de baja. Por favor, dé de alta la categoría primero.`);
        }
    }

    return response;
}

const adjustStock = async (id, amount, description, user) => {
    
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
                Image: true,
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
