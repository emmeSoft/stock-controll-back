const cloudinary = require("../utils/cloudinary");
const prisma = require("../db/database.prisma");
const streamifier = require("streamifier");

const uploadImage = async (req, res) => {
  try {
    const { productId, userId, categoryId, altText = "", isMain = false, order = 0 } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    // Creamos una promesa para usar upload_stream correctamente
    const uploadToCloudinary = () => {
      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          { folder: "stock-controll" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );

        streamifier.createReadStream(req.file.buffer).pipe(uploadStream);
      });
    };

    // Subimos la imagen a Cloudinary
    const result = await uploadToCloudinary();
    console.log("Cloudinary upload result:", result);
    // Guardamos en la base de datos
    const image = await prisma.image.create({
      data: {
        url: result.secure_url,
        altText,
        isMain: isMain === "true" || isMain === true,
        order: Number(order),
        product: productId ? { connect: { id: productId } } : undefined,
        user: userId ? { connect: { id: userId } } : undefined,
        category: categoryId ? { connect: { id: categoryId } } : undefined,
      },
    });

    res.status(200).json(image);
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

module.exports = { uploadImage };
