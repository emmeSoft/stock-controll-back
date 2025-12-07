const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload");
const { uploadImage, setMainImage } = require("../controllers/imageController");

router.post("/upload", upload.single("file"), uploadImage);
router.put("/:id/set-main", setMainImage)

module.exports = router;
