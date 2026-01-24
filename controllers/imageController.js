const cloudinary = require("../utils/cloudinary");
const prisma = require("../db/database.prisma");
const streamifier = require("streamifier");
const e = require("express");
const { reverseTranslate } = require("../utils/translator");

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
    let entityModel = dynamicKey.replace("Id", "");
    if(entityModel === "category") {
      entityModel = "categories";
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
      console.log('asdadas', {
        url: result.secure_url,
        altText: req.body.altText || "",
        isMain: req.body.isMain === "true" || false,
        order: Number(req.body.order ?? 0),
        [dynamicKey]: entityId, // ← súper dinámico
      },)
    // 3. Guardar imagen en DB
    const image = await prisma.image.create({
      data: {
        url: result.secure_url,
        altText: req.body.altText || "",
        isMain: req.body.isMain === "true" || false,
        order: Number(req.body.order ?? 0),
        [dynamicKey]: entityId, // ← súper dinámico
      },
    });

    // 4. Si la entidad no tiene profilePicture, setear la primera automáticamente
    const existing = await prisma[entityModel].findUnique({
      where: { id: entityId },
    });

    if (existing && !existing.profilePicture) {
      await prisma[entityModel].update({
        where: { id: entityId },
        data: { profilePicture: result.secure_url },
      });
    }

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

    const images = await prisma.image.findMany({
      where: { 
        [`${translatedEntity}Id`]: id // traer todas las imagenes de esa entidad
      },
      orderBy: { order: 'asc' }
    });

    if(!images || images.length === 0) {
      return res.status(404).json({ message: "No images found for this entityId" });
    }

    // marco todas las imagenes como NO Principales

    await prisma.image.updateMany({
      where: { [`${translatedEntity}Id`]: id},
      data : { isMain: false }
    });

    // marco la iamgen seleccionada como principal y con el order 0

    await prisma.image.update ({
      where: { id: imageId },
      data : {  
        order : 0, 
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

module.exports = { uploadImage, setMainImage };