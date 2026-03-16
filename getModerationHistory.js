import { Router } from "express";
import Notification from "./models/notification.js";
import Profile from "./models/profile.js";
import { CircleMembership } from "./models/circle.js";

const router = Router();

router.get("/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    const membership = await CircleMembership.findOne({
      user: user_id,
      circle: circle_id,
      is_admin: true
    });

    if (!membership) {
      return res.status(403).json({ 
        success: false, 
        message: "You are not authorized to view moderation history" 
      });
    }

    const moderationTypes = [
      'ban',
      'unban',
      'restriction',
      'post_approved',
      'post_removed',
      'post_flagged',
      'post_reported',
      'approval',
      'rejection',
      'user_restricted',
      'user_banned',
      'user_unbanned'
    ];

    const notifications = await Notification.find({
      circle: circle_id,
      notification_type: { $in: moderationTypes }
    })
      .populate('sender', 'email')
      .populate('recipient', 'email')
      .populate('post', 'content')
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    const moderationHistory = await Promise.all(notifications.map(async (notif) => {
      let adminProfile = null;
      if (notif.sender) {
        const senderId = notif.sender._id || notif.sender;
        adminProfile = await Profile.findOne({ user: senderId });
      }

      let targetUserProfile = null;
      if (notif.recipient) {
        const recipientId = notif.recipient._id || notif.recipient;
        targetUserProfile = await Profile.findOne({ user: recipientId });
      }

      let actionType = notif.notification_type;
      let actionLabel = '';
      let icon = '';
      
      switch (notif.notification_type) {
        case 'ban':
        case 'user_banned':
          actionType = 'ban';
          actionLabel = 'Banned User';
          icon = 'fa-ban';
          break;
        case 'unban':
        case 'user_unbanned':
          actionType = 'unban';
          actionLabel = 'Unbanned User';
          icon = 'fa-unlock';
          break;
        case 'restriction':
        case 'user_restricted':
          actionType = 'restrict';
          actionLabel = 'Restricted User';
          icon = 'fa-user-lock';
          break;
        case 'post_approved':
        case 'approval':
          actionType = 'approve';
          actionLabel = 'Approved Post';
          icon = 'fa-check-circle';
          break;
        case 'post_removed':
        case 'rejection':
          actionType = 'reject';
          actionLabel = 'Rejected Post';
          icon = 'fa-times-circle';
          break;
        case 'post_flagged':
        case 'post_flagged_auto':
          actionType = 'flag';
          actionLabel = 'Flagged Post';
          icon = 'fa-flag';
          break;
        case 'post_reported':
          actionType = 'report';
          actionLabel = 'Reported Post';
          icon = 'fa-exclamation-triangle';
          break;
        default:
          actionLabel = 'Moderation Action';
          icon = 'fa-shield-alt';
      }

      return {
        id: notif._id.toString(),
        type: actionType,
        action_label: actionLabel,
        icon: icon,
        target_user: targetUserProfile ? {
          id: (notif.recipient._id || notif.recipient).toString(),
          full_name: targetUserProfile.full_name || 'User',
          profile_pic: targetUserProfile.profile_pic || '/images/default_profile.png'
        } : null,
        admin: adminProfile ? {
          id: (notif.sender._id || notif.sender).toString(),
          full_name: adminProfile.full_name || 'Admin',
          profile_pic: adminProfile.profile_pic || '/images/default_profile.png'
        } : null,
        message: notif.message,
        post_id: notif.post ? (notif.post._id || notif.post).toString() : null,
        post_content: notif.post ? (notif.post.content || '').substring(0, 100) : null,
        created_at: notif.createdAt.toISOString()
      };
    }));

    return res.json({
      success: true,
      moderation_history: moderationHistory,
      total: moderationHistory.length
    });

  } catch (error) {
    console.error("❌ Get moderation history error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error: " + error.message 
    });
  }
});

export default router;
