import { Router } from "express";
import { Post, Comment } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import Profile from "./models/profile.js";

const router = Router();

// POST /add-comment/:post_id
router.post("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id, content } = req.body;

    if (!user_id || !content) {
      return res.status(400).json({ success: false, message: "User ID and content required" });
    }

    const post = await Post.findById(post_id).populate('circle');
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Circle gate: private circles require membership; public allows any authenticated user
    if (post.circle) {
      const circle = await Circle.findById(post.circle);
      if (circle && circle.visibility === 'private') {
        const isMember = await CircleMembership.exists({ circle: circle._id, user: user_id });
        if (!isMember) {
          return res.status(403).json({ success: false, message: "Join circle to comment" });
        }
      }
    }

    // Django logic: Comment.objects.create(user=request.user, post=post, content=content)
    const comment = await Comment.create({
      post: post_id,
      user: user_id,
      content: content
    });

    // Get user profile for response
    const profile = await Profile.findOne({ user: user_id });
    
    const commentCount = await Comment.countDocuments({ post: post_id, is_deleted: false });
    
    return res.status(201).json({
      status: 'success',
      user: profile?.full_name || 'User',
      profile_pic: profile?.profile_pic || '/images/default_profile.png',
      content: comment.content,
      created_at: comment.createdAt.toISOString(),
      comment_count: commentCount
    });

  } catch (error) {
    console.error(" Add comment error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /get-comments/:post_id ( post.comments.all().order_by('-created_at'))
router.get("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;

    //post.comments.all().order_by('-created_at')
    const comments = await Comment.find({ post: post_id, is_deleted: false })
      .populate('user')
      .sort({ createdAt: -1 }); //  orders by -created_at (newest first)

    const comments_data = await Promise.all(comments.map(async (comment) => {
      const profile = await Profile.findOne({ user: comment.user._id });
      
      // 'created_at': comment.created_at.strftime('%b %d, %Y %I:%M %p')
      const created_at = new Date(comment.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
      
      return {
        id: comment._id,
        user: profile?.full_name || 'User',
        profile_pic: profile?.profile_pic || '/images/default_profile.png',
        content: comment.content,
        created_at: created_at
      };
    }));

    return res.json({ comments: comments_data });

  } catch (error) {
    console.error(" Get comments error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

