const prisma = require(`../db/database.prisma`)
const { money, round } = require('../utils/money');


const create = async (dataProduct, user) => {

    // console.log('Creating product...');

    // Decimal-safe parse: `money()` rejects garbage strings (parseFloat would
    // silently accept "12.50abc" as 12.5) and represents NaN as a non-finite
    // Decimal instead of throwing, so the existing validation below keeps
    // its exact previous semantics (reject negative or invalid, allow 0).
    let price;
    try {
        price = money(dataProduct.price);
    } catch {
        price = money(NaN);
    }
    const stock = parseInt(dataProduct.stock);

    if (!price.isFinite() || price.lt(0)) {
        throw new Error("the Price cannot be a negative or invalid value");
    }
    price = round(price);

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
                product: { connect: { id: response.id } },
                user: user.id ? { connect: { id: user.id } } : undefined,
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
        // Decimal-safe parse, same rule as `create()` (see comment there).
        // Parity fix: `update()` previously had NO negative/invalid guard at
        // all (plain `parseFloat`, relying on Prisma to reject NaN with an
        // unfriendly error) — now matches `create()`'s validation exactly.
        let price;
        try {
            price = money(cleanData.price);
        } catch {
            price = money(NaN);
        }
        if (!price.isFinite() || price.lt(0)) {
            throw new Error("the Price cannot be a negative or invalid value");
        }
        cleanData.price = round(price);
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

    // OUT OF SCOPE (money-stock-integrity): this `stock`-in-body path is
    // unreachable from the current frontend (`Details.jsx` strips `stock`
    // before the PUT; the only stock-editing UI calls the dedicated
    // `adjustStock()` below instead) — left exactly as-is, read-then-write
    // and all, per proposal.md's "Out of Scope" / product-owner decision.
    // Deferred to a future deep-cleanup SDD change.
    if ("stock" in cleanData && cleanData.stock !== existingProduct.stock) {
        const difference = cleanData.stock - existingProduct.stock;
        await prisma.stockHistory.create({
            data: {
                store: { connect: { id: existingProduct.storeId } },
                product: { connect: { id: id } },
                user: user.id ? { connect: { id: user.id } } : undefined,
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

    const storeScope = user.storeId ? { storeId: user.storeId } : {};

    return await prisma.$transaction(async (tx) => {
        // Existence/ownership pre-check — cheap, friendly 404 in the
        // non-racing case (same role as the PASO 1 pre-check in
        // salesServices.create). This read can be stale under a race, but
        // that's fine: the atomic guard below, not this read, decides
        // whether the delta is actually applied.
        const existingProduct = await tx.product.findFirst({ where: { id, ...storeScope } });
        if (!existingProduct) {
            throw Object.assign(new Error(`Product with ID ${id} not found or access denied`), { status: 404 });
        }

        // Atomicidad: "hay stock suficiente para este delta" y el
        // incremento/decremento son UN SOLO statement atómico a nivel DB
        // (`updateMany` con `WHERE stock: { gte: -delta } }`), nunca un
        // read-then-write — mismo idioma que PASO 10 de salesServices.create
        // y los guards de currentAccountServices.registerPayment/close.
        // `amount` ya es un delta con signo (nunca el valor absoluto) —
        // confirmado: la única UI que ajusta stock (`StockAdjustModal.jsx` ->
        // `useEntitySave.js:26`) llama siempre a este `PUT /products/:id/stock`
        // dedicado con un delta, nunca al `update()` genérico.
        const { count } = await tx.product.updateMany({
            where: { id, ...storeScope, stock: { gte: -amount } },
            data: { stock: { increment: amount } }
        });

        if (count === 0) {
            // Re-leer el stock committeado actual para un mensaje preciso —
            // el `existingProduct` pre-lectura puede estar obsoleto para
            // este propósito (aunque nunca se usa para derivar el historial).
            const current = await tx.product.findUnique({ where: { id }, select: { stock: true } });
            throw Object.assign(
                new Error(`El ajuste resulta en stock negativo. Stock actual: ${current?.stock ?? existingProduct.stock}`),
                { status: 409 }
            );
        }

        // `updateMany` solo devuelve { count } — re-leer SIEMPRE el estado
        // post-escritura; previousStock/currentStock se derivan de este
        // valor, nunca del `existingProduct` pre-lectura (mismo patrón que
        // PASO 10 / registerPayment / close).
        const updatedProduct = await tx.product.findUnique({
            where: { id },
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
                store: { connect: { id: updatedProduct.storeId } },
                product: { connect: { id: id } },
                user: user.id ? { connect: { id: user.id } } : undefined,
                type: 'MANUAL_ADJUSTMENT',
                previousStock: updatedProduct.stock - amount,
                movementAmount: amount,
                currentStock: updatedProduct.stock,
                description: description
            }
        });

        return updatedProduct;
    });
};

module.exports = { create, getAll, getById, update, setActiveStatus, adjustStock };
