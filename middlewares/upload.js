const multer = require("multer");

const storage = multer.memoryStorage(); // usamos buffer para enviar a Cloudinary directamente
const upload = multer({ storage });

module.exports = upload;
