import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostReport, ModerationQueue } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import { notifyCircleAdmins } from "./utils/notifications.js";
import Profile from "./models/profile.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Check if user has already reported a post
router.get("/check-report", async (req, res) => {
  try {
    const { post_id, user_id } = req.query;

    if (!post_id || !user_id) {
      return res.status(400).json({ success: false, message: "Post ID and User ID required" });
    }

    const existingReport = await PostReport.findOne({ post: post_id, reported_by: user_id });
    
    return res.json({
      success: true,
      hasReported: !!existingReport
    });
  } catch (error) {
    console.error("❌ Check report error:", error);
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

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

    // Check for existing report (prevent duplicate reports)
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

    // Create report with duplicate key error handling
    let report;
    try {
      report = await PostReport.create({
        post: post_id,
        reported_by: user_id,
        reason: reason.trim(),
        resolved: false
      });
    } catch (createError) {
      // Handle duplicate key error (race condition protection)
      // MongoDB duplicate key error code is 11000
      if (createError.code === 11000 || 
          (createError.message && createError.message.includes('duplicate key'))) {
        // Double-check to confirm it's a duplicate
        const duplicateCheck = await PostReport.findOne({ post: post_id, reported_by: user_id });
        if (duplicateCheck) {
          return res.status(400).json({ success: false, message: "You have already reported this post" });
        }
      }
      // Re-throw if it's not a duplicate error
      throw createError;
    }

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
    const { sanitizeError } = await import('./utils/errorSanitizer.js');
    return res.status(500).json({ success: false, message: "Server error: " + sanitizeError(error) });
  }
});

export default router;
