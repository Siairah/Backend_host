import { Router } from "express";
import { Post, PostMedia, Like, Comment } from "./models/post.js";
import Profile from "./models/profile.js";
import { Circle } from "./models/circle.js";

const router = Router();

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;

    const post = await Post.findById(id)
      .populate('user')
      .populate('circle');

    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    // Get post author profile
    const authorProfile = await Profile.findOne({ user: post.user._id });

    // Get media files
    const mediaFiles = await PostMedia.find({ post: post._id });

    // Get likes
    const likeCount = await Like.countDocuments({ post: post._id });
    // Only check if user_id is valid (not null, undefined, or "null" string)
    const userLiked = (user_id && user_id !== 'null' && user_id !== 'undefined') 
      ? await Like.exists({ post: post._id, user: user_id }) 
      : false;
    
    // Get recent likers (first 5 for display)
    const recentLikes = await Like.find({ post: post._id })
      .populate('user')
      .limit(5);

    // Get comments (latest first, limit 20)
    const comments = await Comment.find({ post: post._id, is_deleted: false })
      .populate('user')
      .sort({ createdAt: -1 })
      .limit(20);

    // Get comment author profiles
    const commentProfiles = await Profile.find({ 
      user: { $in: comments.map(c => c.user._id) } 
    });

    const profileMap = {};
    commentProfiles.forEach(profile => {
      profileMap[profile.user.toString()] = profile;
    });

    // Format comments with profiles
    const formattedComments = comments.map(comment => {
      const profile = profileMap[comment.user._id.toString()];
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
    });

    // Format recent likers
    const likerProfiles = await Profile.find({ 
      user: { $in: recentLikes.map(l => l.user._id) } 
    });

    const likerProfileMap = {};
    likerProfiles.forEach(profile => {
      likerProfileMap[profile.user.toString()] = profile;
    });

    const formattedLikers = recentLikes.map(like => {
      const profile = likerProfileMap[like.user._id.toString()];
      return {
        id: like.user._id,
        email: like.user.email,
        full_name: profile?.full_name || 'User',
        profile_pic: profile?.profile_pic || '/images/default_profile.png'
      };
    });

    return res.json({
      success: true,
      post: {
        id: post._id,
        content: post.content,
        created_at: post.createdAt,
        user: {
          id: post.user._id,
          email: post.user.email,
          full_name: authorProfile?.full_name || 'User',
          profile_pic: authorProfile?.profile_pic || '/images/default_profile.png'
        },
        circle: post.circle ? {
          id: post.circle._id,
          name: post.circle.name,
          cover_image: post.circle.cover_image
        } : null,
        media_files: mediaFiles.map(m => ({ file: m.file, type: m.type })),
        like_count: likeCount,
        user_liked: !!userLiked,
        comment_count: comments.length,
        recent_likers: formattedLikers,
        comments: formattedComments
      }
    });

  } catch (error) {
    console.error("❌ Get post by ID error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
