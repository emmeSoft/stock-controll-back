const categoriesServices = require('../services/categoriesServices');
const excelService = require('../services/excelService');


const createCategories = async (req, res) => {
  const dataCategories = req.body;

  try {
    const result = await categoriesServices.create(dataCategories, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getAllCategories = async (req, res) => {
  try {
    const result = await categoriesServices.getAll(req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const getCategoryById = async (req, res) => {
  const { id } = req.params;  

  try {
    const result = await categoriesServices.getById(id, req.user);
    res.json(result);
  } catch (error) {
    res.status(401).json({ message: error.message });
  }
};

const updateCategories = async (req, res) => {
  const { id } = req.params;
  const dataCategories = req.body;

  // Redundant Ownership Validation (Anti-IDOR)
  if (!req.user.isSistema) {
    const prisma = require('../db/database.prisma');
    const ownerEntity = await prisma.categories.findFirst({ where: { id, storeId: req.user.storeId } });
    if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para modificar esta categoría.' });
  }

  try {
    const result = await categoriesServices.update(id, dataCategories, req.user);
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
    const ownerEntity = await prisma.categories.findFirst({ where: { id, storeId: req.user.storeId } });
    if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para gestionar el estado de esta categoría.' });
  }

  try {
    const result = await categoriesServices.setActiveStatus(id, isActive, req.user);
    res.json(result);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

const exportCategories = async (req, res) => {
  try {
    const categories = await categoriesServices.getAll(req.user);
    
    const columns = [
      { header: 'Nombre', key: 'name', width: 25 },
      { header: 'Descripción', key: 'description', width: 35 },
      { header: 'Prefijo Barcode', key: 'barcodePrefix', width: 15 },
      { header: 'Estado', key: 'status', width: 15 }
    ];

    const data = categories.map(c => ({
      name: c.name,
      description: c.description || 'N/A',
      barcodePrefix: c.barcodePrefix || 'N/A',
      status: c.isActive ? 'Activo' : 'Baja'
    }));

    await excelService.generateExcel({
      res,
      filename: `categorias_${new Date().toISOString().split('T')[0]}.xlsx`,
      worksheetName: 'Categorías',
      columns,
      data
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createCategories, getAllCategories, getCategoryById, updateCategories, toggleActiveStatus, exportCategories };
