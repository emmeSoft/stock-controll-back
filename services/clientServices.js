const prisma = require(`../db/database.prisma`);
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");


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
    const response = await prisma.client.findUnique({
        where: { id: id },
        include: {
            Image: {
                orderBy: {
                    order: "asc" // orden visual correcto
                }
            }
        }
    });
    if (!response) {
        throw new Error(`Client with ID ${id} not found`);
    }
    console.log('Client fetched:');
    return response;
}

const update = async (id, dataClient) => {
    console.log(`Actualizando cliente con ID: ${id}`);


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
        Object.entries(dataClient).filter(
            ([key, value]) => allowedFields.includes(key) && value !== undefined
        )
    );

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

    const response = await prisma.client.update({
        where: { id: id },
        data: cleanData
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

module.exports = { create, getAll, getById, update, setActiveStatus };


