const multer = require("multer");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
    const allowedMimeTypes = ["image/jpeg", "image/png", "image/webp"];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp"];
    
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf("."));
    
    // Validar tanto el MimeType como la extensión del archivo (MED-003)
    const isMimeValid = allowedMimeTypes.includes(file.mimetype);
    const isExtensionValid = allowedExtensions.includes(fileExtension);

    if (isMimeValid && isExtensionValid) {
        cb(null, true);
    } else {
        cb(new Error("Tipo de archivo no permitido. Solo se aceptan imágenes (JPG, PNG, WEBP) con extensiones válidas."), false);
    }
};

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter
});

module.exports = upload;
