import { Router } from "express";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostMedia, Comment, Like } from "./models/post.js";
import { CircleMembership } from "./models/circle.js";

const router = Router();

router.delete("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const post = await Post.findById(post_id).populate('circle');
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const isOwner = post.user.toString() === user_id;

    let isAdmin = false;
    if (post.circle) {
      const membership = await CircleMembership.findOne({
        user: user_id,
        circle: post.circle._id,
        is_admin: true
      });
      isAdmin = !!membership;
    }

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: "You can only delete your own posts or be a circle admin" 
      });
    }

    const mediaFiles = await PostMedia.find({ post: post_id });
    for (const media of mediaFiles) {
      try {
        const urlParts = media.file.split('/');
        const publicId = urlParts.slice(-2).join('/').split('.')[0];
        await cloudinary.uploader.destroy(publicId);
      } catch (err) {
        console.error('Error deleting media from Cloudinary:', err);
      }
    }

    await PostMedia.deleteMany({ post: post_id });
    await Comment.deleteMany({ post: post_id });
    await Like.deleteMany({ post: post_id });

    await Post.deleteOne({ _id: post_id });

    return res.json({
      success: true,
      message: "Post deleted successfully"
    });

  } catch (error) {
    console.error("❌ Delete post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
