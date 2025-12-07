import { Router } from "express";
import { Post, Like } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import Profile from "./models/profile.js";
import { sendNotification } from "./utils/notifications.js";

const router = Router();

router.post("/:post_id", async (req, res) => {
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

    if (post.circle) {
      const circle = await Circle.findById(post.circle);
      if (circle && circle.visibility === 'private') {
        const isMember = await CircleMembership.exists({ circle: circle._id, user: user_id });
        if (!isMember) {
          return res.status(403).json({ success: false, message: "Join circle to like" });
        }
      }
    }

   
    let like = await Like.findOne({ post: post_id, user: user_id });
    let created = false;
    let liked = false;

    if (!like) {
      like = await Like.create({ post: post_id, user: user_id });
      created = true;
      liked = true;

      const postOwnerId = post.user._id.toString();
      if (postOwnerId !== user_id && req.io) {
        const senderProfile = await Profile.findOne({ user: user_id });
        const senderName = senderProfile?.full_name || 'Someone';
        
        await sendNotification({
          recipientId: postOwnerId,
          senderId: user_id,
          notificationType: 'like',
          message: `${senderName} liked your post.`,
          postId: post_id,
          targetUrl: `/post/${post_id}`,
          io: req.io
        });
      }
    } else {
      await Like.deleteOne({ _id: like._id });
      liked = false;
    }

    const likeCount = await Like.countDocuments({ post: post_id });

    return res.json({
      success: true,
      liked: liked,
      like_count: likeCount,
      created: created
    });

  } catch (error) {
    console.error("❌ Toggle like error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
