import { Router } from "express";
import { Circle, CircleMembership } from "../models/circle.js";
import Profile from "../models/profile.js";
import { isCircleAdmin, safePopulateOptions } from "./utils.js";

const router = Router();

// Get all members for management dashboard
router.get("/members/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const members = await CircleMembership.find({ circle: circle_id })
      .populate({ path: 'user', ...safePopulateOptions })
      .lean();

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

    return res.json({ success: true, members: formattedMembers });
  } catch (error) {
    console.error("❌ Get members error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Promote member to admin
router.post("/promote-admin", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const adminCount = await CircleMembership.countDocuments({ circle: circle_id, is_admin: true });
    if (adminCount >= 3) {
      return res.status(400).json({ success: false, message: "Maximum 3 admins allowed per circle" });
    }

    const membership = await CircleMembership.findOne({ user: member_id, circle: circle_id });
    if (!membership) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    membership.is_admin = true;
    await membership.save();

    return res.json({ success: true, message: "Member promoted to admin" });
  } catch (error) {
    console.error("❌ Promote admin error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Remove admin privileges
router.post("/remove-admin", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    if (circle.created_by && circle.created_by.toString() === member_id) {
      return res.status(400).json({ success: false, message: "Cannot remove the circle creator as admin" });
    }

    const membership = await CircleMembership.findOne({ user: member_id, circle: circle_id });
    if (!membership) {
      return res.status(404).json({ success: false, message: "Member not found" });
    }

    membership.is_admin = false;
    await membership.save();

    return res.json({ success: true, message: "Admin privileges removed" });
  } catch (error) {
    console.error("❌ Remove admin error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Remove member from circle
router.post("/remove-member", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const adminCheck = await isCircleAdmin(user_id, circle_id);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    await CircleMembership.deleteOne({ user: member_id, circle: circle_id });
    return res.json({ success: true, message: "Member removed from circle" });
  } catch (error) {
    console.error("❌ Remove member error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

