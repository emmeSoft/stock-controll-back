const cloudinary = require("../utils/cloudinary");
const prisma = require("../db/database.prisma");

const uploadImage = async (req, res) => {
  try {
    const { productId, userId, categoryId, altText = "", isMain = false } = req.body;

    if (!req.file) return res.status(400).json({ message: "No file uploaded" });

    const result = await cloudinary.uploader.upload_stream(
      { folder: "stock-controll" },
      async (error, result) => {
        if (error) return res.status(500).json({ message: "Cloudinary error", error });

        const image = await prisma.image.create({
          data: {
            url: result.secure_url,
            altText,
            isMain: isMain === "true", 
            product: productId ? { connect: { id: productId } } : undefined,
            user: userId ? { connect: { id: userId } } : undefined,
            category: categoryId ? { connect: { id: categoryId } } : undefined,
          },
        });

        res.status(200).json(image);
      }
    );

    // Pipea el archivo al stream
    const streamifier = require("streamifier");
    streamifier.createReadStream(req.file.buffer).pipe(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

module.exports = { uploadImage };
