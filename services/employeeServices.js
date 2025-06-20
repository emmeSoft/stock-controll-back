const prisma = require(`../db/database.prisma`)


const create = async (dataEmployee) => {
    console.log('Creando Empleado...');
    const response = await prisma.user.create({ data: dataEmployee });
    console.log('Empleado creado:');
    return response;
}

const getAll = async () => {
    console.log('Trayendo todos los empleados...');
    const response = await prisma.user.findMany();
    console.log('Empleados Cargados:');
    return response;
}

const getById = async (id) => {
    console.log(`Trayendo empleado con ID: ${id}`);
    const response = await prisma.user.findUnique({ where: { id: id } });
    if (!response) {
        throw new Error(`Empleado con ID ${id} no encontrado`);
    }
    console.log('Empleado encontrado:');
    return response;
}

module.exports = { create, getAll, getById };


