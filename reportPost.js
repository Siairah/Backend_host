import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostReport, ModerationQueue } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import { notifyCircleAdmins } from "./utils/notifications.js";
import Profile from "./models/profile.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/report", upload.single("photo"), async (req, res) => {
  try {
    const { user_id, post_id, reason } = req.body;

    console.log("📝 Report post request:", { user_id, post_id, reason: reason?.substring(0, 50), hasPhoto: !!req.file });

    if (!user_id || !post_id || !reason) {
      return res.status(400).json({ success: false, message: "User ID, Post ID, and reason required" });
    }

    const post = await Post.findById(post_id).populate('user');
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    if (post.user._id.toString() === user_id) {
      return res.status(400).json({ success: false, message: "You cannot report your own post" });
    }

    const existingReport = await PostReport.findOne({ post: post_id, reported_by: user_id });
    if (existingReport) {
      return res.status(400).json({ success: false, message: "You have already reported this post" });
    }

    let photoUrl = null;
    if (req.file) {
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "post_reports" },
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        photoUrl = uploaded.secure_url;
      } catch (err) {
        console.error('Report photo upload error:', err);
      }
    }

    const report = await PostReport.create({
      post: post_id,
      reported_by: user_id,
      reason: reason.trim(),
      resolved: false
    });

    console.log("✅ Report created:", report._id);

    if (photoUrl) {
      await ModerationQueue.create({
        user: user_id,
        post: post_id,
        image: photoUrl,
        text: reason.trim(),
        reason: "User Report",
        reviewed_by_admin: false,
        reviewed_by_superadmin: false
      });
      console.log("✅ ModerationQueue entry created with photo");
    }

    if (post.circle && req.io) {
      const reporterProfile = await Profile.findOne({ user: user_id });
      const reporterName = reporterProfile?.full_name || 'A user';
      const circle = await Circle.findById(post.circle);
      
      await notifyCircleAdmins({
        circleId: post.circle._id.toString(),
        senderId: user_id,
        notificationType: 'post_reported',
        message: `${reporterName} reported a post in ${circle?.name || 'your circle'}.`,
        postId: post_id,
        targetUrl: `/circle/${post.circle._id}/reported`,
        io: req.io
      });
    }

    return res.json({
      success: true,
      message: "Post reported successfully",
      report: {
        id: report._id,
        reason: report.reason
      }
    });

  } catch (error) {
    console.error("❌ Report post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
