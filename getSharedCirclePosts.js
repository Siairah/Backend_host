import express from "express";
import { Post, PostMedia, Like, Comment } from "./models/post.js";
import Profile from "./models/profile.js";
import { CircleMembership } from "./models/circle.js";

const router = express.Router();

// Get posts from circles shared between two users
router.get("/shared-circle-posts", async (req, res) => {
  try {
    const { viewer_id, profile_user_id } = req.query;

    if (!viewer_id || !profile_user_id) {
      return res.status(400).json({
        success: false,
        message: "Viewer ID and Profile User ID required",
      });
    }

    // Get circles that both users are members of
    const viewerCircles = await CircleMembership.find({ user: viewer_id }).select('circle');
    const profileUserCircles = await CircleMembership.find({ user: profile_user_id }).select('circle');

    const viewerCircleIds = viewerCircles.map(m => m.circle.toString());
    const profileUserCircleIds = profileUserCircles.map(m => m.circle.toString());

    // Find shared circles
    const sharedCircleIds = viewerCircleIds.filter(id => profileUserCircleIds.includes(id));

    if (sharedCircleIds.length === 0) {
      return res.json({
        success: true,
        posts: [],
        message: "No shared circles found",
      });
    }

    // Get posts by profile_user_id in shared circles
    const posts = await Post.find({
      user: profile_user_id,
      circle: { $in: sharedCircleIds },
      is_approved: true,
    })
      .sort({ createdAt: -1 })
      .populate("user", "email")
      .populate("circle", "name")
      .limit(50);

    // Get profile and media for each post
    const postDetails = await Promise.all(
      posts.map(async (post) => {
        const profile = await Profile.findOne({ user: post.user._id });
        const mediaFiles = await PostMedia.find({ post: post._id });
        const likeCount = await Like.countDocuments({ post: post._id });
        const commentCount = await Comment.countDocuments({ post: post._id, is_deleted: false });

        return {
          id: post._id.toString(),
          content: post.content,
          created_at: post.createdAt,
          like_count: likeCount,
          comment_count: commentCount,
          media_files: mediaFiles.map((media) => ({
            file: media.file,
            type: media.type,
          })),
          user: {
            id: post.user._id.toString(),
            email: post.user.email,
            fullName: profile?.full_name || "User",
            profilePic: profile?.profile_pic || "/images/default_profile.png",
          },
          circle: post.circle ? {
            id: post.circle._id.toString(),
            name: post.circle.name,
          } : null,
        };
      })
    );

    res.status(200).json({
      success: true,
      posts: postDetails,
    });
  } catch (error) {
    console.error("❌ Error fetching shared circle posts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch shared circle posts",
      error: error.message,
    });
  }
});

export default router;

