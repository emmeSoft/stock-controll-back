const express = require("express");
const router = express.Router();
const multer = require("multer");
const upload = require("../middlewares/upload");
const { uploadImage, setMainImage, deleteImage, getImagesByEntity } = require("../controllers/imageController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Wrapper que captura errores de Multer y los traduce a respuestas claras
const uploadWithErrorHandling = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          message: "El archivo supera el tamaño máximo permitido (5MB).",
        });
      }
      return res.status(400).json({
        message: `Error al procesar el archivo: ${err.message}`,
      });
    }

    // Error del fileFilter (tipo no permitido)
    if (err) {
      return res.status(415).json({
        message: err.message || "Tipo de archivo no permitido.",
      });
    }
  });
};

// Excepción: las imágenes se ven públicamente si es necesario, de lo contrario protegemos
router.post("/upload", authMiddleware, uploadWithErrorHandling, uploadImage);
router.get("/:entity/:id", authMiddleware, getImagesByEntity); // Se requiere estar logueado para ver imágenes
router.put("/:id/set-main", authMiddleware, setMainImage);
router.delete("/:imageId", authMiddleware, deleteImage);

module.exports = router;
