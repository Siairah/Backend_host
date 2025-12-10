import express from "express";
import { User, Post, Profile, PostMedia } from "./models/index.js";

const router = express.Router();

router.get("/user-gallery/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("🖼️ Fetching gallery for user:", userId);

    // Find all posts by this user
    const posts = await Post.find({ user: userId })
      .sort({ createdAt: -1 });

    console.log(`✅ Found ${posts.length} posts for user ${userId}`);

    // Get all media files for these posts
    const postIds = posts.map(post => post._id);
    const mediaFiles = await PostMedia.find({ post: { $in: postIds } })
      .sort({ createdAt: -1 });

    // Map media files to gallery items
    const galleryItems = mediaFiles.map((media) => {
      const post = posts.find(p => p._id.toString() === media.post.toString());
      return {
        id: media._id,
        file: media.file,
        type: media.type,
        post_id: media.post,
        created_at: post?.createdAt || media.createdAt,
      };
    });

    console.log(`🎨 Total gallery items: ${galleryItems.length}`);

    res.status(200).json({
      success: true,
      gallery: galleryItems,
      count: galleryItems.length,
    });
  } catch (error) {
    console.error("❌ Error fetching user gallery:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user gallery",
      error: error.message,
    });
  }
});

export default router;

