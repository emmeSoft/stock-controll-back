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
    const { newProfilePicture, entity } = req.body;
    

    if (!id || !newProfilePicture) {
      return res.status(400).json({ message: "Missing required fields" });
    }


    const translatedEntity = reverseTranslate(entity);
    // Update the profilePicture field for the entity that has this image as main
    // First, find the image to get the entity type and entity ID
    const entityData = await prisma[translatedEntity].findUnique({
      where: { id },


    });

    console.log('entityData', entityData);

    const entityUpdateData = await prisma[translatedEntity].update({
      where: { id },
      data: { profilePicture: newProfilePicture },
    });

    console.log('entityUpdateData', entityUpdateData);


    // Determine the entity model and entity ID dynamically
    // let entityModel = null;
    // let entityId = null;

    // if (image.clientId) {
    //   entityModel = "client";
    //   entityId = image.clientId;
    // } else if (image.userId) {
    //   entityModel = "user";
    //   entityId = image.userId;
    // } else if (image.supplierId) {
    //   entityModel = "supplier";
    //   entityId = image.supplierId;
    // } else if (image.productId) {
    //   entityModel = "product";
    //   entityId = image.productId;
    // } else if (image.categoryId) {
    //   entityModel = "categories";
    //   entityId = image.categoryId;
    // }

    // if (!entityModel || !entityId) {
    //   return res.status(400).json({ message: "Entity not found for this image" });
    // }

    // // Update the profilePicture field for the entity
    // await prisma[entityModel].update({
    //   where: { id: entityId },
    //   data: { profilePicture },
    // });

    // Update all images for this entity to set isMain to false except the current one
    // await prisma.image.updateMany({
    //   where: {
    //     [entityModel + "Id"]: entityId,
    //     id: { not: id },
    //   },
    //   data: { isMain: false },
    // });

    // // Set the current image as main
    // await prisma.image.update({
    //   where: { id },
    //   data: { isMain: true },
    // });

    res.status(200).json({ message: "Main image updated successfully" });
  } catch (err) {
    console.error("Set main image error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

module.exports = { uploadImage, setMainImage };