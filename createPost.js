import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Post, PostMedia, ModerationQueue } from "./models/post.js";
import { Circle, CircleMembership } from "./models/circle.js";
import User from "./models/models.js";
import { checkImageModeration, checkVideoModeration, checkTextContent } from "./utils/sightEngine.js";
import { sendNotification } from "./utils/notifications.js";
import { notifyCircleAdmins } from "./utils/notifications.js";
import Profile from "./models/profile.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
// Use .any() to ensure text fields (content, user_id, circle_id) are in req.body with files
router.post("/", upload.any(), async (req, res) => {
  try {
    // Filter to only image/video files (fieldname 'media'), max 10
    const allMedia = (req.files || []).filter((f) => f.fieldname === "media" && (f.mimetype?.startsWith("image/") || f.mimetype?.startsWith("video/")));
    const mediaFiles = allMedia.slice(0, 10);
    const body = req.body || {};
    const user_id = body.user_id;
    const circle_id = body.circle_id;
    const content = body.content ?? body.text ?? '';

    console.log('📝 Create post request:', { user_id, circle_id, content: content?.substring(0, 80), contentLen: content?.length, bodyKeys: Object.keys(body), mediaCount: mediaFiles.length });

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID required" });
    }
    if (!(content || '').trim() && mediaFiles.length === 0) {
      return res.status(400).json({ success: false, message: "Add content or media to your post" });
    }

    const user = await User.findById(user_id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let is_approved = false;
    let circle = null;
    if (circle_id) {
      circle = await Circle.findById(circle_id);
      if (!circle) {
        return res.status(404).json({ success: false, message: "Circle not found" });
      }

      if (circle.suspendedUntil && circle.suspendedUntil <= new Date()) {
        circle.suspended = false;
        circle.suspendedUntil = null;
        await circle.save();
      }
      if (circle.suspended) {
        return res.status(403).json({
          success: false,
          message: "This circle is suspended by moderators. New posts are disabled.",
        });
      }

      const membership = await CircleMembership.findOne({ user: user_id, circle: circle_id });
      if (!membership) {
        return res.status(403).json({ success: false, message: "You must be a member of this circle" });
      }
      is_approved = membership.is_admin;
    }

    // Content moderation: SightEngine API only (no manual patterns)
    let flagged = false;
    let flaggedReason = null;
    const trimmedContent = (content || '').trim();

    if (trimmedContent) {
      const textCheck = await checkTextContent(trimmedContent);
      if (textCheck.flagged) {
        flagged = true;
        flaggedReason = textCheck.reason || 'Inappropriate text content detected';
        console.log('🚩 Post flagged (SightEngine text):', textCheck.reason);
      }
    }

    if (mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        if (file.mimetype?.startsWith('image/')) {
          const imageCheck = await checkImageModeration(file.buffer, file.mimetype || 'image/jpeg');
          if (imageCheck.flagged) {
            flagged = true;
            flaggedReason = flaggedReason ? `${flaggedReason}; ${imageCheck.reason}` : (imageCheck.reason || 'Inappropriate image content detected');
            console.log('🚩 Post flagged (SightEngine image):', imageCheck.reason);
            break;
          }
        } else if (file.mimetype?.startsWith('video/')) {
          const videoCheck = await checkVideoModeration(file.buffer, file.mimetype || 'video/mp4');
          if (videoCheck.flagged) {
            flagged = true;
            flaggedReason = flaggedReason ? `${flaggedReason}; ${videoCheck.reason}` : (videoCheck.reason || 'Inappropriate video content detected');
            console.log('🚩 Post flagged (SightEngine video):', videoCheck.reason);
            break;
          }
        }
      }
    }

    // If flagged, force is_approved = false (even for admins - content policy applies to all)
    if (flagged) {
      is_approved = false;
    }

    const post = new Post({
      user: user_id,
      circle: circle_id || null,
      content: content,
      is_approved: is_approved
    });

    await post.save();
    console.log('✅ Post created:', post._id, flagged ? '(FLAGGED - awaiting review)' : '');

    // Upload media if provided
    if (mediaFiles.length > 0) {
      for (const file of mediaFiles) {
        try {
          const uploaded = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "posts", resource_type: "auto" },
              (err, result) => {
                if (err) reject(err);
                else resolve(result);
              }
            );
            stream.end(file.buffer);
          });

          await PostMedia.create({
            post: post._id,
            file: uploaded.secure_url,
            type: file.mimetype.startsWith('video/') ? 'video' : 'image'
          });
        } catch (err) {
          console.error('Media upload error:', err);
        }
      }
    }

    const savedMedia = await PostMedia.find({ post: post._id });

    // If flagged: add to ModerationQueue, send warning to post owner, notify admins
    if (flagged && circle_id) {
      await ModerationQueue.create({
        user: user_id,
        post: post._id,
        text: content,
        reason: flaggedReason || 'Flagged by content moderation',
        reviewed_by_admin: false,
        reviewed_by_superadmin: false
      });

      const circleObj = circle || await Circle.findById(circle_id);
      const circleName = circleObj?.name || 'the circle';

      await sendNotification({
        recipientId: user_id,
        senderId: null,
        notificationType: 'warning',
        message: `Your post has been flagged in ${circleName} and is awaiting admin review.`,
        circleId: circle_id,
        targetUrl: `/circle/${circle_id}/moderation`,
        io: req.io
      });

      if (req.io) {
        const userProfile = await Profile.findOne({ user: user_id });
        const userName = userProfile?.full_name || 'A user';
        await notifyCircleAdmins({
          circleId: circle_id,
          senderId: user_id,
          notificationType: 'post_flagged_auto',
          message: `Post by ${userName} has been automatically flagged in ${circleName}.`,
          postId: post._id.toString(),
          targetUrl: `/circle/${circle_id}/manage`,
          io: req.io
        });
      }
    }

    console.log('📤 Response:', { flagged, flaggedReason, is_approved: post.is_approved });
    return res.status(201).json({
      success: true,
      message: flagged ? "Post created but flagged for review" : (is_approved ? "Post created" : "Post created, awaiting approval"),
      post: {
        id: post._id,
        content: post.content,
        created_at: post.createdAt,
        media_files: savedMedia.map(m => ({ file: m.file, type: m.type }))
      },
      flagged: flagged || false,
      is_approved: post.is_approved,
      flagged_reason: flagged ? flaggedReason : null
    });

  } catch (error) {
    console.error("❌ Create post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

