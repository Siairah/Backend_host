import { Router } from "express";
import { Post, Comment } from "./models/post.js";
import Profile from "./models/profile.js";

const router = Router();

// POST /add-comment/:post_id (Django logic)
router.post("/:post_id", async (req, res) => {
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

    const comment = await Comment.create({
      post: post_id,
      user: user_id,
      content: content
    });

    const profile = await Profile.findOne({ user: user_id });
    const commentCount = await Comment.countDocuments({ post: post_id, is_deleted: false });

    return res.status(201).json({
      success: true,
      comment: {
        id: comment._id,
        content: comment.content,
        created_at: comment.createdAt,
        user: {
          id: user_id,
          full_name: profile?.full_name || 'User',
          profile_pic: profile?.profile_pic || '/images/default_profile.png'
        }
      },
      comment_count: commentCount
    });

  } catch (error) {
    console.error("❌ Add comment error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /get-comments/:post_id (Django logic)
router.get("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;

    const comments = await Comment.find({ post: post_id, is_deleted: false })
      .populate('user')
      .sort({ createdAt: 1 });

    const commentsWithProfiles = await Promise.all(comments.map(async (comment) => {
      const profile = await Profile.findOne({ user: comment.user._id });
      
      return {
        id: comment._id,
        content: comment.content,
        created_at: comment.createdAt,
        user: {
          id: comment.user._id,
          email: comment.user.email,
          full_name: profile?.full_name || 'User',
          profile_pic: profile?.profile_pic || '/images/default_profile.png'
        }
      };
    }));

    return res.json({ success: true, comments: commentsWithProfiles });

  } catch (error) {
    console.error("❌ Get comments error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

