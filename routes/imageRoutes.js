const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload");
const { uploadImage, setMainImage, deleteImage, getImagesByEntity } = require("../controllers/imageController");
const { authMiddleware } = require("../middlewares/authMiddleware");

// Excepción: las imágenes se ven públicamente si es necesario, de lo contrario protegemos
router.post("/upload", authMiddleware, upload.single("file"), uploadImage);
router.get("/:entity/:id", getImagesByEntity); // Se permite obtener en público
router.put("/:id/set-main", authMiddleware, setMainImage);
router.delete("/:imageId", authMiddleware, deleteImage);

module.exports = router;
