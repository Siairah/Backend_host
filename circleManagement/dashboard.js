import { Router } from "express";
import { Circle, CircleMembership, CircleJoinRequest } from "../models/circle.js";
import { Post, ModerationQueue, PostReport } from "../models/post.js";
import Profile from "../models/profile.js";
import { isCircleAdmin, safePopulateOptions } from "./utils.js";

const router = Router();

// Get management dashboard data
router.get("/manage/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized to manage this circle" });
    }

    const pendingRequests = await CircleJoinRequest.find({
      circle: circle_id,
      is_approved: false
    })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const members = await CircleMembership.find({ circle: circle_id })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const adminCount = await CircleMembership.countDocuments({ circle: circle_id, is_admin: true });

    const pendingPosts = await Post.find({
      circle: circle_id,
      is_approved: false
    })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const allCirclePosts = await Post.find({ circle: circle_id }).distinct('_id');
    
    const flaggedPosts = await ModerationQueue.find({
      post: { $in: allCirclePosts },
      reviewed_by_admin: false
    })
      .populate({
        path: 'post',
        populate: { path: 'user', ...safePopulateOptions },
        options: { strictPopulate: false }
      })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const reportedPosts = await PostReport.find({
      post: { $in: allCirclePosts },
      resolved: false
    })
      .populate({
        path: 'post',
        populate: { path: 'user', ...safePopulateOptions },
        options: { strictPopulate: false }
      })
      .populate({ path: 'reported_by', ...safePopulateOptions })
      .lean();

    const formattedRequests = await Promise.all(
      pendingRequests.map(async (req) => {
        if (!req || !req.user || !req.user._id) return null;
        try {
          const userId = req.user._id?.toString() || req.user._id;
          const profile = await Profile.findOne({ user: userId });
          return {
            id: req._id?.toString() || req._id,
            user: {
              id: userId,
              email: req.user.email || 'Unknown',
              full_name: profile?.full_name || req.user.email || 'User',
              profile_pic: profile?.profile_pic || null
            },
            message: req.message || '',
            requested_at: req.requested_at
          };
        } catch (error) {
          console.error('Error processing request:', error);
          return null;
        }
      })
    ).then(requests => requests.filter(r => r !== null));

    const formattedMembers = await Promise.all(
      members.map(async (member) => {
        if (!member || !member.user || !member.user._id) return null;
        try {
          const userId = member.user._id?.toString() || member.user._id;
          const profile = await Profile.findOne({ user: userId });
          return {
            id: member._id?.toString() || member._id,
            user: {
              id: userId,
              email: member.user.email || 'Unknown',
              full_name: profile?.full_name || member.user.email || 'User',
              profile_pic: profile?.profile_pic || null
            },
            is_admin: member.is_admin || false,
            joined_at: member.joined_at
          };
        } catch (error) {
          console.error('Error processing member:', error);
          return null;
        }
      })
    ).then(members => members.filter(m => m !== null));

    const formattedPendingPosts = await Promise.all(
      pendingPosts.map(async (post) => {
        if (!post || !post.user || !post.user._id) return null;
        try {
          const userId = post.user._id?.toString() || post.user._id;
          const profile = await Profile.findOne({ user: userId });
          return {
            id: post._id?.toString() || post._id,
            content: post.content || '',
            created_at: post.created_at || post.createdAt,
            user: {
              id: userId,
              email: post.user.email || 'Unknown',
              full_name: profile?.full_name || post.user.email || 'User',
              profile_pic: profile?.profile_pic || null
            },
            media_files: []
          };
        } catch (error) {
          console.error('Error processing pending post:', error);
          return null;
        }
      })
    ).then(posts => posts.filter(p => p !== null));

    const formattedFlaggedPosts = await Promise.all(
      flaggedPosts.map(async (flagged) => {
        if (!flagged || !flagged.post || !flagged.post.user || !flagged.post.user._id || !flagged.user || !flagged.user._id) {
          return null;
        }
        try {
          const postUserId = flagged.post.user._id?.toString() || flagged.post.user._id;
          const flaggedUserId = flagged.user._id?.toString() || flagged.user._id;
          const postProfile = await Profile.findOne({ user: postUserId });
          const flaggedProfile = await Profile.findOne({ user: flaggedUserId });
          return {
            id: flagged._id?.toString() || flagged._id,
            post: {
              id: flagged.post._id?.toString() || flagged.post._id,
              content: flagged.post.content || '',
              user: {
                id: postUserId,
                email: flagged.post.user.email || 'Unknown',
                full_name: postProfile?.full_name || flagged.post.user.email || 'User',
                profile_pic: postProfile?.profile_pic || null
              }
            },
            reason: flagged.reason || '',
            flagged_by: {
              id: flaggedUserId,
              email: flagged.user.email || 'Unknown',
              full_name: flaggedProfile?.full_name || flagged.user.email || 'User',
              profile_pic: flaggedProfile?.profile_pic || null
            },
            created_at: flagged.createdAt || flagged.created_at
          };
        } catch (error) {
          console.error('Error processing flagged post:', error);
          return null;
        }
      })
    ).then(posts => posts.filter(p => p !== null));

    const formattedReportedPosts = await Promise.all(
      reportedPosts.map(async (report) => {
        // Filter out reports where post doesn't exist or is null
        if (!report || !report.post || !report.post._id || !report.post.user || !report.post.user._id || !report.reported_by || !report.reported_by._id) {
          // If post was deleted, mark report as resolved
          if (report && report._id && !report.post) {
            try {
              await PostReport.updateOne(
                { _id: report._id },
                { $set: { resolved: true } }
              );
            } catch (err) {
              console.error('Error marking deleted post report as resolved:', err);
            }
          }
          return null;
        }
        try {
          const postUserId = report.post.user._id?.toString() || report.post.user._id;
          const reporterId = report.reported_by._id?.toString() || report.reported_by._id;
          const postProfile = await Profile.findOne({ user: postUserId });
          const reporterProfile = await Profile.findOne({ user: reporterId });
          return {
            id: report._id?.toString() || report._id,
            post: {
              id: report.post._id?.toString() || report.post._id,
              content: report.post.content || '',
              user: {
                id: postUserId,
                email: report.post.user.email || 'Unknown',
                full_name: postProfile?.full_name || report.post.user.email || 'User',
                profile_pic: postProfile?.profile_pic || null
              }
            },
            reason: report.reason || '',
            reported_by: {
              id: reporterId,
              email: report.reported_by.email || 'Unknown',
              full_name: reporterProfile?.full_name || report.reported_by.email || 'User',
              profile_pic: reporterProfile?.profile_pic || null
            },
            created_at: report.createdAt || report.created_at
          };
        } catch (error) {
          console.error('Error processing reported post:', error);
          return null;
        }
      })
    ).then(posts => posts.filter(p => p !== null));

    return res.json({
      success: true,
      circle: {
        id: circle._id?.toString() || circle._id,
        name: circle.name,
        description: circle.description,
        cover_image: circle.cover_image,
        visibility: circle.visibility
      },
      pending_requests: formattedRequests,
      members: formattedMembers,
      pending_posts: formattedPendingPosts,
      flagged_posts: formattedFlaggedPosts,
      reported_posts: formattedReportedPosts,
      admin_count: adminCount,
      pending_posts_count: formattedPendingPosts.length,
      flagged_posts_count: formattedFlaggedPosts.length,
      reported_posts_count: formattedReportedPosts.length,
      total_pending: formattedPendingPosts.length + formattedFlaggedPosts.length + formattedReportedPosts.length + formattedRequests.length
    });
  } catch (error) {
    console.error("❌ Get circle management error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

