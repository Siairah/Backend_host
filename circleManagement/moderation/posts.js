import { Router } from "express";
import mongoose from "mongoose";
import { Post, PostMedia, ModerationQueue, PostReport } from "../../models/post.js";
import { Circle } from "../../models/circle.js";
import Profile from "../../models/profile.js";
import { sendNotification } from "../../utils/notifications.js";
import { isCircleAdmin, safePopulateOptions } from "../utils.js";

const router = Router();

// Get pending posts
router.get("/pending-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const pendingPosts = await Post.find({
      circle: circle_id,
      is_approved: false
    })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const formattedPosts = await Promise.all(
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

    return res.json({ success: true, pending_posts: formattedPosts });
  } catch (error) {
    console.error("❌ Get pending posts error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Approve post
router.post("/approve-post/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, post.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    post.is_approved = true;
    await post.save();

    // Mark all reports for this post as resolved
    // Use the post's _id directly (ObjectId) to ensure correct matching
    const postIdToUse = post._id || post_id;
    
    try {
      const updateResult = await PostReport.updateMany(
        { 
          post: postIdToUse,
          resolved: false
        },
        { $set: { resolved: true } }
      );
      console.log(`✅ Marked ${updateResult.modifiedCount} report(s) as resolved for post ${post_id}`);
      
      // If no reports were updated, try with string format as fallback
      if (updateResult.modifiedCount === 0 && postIdToUse.toString() !== post_id) {
        const stringUpdateResult = await PostReport.updateMany(
          { 
            post: postIdToUse.toString(),
            resolved: false
          },
          { $set: { resolved: true } }
        );
        if (stringUpdateResult.modifiedCount > 0) {
          console.log(`✅ Marked ${stringUpdateResult.modifiedCount} report(s) as resolved using string format`);
        }
      }
    } catch (updateError) {
      console.error('❌ Error marking reports as resolved:', updateError);
      // Don't fail the request if report update fails
    }

    if (req.io && post.user) {
      try {
        const circle = await Circle.findById(post.circle);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        const userId = (post.user && post.user._id) ? (post.user._id.toString() || post.user._id) : (post.user?.toString() || post.user);
        
        if (userId) {
          await sendNotification({
            recipientId: userId,
            senderId: user_id,
            notificationType: 'post_approved',
            message: `${adminName} approved your post in ${circle?.name || 'the circle'}.`,
            postId: post._id?.toString() || post._id,
            circleId: post.circle?.toString() || post.circle,
            targetUrl: `/post/${post._id}`,
            io: req.io
          });
        }
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: "Post approved" });
  } catch (error) {
    console.error("❌ Approve post error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Reject post
router.post("/reject-post/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, post.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    // Get post owner before deleting
    const postOwnerId = post.user?._id?.toString() || post.user?.toString() || post.user;
    const circleId = post.circle?.toString() || post.circle;

    // Mark all reports for this post as resolved before deleting
    await PostReport.updateMany(
      { post: post_id },
      { $set: { resolved: true } }
    );

    await Post.deleteOne({ _id: post_id });

    // Create warning notification for community guidelines violation
    if (postOwnerId && circleId && req.io) {
      try {
        const { sendNotification } = await import('../../utils/notifications.js');
        const Profile = (await import('../../models/profile.js')).default;
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        const Circle = (await import('../../models/circle.js')).Circle;
        const circle = await Circle.findById(circleId);
        
        await sendNotification({
          recipientId: postOwnerId,
          senderId: user_id,
          notificationType: 'warning',
          message: `Your post in "${circle?.name || 'the circle'}" was removed for violating community guidelines. Please review and follow the community guidelines.`,
          circleId: circleId,
          targetUrl: `/circle/${circleId}`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending warning notification:', notifError);
      }
    }

    return res.json({ success: true, message: "Post rejected and deleted" });
  } catch (error) {
    console.error("❌ Reject post error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Get flagged posts
router.get("/flagged-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circlePosts = await Post.find({ circle: circle_id }).distinct('_id');
    const flaggedPosts = await ModerationQueue.find({
      post: { $in: circlePosts },
      reviewed_by_admin: false
    })
      .populate({
        path: 'post',
        populate: { path: 'user', ...safePopulateOptions },
        options: { strictPopulate: false }
      })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

    const formattedFlaggedPosts = await Promise.all(
      flaggedPosts.map(async (flagged) => {
        if (!flagged || !flagged.post || !flagged.post.user || !flagged.post.user._id || !flagged.user || !flagged.user._id) {
          return null;
        }
        try {
          const postUserId = flagged.post.user._id?.toString() || flagged.post.user._id;
          const flaggedUserId = flagged.user._id?.toString() || flagged.user._id;
          const postId = flagged.post._id?.toString() || flagged.post._id;
          
          const postProfile = await Profile.findOne({ user: postUserId });
          const flaggedProfile = await Profile.findOne({ user: flaggedUserId });
          const postMedia = await PostMedia.find({ post: postId });
          
          return {
            id: flagged._id?.toString() || flagged._id,
            post: {
              id: postId,
              content: flagged.post.content || '',
              user: {
                id: postUserId,
                email: flagged.post.user.email || 'Unknown',
                full_name: postProfile?.full_name || flagged.post.user.email || 'User',
                profile_pic: postProfile?.profile_pic || null
              },
              media_files: postMedia.map(m => ({ file: m.file, type: m.type }))
            },
            reason: flagged.reason || '',
            evidence_image: flagged.image || null,
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

    return res.json({ success: true, flagged_posts: formattedFlaggedPosts });
  } catch (error) {
    console.error("❌ Get flagged posts error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Get reported posts
router.get("/reported-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circlePosts = await Post.find({ circle: circle_id }).distinct('_id');
    const reportedPosts = await PostReport.find({
      post: { $in: circlePosts },
      resolved: false
    })
      .populate({
        path: 'post',
        populate: { path: 'user', ...safePopulateOptions },
        options: { strictPopulate: false }
      })
      .populate({ path: 'reported_by', ...safePopulateOptions })
      .lean();

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
          const postId = report.post._id?.toString() || report.post._id;
          
          const postProfile = await Profile.findOne({ user: postUserId });
          const reporterProfile = await Profile.findOne({ user: reporterId });
          
          return {
            id: report._id?.toString() || report._id,
            post: {
              id: postId,
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

    return res.json({ success: true, reported_posts: formattedReportedPosts });
  } catch (error) {
    console.error("❌ Get reported posts error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Approve flagged post
router.post("/approve-flagged/:moderation_id", async (req, res) => {
  try {
    const { moderation_id } = req.params;
    const { user_id } = req.body;

    const moderationEntry = await ModerationQueue.findById(moderation_id).populate({
      path: 'post',
      options: { strictPopulate: false }
    });
    
    if (!moderationEntry) {
      return res.status(404).json({ success: false, message: "Flagged post not found" });
    }

    const post = moderationEntry.post;
    if (!post || !post.circle) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, post.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    post.is_approved = true;
    await post.save();

    moderationEntry.reviewed_by_admin = true;
    await moderationEntry.save();

    // Mark all reports for this post as resolved
    const postId = post._id?.toString() || post._id;
    if (postId) {
      await PostReport.updateMany(
        { post: postId },
        { $set: { resolved: true } }
      );
    }

    if (req.io && post.user) {
      try {
        const circle = await Circle.findById(post.circle);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        const userId = (post.user && post.user._id) ? (post.user._id.toString() || post.user._id) : (post.user?.toString() || post.user);
        
        if (userId) {
          await sendNotification({
            recipientId: userId,
            senderId: user_id,
            notificationType: 'post_approved',
            message: `${adminName} approved your flagged post in ${circle?.name || 'the circle'}.`,
            postId: post._id?.toString() || post._id,
            circleId: post.circle?.toString() || post.circle,
            targetUrl: `/post/${post._id}`,
            io: req.io
          });
        }
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: "Flagged post approved" });
  } catch (error) {
    console.error("❌ Approve flagged post error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Reject flagged post
router.post("/reject-flagged/:moderation_id", async (req, res) => {
  try {
    const { moderation_id } = req.params;
    const { user_id } = req.body;

    const moderationEntry = await ModerationQueue.findById(moderation_id).populate({
      path: 'post',
      options: { strictPopulate: false }
    });
    
    if (!moderationEntry) {
      return res.status(404).json({ success: false, message: "Flagged post not found" });
    }

    const post = moderationEntry.post;
    if (!post || !post.circle) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, post.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    // Get post owner before deleting
    const postOwnerId = post.user?._id?.toString() || post.user?.toString() || post.user;
    const circleId = post.circle?.toString() || post.circle;
    const postId = post._id?.toString() || post._id;

    // Mark all reports for this post as resolved before deleting
    if (postId) {
      await PostReport.updateMany(
        { post: postId },
        { $set: { resolved: true } }
      );
      await Post.deleteOne({ _id: post._id });
    }
    moderationEntry.reviewed_by_admin = true;
    await moderationEntry.save();

    // Create warning notification for community guidelines violation
    if (postOwnerId && circleId && req.io) {
      try {
        const { sendNotification } = await import('../../utils/notifications.js');
        const Profile = (await import('../../models/profile.js')).default;
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        const Circle = (await import('../../models/circle.js')).Circle;
        const circle = await Circle.findById(circleId);
        
        await sendNotification({
          recipientId: postOwnerId,
          senderId: user_id,
          notificationType: 'warning',
          message: `Your flagged post in "${circle?.name || 'the circle'}" was removed for violating community guidelines. Please review and follow the community guidelines.`,
          circleId: circleId,
          targetUrl: `/circle/${circleId}`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending warning notification:', notifError);
      }
    }

    return res.json({ success: true, message: "Flagged post rejected and deleted" });
  } catch (error) {
    console.error("❌ Reject flagged post error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

