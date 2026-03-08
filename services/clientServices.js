const prisma = require(`../db/database.prisma`);
const { isValidDni, normalizeDni, isValidEmail, normalizeEmail, normalizeCuit, isValidCuit, normalizeArPhone, isValidArPhone } = require("../utils/validators");


const create = async (dataClient, user) => {
    console.log('Creating client...',user);
    const response = await prisma.client.create({ data: { ...dataClient, storeId: user.storeId } });
    console.log('Client created:');
    return response;
}

const getAll = async (user) => {
    console.log('Fetching all clients...');
    const whereClause = user.storeId ? { storeId: user.storeId } : {};
    const response = await prisma.client.findMany({ where: whereClause });
    console.log('Clients fetched:');
    return response;
}

const getById = async (id, user) => {
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const response = await prisma.client.findFirst({
        where: whereClause,
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

const update = async (id, dataClient, user) => {
    console.log(`Actualizando cliente con ID: ${id}`);
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.client.findFirst({ where: whereClause });
    if (!existing) throw new Error("Client not found or access denied");


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

const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Habilitando" : "Deshabilitando"} cliente con ID: ${id}`);
    
    const whereClause = user.storeId ? { id: id, storeId: user.storeId } : { id: id };
    const existing = await prisma.client.findFirst({ where: whereClause });
    if (!existing) throw new Error("Client not found or access denied");

    const response = await prisma.client.update({
        where: { id },
        data: { isActive }
    });

    console.log(`Cliente ${isActive ? "habilitado" : "deshabilitado"}:`);
    return response;
};

module.exports = { create, getAll, getById, update, setActiveStatus };


