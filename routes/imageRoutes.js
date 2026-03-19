const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload");
const { uploadImage, setMainImage, deleteImage, getImagesByEntity } = require("../controllers/imageController");

router.post("/upload", upload.single("file"), uploadImage);
router.get("/:entity/:id", getImagesByEntity);
router.put("/:id/set-main", setMainImage);
router.delete("/:imageId", deleteImage);

module.exports = router;
