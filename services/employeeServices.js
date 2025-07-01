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

const update = async (id, dataEmployee) => {
    console.log(`actualizando empleado con ID: ${id}`);

    const response = await prisma.user.update({
        where: { id: id},
        data: dataEmployee
    });
    console.log('Empleado Actualizado:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Habilitando" : "Deshabilitando"} empleado con ID: ${id}`);

    const response = await prisma.user.update({
        where: { id },
        data : { isActive } 
    });

    console.log (`Empleado ${ isActive ? "habilitado" : "deshabilitado"}`);

    return response;
}



module.exports = { create, getAll, getById, update, setActiveStatus };


