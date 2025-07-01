const prisma = require(`../db/database.prisma`)


const create = async (dataProduct) => {

    console.log('Creating product...');

    const response = await prisma.product.create({
        data: {
            ...dataProduct,
            price: parseFloat(dataProduct.price),
            stock: parseInt(dataProduct.stock),
        }
    });

    console.log('Product created:');
    return response;
}

const getAll = async () => {
    console.log('Fetching all products...');
    const response = await prisma.product.findMany();
    console.log('Products fetched:');
    return response;
}

const getById = async (id) => {
    console.log(`Fetching product with ID: ${id}`);
    const response = await prisma.product.findUnique({ where: { id: id } });
    if (!response) {
        throw new Error(`Product with ID ${id} not found`);
    }
    console.log('Product found:');
    return response;
}

const update = async (id, dataProduct) => {
    console.log(`Updating product with ID: ${id}`);
    const response = await prisma.product.update({
        where: { id: id },
        data: {
            ...dataProduct,
            price: parseFloat(dataProduct.price),
            stock: parseInt(dataProduct.stock),
        }
    });
    console.log('Product updated successfully:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} product with ID: ${id}`);
    const response = await prisma.product.update({
        where: { id },
        data: { isActive }
    });
    console.log(`Product ${isActive ? "enabled" : "disabled"}:`);
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
