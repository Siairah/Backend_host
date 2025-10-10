import { Router } from "express";
import { Post, Like } from "./models/post.js";

const router = Router();

// POST /toggle-like/:post_id (Django logic: toggle like/unlike)
router.post("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Django logic: get_or_create pattern
    const existingLike = await Like.findOne({ post: post_id, user: user_id });

    let liked = false;
    
    if (existingLike) {
      // Unlike
      await Like.deleteOne({ _id: existingLike._id });
      liked = false;
    } else {
      // Like
      await Like.create({ post: post_id, user: user_id });
      liked = true;
    }

    const likeCount = await Like.countDocuments({ post: post_id });

    return res.json({
      success: true,
      liked: liked,
      like_count: likeCount
    });

  } catch (error) {
    console.error("❌ Toggle like error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

