const cloudinary = require("../utils/cloudinary");
const prisma = require("../db/database.prisma");
const streamifier = require("streamifier");
const e = require("express");
const { reverseTranslate } = require("../utils/translator");

/**
 * Asegura que una entidad tenga exactamente una imagen principal y que
 * el campo profilePicture esté sincronizado.
 */
const ensureEntityHasMainImage = async (entityModel, entityId, entityKey) => {
  try {
    const images = await prisma.image.findMany({
      where: { [entityKey]: entityId },
      orderBy: [
        { isMain: "desc" },
        { order: "asc" },
        { createdAt: "asc" },
      ],
    });

    if (images.length === 0) {
      await prisma[entityModel].update({
        where: { id: entityId },
        data: { profilePicture: null },
      });
      return;
    }

    const newMain = images[0];

    // Promover si no es main
    if (!newMain.isMain) {
      await prisma.image.update({
        where: { id: newMain.id },
        data: { isMain: true, order: 0 },
      });
    }

    // Limpiar otros mains si existieran
    await prisma.image.updateMany({
      where: {
        [entityKey]: entityId,
        id: { not: newMain.id },
        isMain: true,
      },
      data: { isMain: false },
    });

    // Sincronizar profilePicture
    await prisma[entityModel].update({
      where: { id: entityId },
      data: { profilePicture: newMain.url },
    });
  } catch (err) {
    console.error(`Error in ensureEntityHasMainImage for ${entityModel}:`, err);
  }
};

const uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // 1. Detectar dinámicamente qué entidad está enviando la imagen
    const dynamicKey = Object.keys(req.body).find((key) =>
      key.endsWith("Id")
    );

    if (!dynamicKey) {
      return res.status(400).json({ message: "No entity ID provided" });
    }

    const entityId = req.body[dynamicKey];

    // el modelo se obtiene así: productId -> product
    let entityModel = reverseTranslate(dynamicKey.replace("Id", ""));

    // 1.5 Verificar propiedad de la entidad antes de consumir recursos en Cloudinary (Anti-IDOR)
    // SISTEMA: acceso global irrestricto.
    // User entities: ADMINISTRADOR puede gestionar usuarios de su tienda, VENDEDOR solo su propio avatar.
    // Resto: la entidad debe pertenecer a la tienda del usuario autenticado.
    if (!req.user.isSistema) {
      if (entityModel === 'user') {
        if (req.user.rbacRole === 'ADMINISTRADOR') {
          const targetUser = await prisma.user.findFirst({ where: { id: entityId, storeId: req.user.storeId } });
          if (!targetUser) return res.status(403).json({ message: 'No tenés permiso para gestionar imágenes de este usuario.' });
        } else {
          if (entityId !== req.user.id) return res.status(403).json({ message: 'Solo podés gestionar tu propio avatar.' });
        }
      } else if (entityModel === 'store') {
        // Un administrador solo puede editar SU tienda
        if (entityId !== req.user.storeId) {
          return res.status(403).json({ message: 'No tenés permiso para gestionar imágenes de esta tienda.' });
        }
      } else {
        const ownerEntity = await prisma[entityModel].findFirst({ where: { id: entityId, storeId: req.user.storeId } });
        if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para gestionar imágenes de esta entidad.' });
      }
    }

    // 2. Subir a Cloudinary
    const uploadToCloudinary = () =>
      new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: "stock-controll" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      });

    const result = await uploadToCloudinary();

    // 3. Guardar imagen en DB (incluyendo cloudinaryId para poder eliminar luego)
    const image = await prisma.image.create({
      data: {
        url: result.secure_url,
        cloudinaryId: result.public_id,
        altText: req.body.altText || "",
        isMain: req.body.isMain === "true" || false,
        order: Number(req.body.order ?? 0),
        [dynamicKey]: entityId,
      },
    });

    // 4. Asegurar que haya una imagen principal seteada (automaticamente selecciona la mas vieja/primera si no hay)
    await ensureEntityHasMainImage(entityModel, entityId, dynamicKey);

    res.status(200).json(image);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const setMainImage = async (req, res) => {
  try {
    const { id } = req.params;
    const { newProfilePicture, entity, imageId } = req.body;


    if (!id || !newProfilePicture || !entity || !imageId) {
      return res.status(400).json({ message: "Missing required fields" });
    }


    const translatedEntity = reverseTranslate(entity);

    // Verificar propiedad de la entidad (Anti-IDOR)
    if (!req.user.isSistema) {
      if (translatedEntity === 'user') {
        if (req.user.rbacRole === 'ADMINISTRADOR') {
          const targetUser = await prisma.user.findFirst({ where: { id, storeId: req.user.storeId } });
          if (!targetUser) return res.status(403).json({ message: 'No tenés permiso para gestionar imágenes de este usuario.' });
        } else {
          if (id !== req.user.id) return res.status(403).json({ message: 'Solo podés gestionar tu propio avatar.' });
        }
      } else {
        const ownerEntity = await prisma[translatedEntity].findFirst({ where: { id, storeId: req.user.storeId } });
        if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para gestionar imágenes de esta entidad.' });
      }
    }

    const images = await prisma.image.findMany({
      where: {
        [`${translatedEntity}Id`]: id // traer todas las imagenes de esa entidad
      },
      orderBy: { order: 'asc' }
    });

    if (!images || images.length === 0) {
      return res.status(404).json({ message: "No images found for this entityId" });
    }

    // marco todas las imagenes como NO Principales

    await prisma.image.updateMany({
      where: { [`${translatedEntity}Id`]: id },
      data: { isMain: false }
    });

    // marco la iamgen seleccionada como principal y con el order 0

    await prisma.image.update({
      where: { id: imageId },
      data: {
        order: 0,
        isMain: true
      }
    });

    // reordeno las otras imagenes

    let orderCounter = 1;

    for (const img of images) {
      if (img.id !== imageId) {
        await prisma.image.update({
          where: { id: img.id },
          data: { order: orderCounter }
        });
        orderCounter++;
      }
    }


    // 4. Actualizar el profilePicture en la entidad principal
    await prisma[translatedEntity].update({
      where: { id },
      data: { profilePicture: newProfilePicture }
    });

    res.status(200).json({ message: "Main image updated and reordered successfully" });

  } catch (err) {
    console.error("Set main image error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const deleteImage = async (req, res) => {
  try {
    const { imageId } = req.params;

    if (!imageId) {
      return res.status(400).json({ message: "Image ID is required" });
    }

    // 1. Buscar la imagen a eliminar
    const image = await prisma.image.findUnique({ where: { id: imageId } });

    if (!image) {
      return res.status(404).json({ message: "Image not found" });
    }

    // 2. Determinar a qué entidad pertenece
    const entityKeys = ["productId", "userId", "clientId", "supplierId", "categoryId", "storeId"];
    let entityKey = null;
    let entityId = null;

    for (const key of entityKeys) {
      if (image[key]) {
        entityKey = key;
        entityId = image[key];
        break;
      }
    }

    // 2.5 Verificar propiedad antes de eliminar (Anti-IDOR)
    if (!req.user.isSistema && entityKey && entityId) {
      const entityModelForCheck = entityKey === 'categoryId' ? 'categories' : entityKey.replace('Id', '');
      if (entityModelForCheck === 'user') {
        if (req.user.rbacRole === 'ADMINISTRADOR') {
          const targetUser = await prisma.user.findFirst({ where: { id: entityId, storeId: req.user.storeId } });
          if (!targetUser) return res.status(403).json({ message: 'No tenés permiso para eliminar imágenes de este usuario.' });
        } else {
          if (entityId !== req.user.id) return res.status(403).json({ message: 'Solo podés eliminar tu propio avatar.' });
        }
      } else {
        const ownerEntity = await prisma[entityModelForCheck].findFirst({ where: { id: entityId, storeId: req.user.storeId } });
        if (!ownerEntity) return res.status(403).json({ message: 'No tenés permiso para eliminar imágenes de esta entidad.' });
      }
    }

    // 3. Eliminar la imagen de la DB
    await prisma.image.delete({ where: { id: imageId } });

    // 3.5 Eliminar de Cloudinary si tenemos el public_id
    if (image.cloudinaryId) {
      try {
        await cloudinary.uploader.destroy(image.cloudinaryId);
        console.log(`[Cloudinary] Imagen eliminada: ${image.cloudinaryId}`);
      } catch (cloudErr) {
        // No fatal: el registro ya fue eliminado de la DB
        console.warn(`[Cloudinary] No se pudo eliminar ${image.cloudinaryId}:`, cloudErr.message);
      }
    } else {
      console.warn(`[Cloudinary] Imagen sin cloudinaryId (legacy), no se eliminó de Cloudinary. URL: ${image.url}`);
    }

    if (entityKey && entityId) {
      const entityModel = reverseTranslate(entityKey.replace("Id", ""));
      await ensureEntityHasMainImage(entityModel, entityId, entityKey);
    }

    res.status(200).json({ message: "Image deleted successfully" });
  } catch (err) {
    console.error("Delete image error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

const getImagesByEntity = async (req, res) => {
  try {
    const { entity, id } = req.params;
    const translatedEntity = reverseTranslate(entity);
    const entityKey = `${translatedEntity}Id`;

    const images = await prisma.image.findMany({
      where: { [entityKey]: id },
      orderBy: { order: "asc" },
    });

    res.status(200).json(images);
  } catch (err) {
    console.error("Get images error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

module.exports = { uploadImage, setMainImage, deleteImage, getImagesByEntity };