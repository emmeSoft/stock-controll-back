const prisma = require(`../db/database.prisma`)

const create = async (dataStore, user) => {
    console.log('Creating store...');
    if (user.role !== 'SUPERADMIN') {
        throw new Error('Only SUPERADMIN can create stores.');
    }
    const response = await prisma.store.create({ data: dataStore });
    console.log('Store created:', response.id);
    return response;
}

const getAll = async (user) => {
    console.log('Fetching stores...');
    if (user.role === 'SUPERADMIN') {
        return await prisma.store.findMany();
    } else {
        // ADMIN or USUARIO can only see their own store
        return await prisma.store.findMany({
            where: { id: user.storeId }
        });
    }
}

const getById = async (id, user) => {
    console.log(`Fetching store with ID: ${id}`);
    
    // Only SUPERADMIN can see other stores, others can only see their own store
    if (user.role !== 'SUPERADMIN' && user.storeId !== id) {
        throw new Error(`Access denied to store ${id}`);
    }

    const response = await prisma.store.findUnique({
        where: { id: id }
    });
    
    if (!response) {
        throw new Error(`Store with ID ${id} not found`);
    }
    return response;
}

const update = async (id, dataStore, user) => {
    console.log(`Updating store with ID: ${id}`);
    
    // SUPERADMIN can update any store. ADMIN can only update their own store properties.
    if (user.role !== 'SUPERADMIN' && (user.role !== 'ADMIN' || user.storeId !== id)) {
        throw new Error("Access denied. Only SUPERADMIN or the store ADMIN can edit the store.");
    }

    const response = await prisma.store.update({
        where: { id: id },
        data: dataStore
    });
    return response;
}

const setActiveStatus = async (id, isActive, user) => {
    console.log(`${isActive ? "Enabling" : "Disabling"} store with ID: ${id}`);
    
    // Only SUPERADMIN can enable/disable a store
    if (user.role !== 'SUPERADMIN') {
        throw new Error("Only SUPERADMIN can activate or deactivate a store.");
    }

    const response = await prisma.store.update({
        where: { id },
        data: { isActive }
    });
    return response;
}

module.exports = { create, getAll, getById, update, setActiveStatus };
