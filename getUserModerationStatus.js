import { Router } from "express";
import Notification from "./models/notification.js";
import { ModerationQueue } from "./models/post.js";
import { PostReport } from "./models/post.js";
import Profile from "./models/profile.js";

const router = Router();

router.get("/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    const warnings = await Notification.find({
      recipient: user_id,
      circle: circle_id,
      notification_type: 'warning'
    })
      .populate('sender', 'email')
      .sort({ createdAt: -1 })
      .lean();

    const allFlaggedPosts = await ModerationQueue.find({
      user: user_id
    })
      .populate({
        path: 'post',
        populate: {
          path: 'circle'
        }
      })
      .sort({ createdAt: -1 })
      .lean();

    const flaggedPosts = allFlaggedPosts.filter(fp => {
      if (!fp.post) return false;
      const postCircleId = fp.post.circle?._id?.toString() || fp.post.circle?.toString();
      return postCircleId === circle_id;
    });

    const allReportsMade = await PostReport.find({
      reported_by: user_id
    })
      .populate({
        path: 'post',
        populate: {
          path: 'circle'
        }
      })
      .populate('reported_by', 'email')
      .sort({ createdAt: -1 })
      .lean();

    const reportsMade = allReportsMade.filter(rm => {
      if (!rm.post) return false;
      const postCircleId = rm.post.circle?._id?.toString() || rm.post.circle?.toString();
      return postCircleId === circle_id;
    });

    const allReportsReceived = await PostReport.find({})
      .populate({
        path: 'post',
        populate: {
          path: 'user circle'
        }
      })
      .populate('reported_by', 'email')
      .sort({ createdAt: -1 })
      .lean();

    const reportsReceived = allReportsReceived.filter(rr => {
      if (!rr.post) return false;
      const postUserId = rr.post.user?._id?.toString() || rr.post.user?.toString();
      const postCircleId = rr.post.circle?._id?.toString() || rr.post.circle?.toString();
      return postUserId === user_id && postCircleId === circle_id;
    });

    const formattedWarnings = await Promise.all(warnings.map(async (warn) => {
      let senderProfile = null;
      if (warn.sender) {
        const senderId = warn.sender._id || warn.sender;
        senderProfile = await Profile.findOne({ user: senderId });
      }

      return {
        id: warn._id.toString(),
        message: warn.message,
        created_at: warn.createdAt.toISOString(),
        acknowledged: warn.acknowledged || false,
        admin: senderProfile ? {
          id: (warn.sender._id || warn.sender).toString(),
          full_name: senderProfile.full_name || 'Admin',
          profile_pic: senderProfile.profile_pic || '/images/default_profile.png'
        } : null
      };
    }));

    const formattedFlaggedPosts = flaggedPosts.map((flag) => {
      return {
        id: flag._id.toString(),
        post_id: flag.post ? (flag.post._id || flag.post).toString() : null,
        reason: flag.reason || 'Flagged',
        created_at: flag.created_at ? flag.created_at.toISOString() : flag.createdAt.toISOString()
      };
    });

    const formattedReportsMade = reportsMade.map((report) => {
      return {
        id: report._id.toString(),
        post_id: report.post ? (report.post._id || report.post).toString() : null,
        reason: report.reason || 'Reported',
        created_at: report.created_at ? report.created_at.toISOString() : report.createdAt.toISOString(),
        resolved: report.resolved || false
      };
    });

    const formattedReportsReceived = await Promise.all(reportsReceived.map(async (report) => {
      let reporterProfile = null;
      if (report.reported_by) {
        const reporterId = report.reported_by._id || report.reported_by;
        reporterProfile = await Profile.findOne({ user: reporterId });
      }

      return {
        id: report._id.toString(),
        post_id: report.post ? (report.post._id || report.post).toString() : null,
        reason: report.reason || 'Reported',
        created_at: report.created_at ? report.created_at.toISOString() : report.createdAt.toISOString(),
        reported_by: reporterProfile ? {
          id: (report.reported_by._id || report.reported_by).toString(),
          full_name: reporterProfile.full_name || 'User',
          profile_pic: reporterProfile.profile_pic || '/images/default_profile.png'
        } : null
      };
    }));

    return res.json({
      success: true,
      warnings: formattedWarnings,
      flagged_posts: formattedFlaggedPosts,
      reports_made: formattedReportsMade,
      reports_received: formattedReportsReceived,
      stats: {
        warnings_count: formattedWarnings.length,
        flagged_posts_count: formattedFlaggedPosts.length,
        reports_made_count: formattedReportsMade.length,
        reports_received_count: formattedReportsReceived.length
      }
    });

  } catch (error) {
    console.error("❌ Get user moderation status error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ 
      success: false, 
      message: "Server error: " + sanitizeError(error)
    });
  }
});

export default router;

