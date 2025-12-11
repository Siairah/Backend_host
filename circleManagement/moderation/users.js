import { Router } from "express";
import { Circle, CircleMembership, CircleRestriction, CircleBanList } from "../../models/circle.js";
import Profile from "../../models/profile.js";
import { sendNotification } from "../../utils/notifications.js";
import { isCircleAdmin, safePopulateOptions } from "../utils.js";

const router = Router();

// Restrict user
router.post("/restrict-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id, days = 7, reason } = req.body;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const restrictionReason = (reason && reason.trim()) ? reason.trim() : 'Violated community guidelines. Please review and follow the community guidelines to avoid further restrictions.';

    const existingRestriction = await CircleRestriction.findOne({
      user: target_user_id,
      circle: circle_id,
      restricted_until: { $gt: new Date() }
    });

    if (existingRestriction) {
      return res.status(400).json({ success: false, message: "User is already restricted in this circle" });
    }

    const restrictedUntil = new Date();
    restrictedUntil.setDate(restrictedUntil.getDate() + days);

    await CircleRestriction.create({
      user: target_user_id,
      circle: circle_id,
      reason: restrictionReason,
      restricted_until: restrictedUntil
    });

    if (req.io) {
      try {
        const circle = await Circle.findById(circle_id);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        
        await sendNotification({
          recipientId: target_user_id,
          senderId: user_id,
          notificationType: 'warning',
          message: `${adminName} restricted you from ${circle?.name || 'the circle'} for ${days} days due to: ${restrictionReason}. Please review and follow the community guidelines.`,
          circleId: circle_id,
          targetUrl: `/circle/${circle_id}`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: `User restricted for ${days} days` });
  } catch (error) {
    console.error("❌ Restrict user error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Unrestrict user
router.post("/unrestrict-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id } = req.body;

    if (!user_id || !circle_id || !target_user_id) {
      return res.status(400).json({ success: false, message: "Missing required fields" });
    }

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized to remove restrictions" });
    }

    // First, clean up any expired restrictions
    const now = new Date();
    await CircleRestriction.deleteMany({
      circle: circle_id,
      restricted_until: { $lte: now }
    });

    // Check for active restriction (not expired)
    const existingRestriction = await CircleRestriction.findOne({ 
      user: target_user_id, 
      circle: circle_id,
      restricted_until: { $gt: now }
    });

    // If no active restriction found, check if there was any restriction at all
    if (!existingRestriction) {
      // Check if restriction exists but expired
      const expiredRestriction = await CircleRestriction.findOne({ 
        user: target_user_id, 
        circle: circle_id 
      });
      
      if (expiredRestriction) {
        // Already expired, just delete it and return success
        await CircleRestriction.deleteOne({ 
          user: target_user_id, 
          circle: circle_id 
        });
        return res.json({ success: true, message: "Restriction has already expired and been removed" });
      }
      
      return res.status(404).json({ success: false, message: "No restriction found for this user" });
    }

    const deleted = await CircleRestriction.deleteMany({ 
      user: target_user_id, 
      circle: circle_id 
    });

    if (deleted.deletedCount === 0) {
      return res.status(500).json({ success: false, message: "Failed to remove restriction" });
    }

    if (req.io) {
      try {
        const circle = await Circle.findById(circle_id);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        
        await sendNotification({
          recipientId: target_user_id,
          senderId: user_id,
          notificationType: 'unrestrict',
          message: `${adminName} removed your restriction from ${circle?.name || 'the circle'}. You can now access the circle again.`,
          circleId: circle_id,
          targetUrl: `/circle/${circle_id}`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: "User restriction has been removed successfully" });
  } catch (error) {
    console.error("❌ Unrestrict user error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Ban user
router.post("/ban-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id, reason } = req.body;

    const banReason = (reason && reason.trim()) ? reason.trim() : 'Violated community guidelines. Please review and follow the community guidelines.';

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const existingBan = await CircleBanList.findOne({ user: target_user_id, circle: circle_id });
    if (existingBan) {
      return res.status(400).json({ success: false, message: "User is already banned from this circle" });
    }

    await CircleMembership.deleteOne({ user: target_user_id, circle: circle_id });

    await CircleBanList.create({
      user: target_user_id,
      circle: circle_id,
      reason: banReason
    });

    if (req.io) {
      try {
        const circle = await Circle.findById(circle_id);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        
        await sendNotification({
          recipientId: target_user_id,
          senderId: user_id,
          notificationType: 'warning',
          message: `${adminName} banned you from ${circle?.name || 'the circle'} due to: ${banReason}. Please review and follow the community guidelines.`,
          circleId: circle_id,
          targetUrl: `/circles`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: "User has been banned from the circle" });
  } catch (error) {
    console.error("❌ Ban user error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Unban user
router.post("/unban-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id } = req.body;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    await CircleBanList.deleteOne({ user: target_user_id, circle: circle_id });

    const existingMembership = await CircleMembership.findOne({
      user: target_user_id,
      circle: circle_id
    });

    if (!existingMembership) {
      await CircleMembership.create({
        user: target_user_id,
        circle: circle_id,
        is_admin: false,
        joined_at: new Date()
      });
    }

    if (req.io) {
      try {
        const circle = await Circle.findById(circle_id);
        const adminProfile = await Profile.findOne({ user: user_id });
        const adminName = adminProfile?.full_name || 'Admin';
        
        await sendNotification({
          recipientId: target_user_id,
          senderId: user_id,
          notificationType: 'unban',
          message: `${adminName} unbanned you from ${circle?.name || 'the circle'}. You have been automatically rejoined.`,
          circleId: circle_id,
          targetUrl: `/circle/${circle_id}`,
          io: req.io
        });
      } catch (notifError) {
        console.error('Error sending notification:', notifError);
      }
    }

    return res.json({ success: true, message: "User has been unbanned and rejoined the circle" });
  } catch (error) {
    console.error("❌ Unban user error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Get restricted users
router.get("/restricted-users/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const now = new Date();
    await CircleRestriction.deleteMany({
      circle: circle_id,
      restricted_until: { $lte: now }
    });

    const restrictedUsers = await CircleRestriction.find({
      circle: circle_id,
      restricted_until: { $gt: now }
    })
      .populate({ path: 'user', ...safePopulateOptions })
      .sort({ created_at: -1 })
      .lean();

    const formattedRestrictedUsers = await Promise.all(
      restrictedUsers.map(async (restriction) => {
        if (!restriction || !restriction.user || !restriction.user._id) {
          return null;
        }
        try {
          const userId = restriction.user._id?.toString() || restriction.user._id;
          const profile = await Profile.findOne({ user: userId });
          const userEmail = restriction.user.email || 'Unknown';
          
          return {
            id: restriction._id?.toString() || restriction._id,
            user: {
              id: userId,
              email: userEmail,
              full_name: profile?.full_name || userEmail,
              profile_pic: profile?.profile_pic || '/images/default_profile.png'
            },
            reason: restriction.reason || '',
            restricted_until: restriction.restricted_until,
            created_at: restriction.created_at
          };
        } catch (error) {
          console.error('Error processing restricted user:', error);
          return null;
        }
      })
    ).then(users => users.filter(u => u !== null));

    return res.json({ success: true, restricted_users: formattedRestrictedUsers });
  } catch (error) {
    console.error("❌ Get restricted users error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Get banned users
router.get("/banned-users/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const bannedUsers = await CircleBanList.find({ circle: circle_id })
      .populate({ path: 'user', ...safePopulateOptions })
      .sort({ banned_at: -1 })
      .lean();

    const formattedBannedUsers = await Promise.all(
      bannedUsers.map(async (ban) => {
        if (!ban || !ban.user || !ban.user._id) {
          return null;
        }
        try {
          const userId = ban.user._id?.toString() || ban.user._id;
          const profile = await Profile.findOne({ user: userId });
          return {
            id: ban._id?.toString() || ban._id,
            user: {
              id: userId,
              email: ban.user.email || 'Unknown',
              full_name: profile?.full_name || ban.user.email || 'User',
              profile_pic: profile?.profile_pic || '/images/default_profile.png'
            },
            reason: ban.reason || '',
            banned_at: ban.banned_at
          };
        } catch (error) {
          console.error('Error processing banned user:', error);
          return null;
        }
      })
    ).then(users => users.filter(u => u !== null));

    return res.json({ success: true, banned_users: formattedBannedUsers });
  } catch (error) {
    console.error("❌ Get banned users error:", error);
    const { sanitizeError } = await import('../../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

