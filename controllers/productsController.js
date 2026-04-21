const productsServices = require('../services/productsServices');
const excelService = require('../services/excelService');

const createProduct = async (req, res) => {
  const dataProduct = req.body;

  if (!dataProduct.categoryId) {
    throw new Error("El producto debe tener una categoría");
  }


  try {
    const result = await productsServices.create(dataProduct, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllProducts = async (req, res) => {
  try {
    const result = await productsServices.getAll(req.user, req.query);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getProductById = async (req, res) => {
  const { id } = req.params;

  try {
    const result = await productsServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateProduct = async (req, res) => {
  const { id } = req.params;
  const dataProduct = req.body;

  // Redundant Ownership Validation (Anti-IDOR)
  if (!req.user.isSistema) {
    const prisma = require('../db/database.prisma');
    const ownerEntity = await prisma.product.findFirst({ where: { id, storeId: req.user.storeId } });
    if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para modificar este producto.' });
  }

  try {
    const result = await productsServices.update(id, dataProduct, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const toggleActiveStatus = async (req, res) => {
  const { id } = req.params;
  const { isActive } = req.body;

  if (typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Parámetro isActive inválido" });
  }

  // Redundant Ownership Validation (Anti-IDOR)
  if (!req.user.isSistema) {
    const prisma = require('../db/database.prisma');
    const ownerEntity = await prisma.product.findFirst({ where: { id, storeId: req.user.storeId } });
    if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para gestionar el estado de este producto.' });
  }

  try {
    const result = await productsServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const adjustStock = async (req, res) => {
  const { id } = req.params;
  const { amount, description } = req.body;

  if (amount === undefined || typeof amount !== 'number') {
    return res.status(400).json({ message: "La cantidad (amount) es obligatoria y debe ser un número" });
  }

  if (!description || typeof description !== 'string' || description.trim() === '') {
    return res.status(400).json({ message: "El motivo (description) es obligatorio" });
  }

  // Redundant Ownership Validation (Anti-IDOR)
  if (!req.user.isSistema) {
    const prisma = require('../db/database.prisma');
    const ownerEntity = await prisma.product.findFirst({ where: { id, storeId: req.user.storeId } });
    if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para ajustar stock de este producto.' });
  }

  try {
    const result = await productsServices.adjustStock(id, amount, description, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportProducts = async (req, res) => {
  try {
    const products = await productsServices.getAll(req.user, req.query);
    
    const columns = [
      { header: 'Código', key: 'barcode', width: 15 },
      { header: 'Nombre', key: 'name', width: 30 },
      { header: 'Categoría', key: 'category', width: 20 },
      { header: 'Stock', key: 'stock', width: 10 },
      { header: 'Precio', key: 'price', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = products.map(p => ({
      barcode: p.barcode || 'N/A',
      name: p.name,
      category: p.category ? p.category.name : 'Sin Categoría',
      stock: p.stock,
      price: p.price,
      status: p.isActive ? 'Activo' : 'Inactivo'
    }));

    await excelService.generateExcel({
      res,
      filename: `productos_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Productos',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createProduct, getAllProducts, getProductById, updateProduct, toggleActiveStatus, adjustStock, exportProducts };
