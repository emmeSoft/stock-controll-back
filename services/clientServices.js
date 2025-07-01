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
        
const setActiveStatus = async (id, isActive) => {
  console.log(`${isActive ? "Habilitando" : "Deshabilitando"} cliente con ID: ${id}`);
  
  const response = await prisma.client.update({
    where: { id },
    data: { isActive }
  });

  console.log(`Cliente ${isActive ? "habilitado" : "deshabilitado"}:`);
  return response;
};

module.exports = { create, getAll ,getById, update, setActiveStatus };


