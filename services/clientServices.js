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

const update = async (id, dataClient) => {
    console.log(`Actualizando cliente con ID: ${id}`);

    const response = await prisma.client.update({
        where: { id: id},
        data: dataClient
    });
    console.log('Cliente Actualizado:');    
    return response;
}   
        
const disable = async (id) => {
    console.log(`Deshabilitando cliente con ID: ${id}`);
    
    const response = await prisma.client.update({
        where: { id: id },
        data: { isActive: false }
    });
    console.log('Cliente deshabilitado:');
    return response;
}

const enable = async (id) => {
    console.log(`Habilitando cliente con ID: ${id}`);
    const response = await prisma.client.update({
        where: { id: id },
        data: { isActive: true }
    });
    console.log('Cliente habilitado:');
    return response;
}

module.exports = { create, getAll ,getById, update, disable, enable};


