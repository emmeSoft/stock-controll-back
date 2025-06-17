const prisma = require(`../db/database.prisma`)


const create = async (dataEmployee) => {
    console.log('Creaando Empleado...');
    const response = await prisma.employee.create({ data: dataEmployee });
    console.log('Empleado creado:', response);
    return response;
}

const getAll = async () => {
    console.log('Trayendo todos los empleados...');
    const response = await prisma.client.findMany();
    console.log('Empleados Cargados:', response);
    return response;
}

module.exports = { create, getAll };


