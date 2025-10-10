import { Router } from "express";
import { Post, PostMedia, Like, Comment } from "./models/post.js";
import Profile from "./models/profile.js";

const router = Router();

// GET /get-posts (Django logic: only approved posts)
router.get("/", async (req, res) => {
  try {
    const { circle_id, user_id } = req.query;
    
    let query = { is_approved: true }; // Django logic: only approved
    
    if (circle_id) {
      query.circle = circle_id;
    }

    const posts = await Post.find(query)
      .populate('user')
      .populate('circle')
      .sort({ createdAt: -1 })
      .limit(50);

    const postDetails = await Promise.all(posts.map(async (post) => {
      const profile = await Profile.findOne({ user: post.user._id });
      const mediaFiles = await PostMedia.find({ post: post._id });
      const likeCount = await Like.countDocuments({ post: post._id });
      const userLiked = user_id ? await Like.exists({ post: post._id, user: user_id }) : false;
      const commentCount = await Comment.countDocuments({ post: post._id, is_deleted: false });

      return {
        id: post._id,
        content: post.content,
        created_at: post.createdAt,
        user: {
          id: post.user._id,
          email: post.user.email,
          full_name: profile?.full_name || 'User',
          profile_pic: profile?.profile_pic || '/images/default_profile.png'
        },
        circle: post.circle ? {
          id: post.circle._id,
          name: post.circle.name
        } : null,
        media_files: mediaFiles.map(m => ({ file: m.file, type: m.type })),
        like_count: likeCount,
        user_liked: !!userLiked,
        comment_count: commentCount
      };
    }));

    return res.json({ success: true, posts: postDetails });

  } catch (error) {
    console.error("❌ Get posts error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

