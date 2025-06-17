const prisma = require(`../db/database.prisma`)


const create = async (dataEmployee) => {
    console.log('Creando Empleado...');
    const response = await prisma.employee.create({ data: dataEmployee });
    console.log('Empleado creado:');
    return response;
}

const getAll = async () => {
    console.log('Trayendo todos los empleados...');
    const response = await prisma.employee.findMany();
    console.log('Empleados Cargados:');
    return response;
}

module.exports = { create, getAll };


