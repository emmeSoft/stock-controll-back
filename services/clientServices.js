const prisma = require(`../db/database.prisma`)


const create = async (dataClient) => {
    console.log('Creating client...');
    const response = await prisma.client.create({ data: dataClient });
    console.log('Client created:');
    return response;
}

const getAll = async () => {
    console.log('Fetching all clients...');
    const response = await prisma.client.findMany();
    console.log('Clients fetched:');
    return response;
}

const getById = async (id) => {
    const response = await prisma.client.findUnique({ where: { id: id } });
    if (!response) {
        throw new Error(`Client with ID ${id} not found`);
    }
    console.log('Client fetched:');
    return response;
}
module.exports = { create, getAll ,getById};


