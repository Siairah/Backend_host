import { Router } from "express";
import { Circle, CircleMembership, CircleJoinRequest } from "../models/circle.js";
import Profile from "../models/profile.js";
import { sendNotification } from "../utils/notifications.js";
import { isCircleAdmin, safePopulateOptions } from "./utils.js";

const router = Router();

// Approve join request
router.post("/approve-request/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { user_id } = req.body;

    const joinRequest = await CircleJoinRequest.findById(request_id);
    if (!joinRequest) {
      return res.status(404).json({ success: false, message: "Join request not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, joinRequest.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circle = await Circle.findById(joinRequest.circle);
    const adminProfile = await Profile.findOne({ user: user_id });
    const adminName = adminProfile?.full_name || 'Admin';

    await CircleMembership.create({
      user: joinRequest.user,
      circle: joinRequest.circle,
      is_admin: false
    });

    if (req.io && joinRequest.user) {
      const recipientId = joinRequest.user.toString ? joinRequest.user.toString() : (joinRequest.user._id ? joinRequest.user._id.toString() : joinRequest.user);
      await sendNotification({
        recipientId: recipientId,
        senderId: user_id,
        notificationType: 'approval',
        message: `${adminName} approved your request to join ${circle?.name || 'the circle'}.`,
        circleId: joinRequest.circle?.toString() || joinRequest.circle,
        targetUrl: `/circle/${joinRequest.circle}`,
        io: req.io
      });
    }

    await CircleJoinRequest.deleteOne({ _id: request_id });
    return res.json({ success: true, message: "Join request approved" });
  } catch (error) {
    console.error("❌ Approve join request error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

// Reject join request
router.post("/reject-request/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { user_id } = req.body;

    const joinRequest = await CircleJoinRequest.findById(request_id);
    if (!joinRequest) {
      return res.status(404).json({ success: false, message: "Join request not found" });
    }

    const adminCheck = await isCircleAdmin(user_id, joinRequest.circle);
    if (!adminCheck) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circle = await Circle.findById(joinRequest.circle);
    const adminProfile = await Profile.findOne({ user: user_id });
    const adminName = adminProfile?.full_name || 'Admin';

    if (req.io && joinRequest.user) {
      const recipientId = joinRequest.user.toString ? joinRequest.user.toString() : (joinRequest.user._id ? joinRequest.user._id.toString() : joinRequest.user);
      await sendNotification({
        recipientId: recipientId,
        senderId: user_id,
        notificationType: 'rejection',
        message: `${adminName} rejected your request to join ${circle?.name || 'the circle'}.`,
        circleId: joinRequest.circle?.toString() || joinRequest.circle,
        targetUrl: `/circles`,
        io: req.io
      });
    }

    await CircleJoinRequest.deleteOne({ _id: request_id });
    return res.json({ success: true, message: "Join request rejected" });
  } catch (error) {
    console.error("❌ Reject join request error:", error);
    const { sanitizeError } = await import('../utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;

