const prisma = require(`../db/database.prisma`);
const ALLOWED_ROLES = ["superadmin", "admin", "user"];
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");


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
    const response = await prisma.user.findUnique({
        where: { id: id },
        include: {
            Image: {
                orderBy: {
                    order: "asc" // 👈 orden visual correcto
                }
            }
        }
    });
    if (!response) {
        throw new Error(`Empleado con ID ${id} no encontrado`);
    }
    console.log('Empleado encontrado:');
    return response;
}

const update = async (id, dataEmployee) => {
    console.log(`actualizando empleado con ID: ${id}`);


    const allowedFields = [
        "name",
        "fullName",
        "firstName",
        "lastName",
        "email",
        "phoneNumber",
        "address",
        "city",
        "dni",
        "cuit",
        "description",
        "price",
        "stock",
        "profilePicture",
        "isActive",

    ];

    const cleanData = Object.fromEntries(
        Object.entries(dataEmployee).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

    if ("role" in cleanData) {
        if (!ALLOWED_ROLES.includes(cleanData.role)) {
            throw new Error("Rol inválido");
        }
    }


    if ("dni" in cleanData) {
        const normalized = normalizeDni(cleanData.dni);

        if (!isValidDni(normalized)) {
            throw new Error("DNI inválido");
        }

        cleanData.dni = normalized;
    }

    if ("email" in cleanData) {
        const normalized = normalizeEmail(cleanData.email);

        if (!isValidEmail(normalized)) {
            throw new Error("Email inválido");
        }

        cleanData.email = normalized;
    }

    if ("cuit" in cleanData) {
        const normalized = normalizeCuit(cleanData.cuit);

        if (!isValidCuit(normalized)) {
            throw new Error("CUIT inválido");
        }

        cleanData.cuit = normalized;
    }

    if ("phoneNumber" in cleanData) {
        const normalized = normalizeArPhone(cleanData.phoneNumber);

        if (!isValidArPhone(normalized)) {
            throw new Error("Número de teléfono inválido");
        }

    }

    const response = await prisma.user.update({
        where: { id: id },
        data: dataEmployee
    });
    console.log('Empleado Actualizado:');
    return response;
}

const setActiveStatus = async (id, isActive) => {
    console.log(`${isActive ? "Habilitando" : "Deshabilitando"} empleado con ID: ${id}`);

    const response = await prisma.user.update({
        where: { id },
        data: { isActive }
    });

    console.log(`Empleado ${isActive ? "habilitado" : "deshabilitado"}`);

    return response;
}



module.exports = { create, getAll, getById, update, setActiveStatus };


