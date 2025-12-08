import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostMedia } from "./models/post.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.put("/:post_id", upload.array("media", 10), async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id, content } = req.body;

    if (!user_id || !content) {
      return res.status(400).json({ success: false, message: "User ID and content required" });
    }

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    if (post.user.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "You can only edit your own posts" });
    }

    post.content = content;
    await post.save();

    if (req.files && req.files.length > 0) {
      const oldMedia = await PostMedia.find({ post: post_id });
      for (const media of oldMedia) {
        const urlParts = media.file.split('/');
        const publicId = urlParts.slice(-2).join('/').split('.')[0];
        try {
          await cloudinary.uploader.destroy(publicId);
        } catch (err) {
          console.error('Error deleting old media:', err);
        }
      }
      await PostMedia.deleteMany({ post: post_id });

      const mediaFiles = [];
      for (const file of req.files) {
        const result = await new Promise((resolve, reject) => {
          const uploadStream = cloudinary.uploader.upload_stream(
            { folder: 'posts' },
            (error, result) => {
              if (error) reject(error);
              else resolve(result);
            }
          );
          uploadStream.end(file.buffer);
        });

        const mediaType = file.mimetype.startsWith('video/') ? 'video' : 'image';
        const postMedia = await PostMedia.create({
          post: post_id,
          file: result.secure_url,
          type: mediaType
        });
        mediaFiles.push({
          file: postMedia.file,
          type: postMedia.type
        });
      }
    }

    return res.json({
      success: true,
      message: "Post updated successfully",
      post: {
        id: post._id.toString(),
        content: post.content,
        updated_at: post.updatedAt
      }
    });

  } catch (error) {
    console.error("❌ Edit post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
