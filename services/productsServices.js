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

module.exports = { create, getAll };


