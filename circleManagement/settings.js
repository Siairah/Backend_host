import { Router } from "express";
import multer from "multer";
import cloudinary from "../cloudinaryConfig.js";
import { Circle } from "../models/circle.js";
import { isCircleAdmin } from "./utils.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

// Update circle settings
router.put("/update/:circle_id", upload.single("cover_image"), async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id, name, description, rules, visibility } = req.body;

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    if (name) circle.name = name.trim();
    if (description !== undefined) circle.description = description;
    if (rules !== undefined) circle.rules = rules;
    if (visibility) circle.visibility = visibility;

    if (req.file) {
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "circles" },
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        circle.cover_image = uploaded.secure_url;
      } catch (err) {
        console.error('Cover image upload error:', err);
      }
    }

    await circle.save();

    return res.json({
      success: true,
      message: "Circle updated successfully",
      circle: {
        id: circle._id?.toString() || circle._id,
        name: circle.name,
        description: circle.description,
        rules: circle.rules,
        cover_image: circle.cover_image,
        visibility: circle.visibility
      }
    });
  } catch (error) {
    console.error("❌ Update circle error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

