/**
 * Tests básicos para RBAC Service
 * Ejecutar con: npm test
 */
const { PrismaClient } = require('@prisma/client');

// Mock de prisma para testing sin DB real
const mockPrisma = {
  user: {
    findUnique: jest.fn()
  },
  store: {
    findUnique: jest.fn()
  }
};

jest.mock('../db/database.prisma', () => mockPrisma);

const rbacService = require('../services/rbacService');
const permissionsCache = require('../services/permissionsCache');

describe('RBAC Service', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    permissionsCache.clear();
  });

  describe('checkPermission', () => {
    
    test('SISTEMA debe tener acceso a cualquier store (solo validando existencia)', async () => {
      const sistemaUser = {
        id: 'user-1',
        isActive: true,
        storeId: null,
        rbacRole: { name: 'SISTEMA' }
      };

      mockPrisma.user.findUnique.mockResolvedValue(sistemaUser);
      mockPrisma.store.findUnique.mockResolvedValue({ id: 'store-1' });

      const result = await rbacService.checkPermission({
        userId: 'user-1',
        storeId: 'store-1',
        permission: 'product.delete'
      });

      expect(result).toBe(true);
      expect(mockPrisma.store.findUnique).toHaveBeenCalledWith({ where: { id: 'store-1' } });
    });

    test('SISTEMA sin storeId debe ser denegado', async () => {
      const sistemaUser = {
        id: 'user-1',
        isActive: true,
        storeId: null,
        rbacRole: { name: 'SISTEMA' }
      };

      mockPrisma.user.findUnique.mockResolvedValue(sistemaUser);

      const result = await rbacService.checkPermission({
        userId: 'user-1',
        storeId: null,
        permission: 'product.delete'
      });

      expect(result).toBe(false);
    });

    test('ADMINISTRADOR con storeId correcto y permiso debe ser permitido', async () => {
      const adminUser = {
        id: 'user-2',
        isActive: true,
        storeId: 'store-1',
        rbacRole: { 
          name: 'ADMINISTRADOR',
          permissions: [
            { permission: { name: 'product.create' } },
            { permission: { name: 'product.read' } }
          ]
        }
      };

      mockPrisma.user.findUnique.mockResolvedValue(adminUser);

      const result = await rbacService.checkPermission({
        userId: 'user-2',
        storeId: 'store-1',
        permission: 'product.create'
      });

      expect(result).toBe(true);
    });

    test('ADMINISTRADOR sin permiso debe ser denegado', async () => {
      const adminUser = {
        id: 'user-2',
        isActive: true,
        storeId: 'store-1',
        rbacRole: { 
          name: 'ADMINISTRADOR',
          permissions: [
            { permission: { name: 'product.read' } }
          ]
        }
      };

      mockPrisma.user.findUnique.mockResolvedValue(adminUser);

      const result = await rbacService.checkPermission({
        userId: 'user-2',
        storeId: 'store-1',
        permission: 'product.delete'
      });

      expect(result).toBe(false);
    });

    test('VENDEDOR intentando acceder a store diferente debe ser denegado', async () => {
      const vendedorUser = {
        id: 'user-3',
        isActive: true,
        storeId: 'store-1',
        rbacRole: { 
          name: 'VENDEDOR',
          permissions: [
            { permission: { name: 'sale.create' } }
          ]
        }
      };

      mockPrisma.user.findUnique.mockResolvedValue(vendedorUser);

      const result = await rbacService.checkPermission({
        userId: 'user-3',
        storeId: 'store-2', // Different store
        permission: 'sale.create'
      });

      expect(result).toBe(false);
    });

    test('Usuario inactivo debe ser denegado', async () => {
      const inactiveUser = {
        id: 'user-4',
        isActive: false,
        storeId: 'store-1',
        rbacRole: { name: 'ADMINISTRADOR' }
      };

      mockPrisma.user.findUnique.mockResolvedValue(inactiveUser);

      const result = await rbacService.checkPermission({
        userId: 'user-4',
        storeId: 'store-1',
        permission: 'product.create'
      });

      expect(result).toBe(false);
    });

    test('Usuario sin rol debe ser denegado', async () => {
      const userWithoutRole = {
        id: 'user-5',
        isActive: true,
        storeId: 'store-1',
        rbacRole: null
      };

      mockPrisma.user.findUnique.mockResolvedValue(userWithoutRole);

      const result = await rbacService.checkPermission({
        userId: 'user-5',
        storeId: 'store-1',
        permission: 'product.create'
      });

      expect(result).toBe(false);
    });

  });

  describe('getUserPermissions', () => {
    
    test('debe retornar permisos del usuario desde cache', async () => {
      const userWithPermissions = {
        id: 'user-1',
        rbacRole: { 
          name: 'VENDEDOR',
          permissions: [
            { permission: { name: 'sale.create' } },
            { permission: { name: 'sale.read' } }
          ]
        }
      };

      mockPrisma.user.findUnique.mockResolvedValue(userWithPermissions);

      // Primera llamada - desde DB
      const perms1 = await rbacService.getUserPermissions('user-1');
      expect(perms1).toEqual(['sale.create', 'sale.read']);

      // Segunda llamada - desde cache
      const perms2 = await rbacService.getUserPermissions('user-1');
      expect(perms2).toEqual(['sale.create', 'sale.read']);
      
      // Solo una llamada a DB
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

  });

});
