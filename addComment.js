import { Router } from "express";
import { Post, Comment } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import Profile from "./models/profile.js";
import { sendNotification } from "./utils/notifications.js";

const router = Router();

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

    if (post.circle) {
      const circle = await Circle.findById(post.circle);
      if (circle && circle.visibility === 'private') {
        const isMember = await CircleMembership.exists({ circle: circle._id, user: user_id });
        if (!isMember) {
          return res.status(403).json({ success: false, message: "Join circle to comment" });
        }
      }
    }

    const comment = await Comment.create({
      post: post_id,
      user: user_id,
      content: content
    });

    const profile = await Profile.findOne({ user: user_id });
    
    const commentCount = await Comment.countDocuments({ post: post_id, is_deleted: false });

    const postOwnerId = post.user._id.toString();
    if (postOwnerId !== user_id && req.io) {
      const senderName = profile?.full_name || 'Someone';
      
      await sendNotification({
        recipientId: postOwnerId,
        senderId: user_id,
        notificationType: 'comment',
        message: `${senderName} commented on your post.`,
        postId: post_id,
        targetUrl: `/post/${post_id}`,
        io: req.io
      });
    }
    
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

router.get("/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;

    const comments = await Comment.find({ post: post_id, is_deleted: false })
      .populate('user')
      .sort({ createdAt: -1 });

    const comments_data = await Promise.all(comments.map(async (comment) => {
      const profile = await Profile.findOne({ user: comment.user._id });
      
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
