const prisma = require(`../db/database.prisma`)


const create = async (dataClient) => {
    console.log('Creating client...');
    const response = await prisma.client.create({ data: dataClient });
    console.log('Client created:', response);
    return response;
}

const getAll = async () => {
    console.log('Fetching all clients...');
    const response = await prisma.client.findMany();
    console.log('Clients fetched:', response);
    return response;
}

module.exports = { create, getAll };


