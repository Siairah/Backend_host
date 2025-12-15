import { Router } from "express";
import Notification from "./models/notification.js";
import Profile from "./models/profile.js";

const router = Router();

console.log(" Notification routes module loaded");

router.get("/test", (req, res) => {
  return res.json({ success: true, message: "Notifications route is working!" });
});

router.get("/", async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const notifications = await Notification.find({ recipient: user_id })
      .populate('sender', 'email')
      .populate('post', 'content')
      .populate('circle', 'name')
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    const formattedNotifications = await Promise.all(notifications.map(async (notif) => {
      let senderData = null;
      if (notif.sender) {
        const senderUserId = notif.sender._id || notif.sender;
        const profile = await Profile.findOne({ user: senderUserId });
        senderData = {
          id: senderUserId.toString(),
          full_name: profile?.full_name || notif.sender.email || 'User',
          profile_pic: profile?.profile_pic || '/images/default_profile.png'
        };
      }
      
      return {
        id: notif._id.toString(),
        notification_type: notif.notification_type,
        message: notif.message,
        sender: senderData,
        post_id: notif.post ? (notif.post._id || notif.post).toString() : null,
        circle_id: notif.circle ? (notif.circle._id || notif.circle).toString() : null,
        target_url: notif.target_url,
        is_read: notif.is_read,
        acknowledged: notif.acknowledged || false,
        created_at: notif.createdAt.toISOString()
      };
    }));

    return res.json({ success: true, notifications: formattedNotifications });

  } catch (error) {
    console.error("❌ Get notifications error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

router.post("/mark-read/:notification_id", async (req, res) => {
  try {
    const { notification_id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const notification = await Notification.findById(notification_id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.recipient.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    notification.is_read = true;
    await notification.save();

    return res.json({ success: true, message: "Notification marked as read" });

  } catch (error) {
    console.error("❌ Mark notification as read error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

router.post("/mark-all-read", async (req, res) => {
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    await Notification.updateMany(
      { recipient: user_id, is_read: false },
      { $set: { is_read: true } }
    );

    return res.json({ success: true, message: "All notifications marked as read" });

  } catch (error) {
    console.error("❌ Mark all notifications as read error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

router.get("/unread-count", async (req, res) => {
  try {
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const count = await Notification.countDocuments({
      recipient: user_id,
      is_read: false
    });

    return res.json({ success: true, count });

  } catch (error) {
    console.error("❌ Get unread count error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Acknowledge warning (for moderation messages)
router.post("/acknowledge-warning/:notification_id", async (req, res) => {
  try {
    const { notification_id } = req.params;
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const notification = await Notification.findById(notification_id);
    if (!notification) {
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    if (notification.recipient.toString() !== user_id) {
      return res.status(403).json({ success: false, message: "Unauthorized" });
    }

    // Only allow acknowledging warning type notifications
    if (notification.notification_type !== 'warning') {
      return res.status(400).json({ success: false, message: "Only warnings can be acknowledged" });
    }

    notification.acknowledged = true;
    notification.is_read = true; // Also mark as read
    await notification.save();

    return res.json({ success: true, message: "Warning acknowledged" });

  } catch (error) {
    console.error("❌ Acknowledge warning error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Get unacknowledged warnings for a user
router.get("/warnings/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }

    const warnings = await Notification.find({
      recipient: user_id,
      circle: circle_id,
      notification_type: 'warning',
      acknowledged: false
    })
      .populate('sender', 'email')
      .populate('circle', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const formattedWarnings = await Promise.all(warnings.map(async (warning) => {
      let senderData = null;
      if (warning.sender) {
        const senderUserId = warning.sender._id || warning.sender;
        const profile = await Profile.findOne({ user: senderUserId });
        senderData = {
          id: senderUserId.toString(),
          full_name: profile?.full_name || warning.sender.email || 'Admin',
          profile_pic: profile?.profile_pic || '/images/default_profile.png'
        };
      }
      
      return {
        id: warning._id.toString(),
        message: warning.message,
        sender: senderData,
        circle_id: warning.circle ? (warning.circle._id || warning.circle).toString() : null,
        circle_name: warning.circle?.name || null,
        target_url: warning.target_url,
        acknowledged: warning.acknowledged || false,
        created_at: warning.createdAt.toISOString()
      };
    }));

    return res.json({ success: true, warnings: formattedWarnings });

  } catch (error) {
    console.error("❌ Get warnings error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;
