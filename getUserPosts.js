import express from "express";
import { User, Post, Profile, PostMedia } from "./models/index.js";

const router = express.Router();

router.get("/user-posts/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    console.log("📦 Fetching posts for user:", userId);

    // Find all posts by this user
    const posts = await Post.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("user", "email");

    console.log(`✅ Found ${posts.length} posts for user ${userId}`);

    // Get user profile and media for each post
    const postDetails = await Promise.all(
      posts.map(async (post) => {
        const profile = await Profile.findOne({ user: post.user._id });
        const mediaFiles = await PostMedia.find({ post: post._id });

        return {
          id: post._id,
          content: post.content,
          created_at: post.createdAt,
          like_count: 0, // Will be calculated from likes collection
          comment_count: 0, // Will be calculated from comments collection
          media_files: mediaFiles.map((media) => ({
            file: media.file,
            type: media.type,
          })),
          user: {
            id: post.user._id,
            email: post.user.email,
            fullName: profile?.full_name || "User",
            profilePic: profile?.profile_pic || "/images/default_profile.png",
          },
        };
      })
    );

    res.status(200).json({
      success: true,
      posts: postDetails,
    });
  } catch (error) {
    console.error("❌ Error fetching user posts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user posts",
      error: error.message,
    });
  }
});

export default router;

