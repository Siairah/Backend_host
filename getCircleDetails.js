import { Router } from "express";
import { Circle, CircleMembership, CircleJoinRequest, CircleRestriction, CircleBanList } from "./models/circle.js";
import { Post, PostMedia, Like, Comment } from "./models/post.js";
import Profile from "./models/profile.js";

const router = Router();

// GET /circle-details/:id (Django logic)
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id } = req.query;
    
    console.log(`🔍 Fetching circle details: ${id}, user: ${user_id}`);

    const circle = await Circle.findById(id).populate('created_by');
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    // Check if user is member
    let is_member = false;
    let is_admin = false;
    if (user_id) {
      const membership = await CircleMembership.findOne({ user: user_id, circle: id });
      is_member = !!membership;
      is_admin = membership ? membership.is_admin : false;
    }

    // Get creator profile
    const creatorProfile = await Profile.findOne({ user: circle.created_by._id });

    // Get members count
    const memberCount = await CircleMembership.countDocuments({ circle: id });

    // Get members
    const memberships = await CircleMembership.find({ circle: id })
      .populate('user')
      .sort({ joined_at: -1 })
      .limit(10);

    const members = await Promise.all(memberships.map(async (membership) => {
      const profile = await Profile.findOne({ user: membership.user._id });
      return {
        id: membership.user._id,
        email: membership.user.email,
        full_name: profile?.full_name || 'User',
        profile_pic: profile?.profile_pic || '/images/default_profile.png',
        is_admin: membership.is_admin
      };
    }));

    // PUBLIC circles: anyone can see posts
    // PRIVATE circles: only members can see posts
    let posts = [];
    if (circle.visibility === 'public' || is_member || is_admin) {
      const postDocs = await Post.find({ 
        circle: id, 
        is_approved: true
      })
        .populate('user')
        .sort({ createdAt: -1 })
        .limit(50);

      posts = await Promise.all(postDocs.map(async (post) => {
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
          media_files: mediaFiles.map(m => ({ file: m.file, type: m.type })),
          like_count: likeCount,
          user_liked: !!userLiked,
          comment_count: commentCount
        };
      }));
    }

    // Check if user is restricted or banned
    let is_restricted = false;
    let is_banned = false;
    let restricted_until = null;
    
    if (user_id) {
      // Check restriction
      const restriction = await CircleRestriction.findOne({
        user: user_id,
        circle: id,
        restricted_until: { $gt: new Date() }
      });
      is_restricted = !!restriction;
      restricted_until = restriction?.restricted_until || null;
      
      // Check ban
      is_banned = await CircleBanList.exists({ user: user_id, circle: id });
    }

    // Admin-specific counts
    let adminCounts = {};
    if (is_admin) {
      const pending_posts_count = await Post.countDocuments({ circle: id, is_approved: false });
      const reported_posts_count = 0; // TODO: Implement when PostReport model is added
      const flagged_posts_count = 0;  // TODO: Implement when ModerationQueue model is added
      const pending_users_count = await CircleJoinRequest.countDocuments({ circle: id, is_approved: false });
      
      adminCounts = {
        pending_posts_count,
        reported_posts_count,
        flagged_posts_count,
        pending_users_count,
        total_pending: pending_posts_count + reported_posts_count + flagged_posts_count + pending_users_count
      };
    }

    return res.json({
      success: true,
      circle: {
        id: circle._id,
        name: circle.name,
        description: circle.description,
        rules: circle.rules,
        cover_image: circle.cover_image,
        visibility: circle.visibility,
        created_by: {
          id: circle.created_by._id,
          email: circle.created_by.email,
          full_name: creatorProfile?.full_name || 'User',
          profile_pic: creatorProfile?.profile_pic || '/images/default_profile.png'
        },
        member_count: memberCount,
        is_member: is_member,
        is_admin: is_admin,
        members: members,
        posts: posts,
        is_restricted: is_restricted,
        is_banned: !!is_banned,
        restricted_until: restricted_until,
        ...adminCounts // Spread admin counts if is_admin
      }
    });

  } catch (error) {
    console.error("❌ Get circle details error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

