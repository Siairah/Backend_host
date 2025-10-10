import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostMedia } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import User from "./models/models.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /create-post (Django logic)
router.post("/", upload.array("media", 10), async (req, res) => {
  try {
    const { user_id, circle_id, content } = req.body;
    
    console.log('📝 Create post request:', { user_id, circle_id, content: content?.substring(0, 50), mediaCount: req.files?.length || 0 });

    if (!user_id || !content) {
      return res.status(400).json({ success: false, message: "User ID and content required" });
    }

    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Django logic: Check circle membership
    let is_approved = false;
    if (circle_id) {
      const circle = await Circle.findById(circle_id);
      if (!circle) {
        return res.status(404).json({ success: false, message: "Circle not found" });
      }

      const membership = await CircleMembership.findOne({ user: user_id, circle: circle_id });
      if (!membership) {
        return res.status(403).json({ success: false, message: "You must be a member of this circle" });
      }

      // Auto-approve if admin (Django logic)
      is_approved = membership.is_admin;
    }

    const post = new Post({
      user: user_id,
      circle: circle_id || null,
      content: content,
      is_approved: is_approved
    });

    await post.save();
    console.log('✅ Post created:', post._id);

    // Upload media if provided
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        try {
          const uploaded = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "posts", resource_type: "auto" }, 
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
            stream.end(file.buffer);
          });

          await PostMedia.create({
            post: post._id,
            file: uploaded.secure_url,
            type: file.mimetype.startsWith('video/') ? 'video' : 'image'
          });
        } catch (err) {
          console.error('Media upload error:', err);
        }
      }
    }

    const mediaFiles = await PostMedia.find({ post: post._id });

    return res.status(201).json({
      success: true,
      message: is_approved ? "Post created" : "Post created, awaiting approval",
      post: {
        id: post._id,
        content: post.content,
        created_at: post.createdAt,
        media_files: mediaFiles.map(m => ({ file: m.file, type: m.type }))
      }
    });

  } catch (error) {
    console.error("❌ Create post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

