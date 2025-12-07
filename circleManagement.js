import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Circle, CircleMembership, CircleJoinRequest, CircleRestriction, CircleBanList } from "./models/circle.js";
import { Post, ModerationQueue, PostReport } from "./models/post.js";
import Profile from "./models/profile.js";
import { sendNotification } from "./utils/notifications.js";

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();

async function isCircleAdmin(userId, circleId) {
  const membership = await CircleMembership.findOne({
    user: userId,
    circle: circleId,
    is_admin: true
  });
  return !!membership;
}

router.get("/manage/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(401).json({ success: false, message: "User ID required" });
    }

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized to manage this circle" });
    }

    const pendingRequests = await CircleJoinRequest.find({
      circle: circle_id,
      is_approved: false
    }).populate('user').lean();

    const members = await CircleMembership.find({ circle: circle_id })
      .populate('user')
      .lean();

    const adminCount = await CircleMembership.countDocuments({ circle: circle_id, is_admin: true });

    const pendingPosts = await Post.find({
      circle: circle_id,
      is_approved: false
    }).populate('user').lean();

    const allCirclePosts = await Post.find({ circle: circle_id }).distinct('_id');
    
    const flaggedPosts = await ModerationQueue.find({
      post: { $in: allCirclePosts },
      reviewed_by_admin: false
    }).populate({
      path: 'post',
      populate: { path: 'user' }
    }).populate('user').lean();

    const reportedPosts = await PostReport.find({
      post: { $in: allCirclePosts },
      resolved: false
    }).populate({
      path: 'post',
      populate: { path: 'user' }
    }).populate('reported_by').lean();


    const formattedRequests = await Promise.all(
      pendingRequests.map(async (req) => {
        const profile = await Profile.findOne({ user: req.user._id });
        return {
          id: req._id,
          user: {
            id: req.user._id,
            email: req.user.email,
            full_name: profile?.full_name || req.user.email,
            profile_pic: profile?.profile_pic || null
          },
          message: req.message,
          requested_at: req.requested_at
        };
      })
    );

    const formattedMembers = await Promise.all(
      members.map(async (member) => {
        const profile = await Profile.findOne({ user: member.user._id });
        return {
          id: member._id,
          user: {
            id: member.user._id,
            email: member.user.email,
            full_name: profile?.full_name || member.user.email,
            profile_pic: profile?.profile_pic || null
          },
          is_admin: member.is_admin,
          joined_at: member.joined_at
        };
      })
    );

    const formattedPendingPosts = await Promise.all(
      pendingPosts.map(async (post) => {
        const profile = await Profile.findOne({ user: post.user._id });
        return {
          id: post._id,
          content: post.content,
          created_at: post.created_at,
          user: {
            id: post.user._id,
            email: post.user.email,
            full_name: profile?.full_name || post.user.email,
            profile_pic: profile?.profile_pic || null
          },
          media_files: []
        };
      })
    );

    const formattedFlaggedPosts = await Promise.all(
      flaggedPosts.map(async (flagged) => {
        const postProfile = await Profile.findOne({ user: flagged.post.user._id });
        const flaggedProfile = await Profile.findOne({ user: flagged.user._id });
        return {
          id: flagged._id,
          post: {
            id: flagged.post._id,
            content: flagged.post.content,
            user: {
              id: flagged.post.user._id,
              email: flagged.post.user.email,
              full_name: postProfile?.full_name || flagged.post.user.email,
              profile_pic: postProfile?.profile_pic || null
            }
          },
          reason: flagged.reason,
          flagged_by: {
            id: flagged.user._id,
            email: flagged.user.email,
            full_name: flaggedProfile?.full_name || flagged.user.email,
            profile_pic: flaggedProfile?.profile_pic || null
          },
          created_at: flagged.createdAt
        };
      })
    );

    const formattedReportedPosts = await Promise.all(
      reportedPosts.map(async (report) => {
        const postProfile = await Profile.findOne({ user: report.post.user._id });
        const reporterProfile = await Profile.findOne({ user: report.reported_by._id });
        return {
          id: report._id,
          post: {
            id: report.post._id,
            content: report.post.content,
            user: {
              id: report.post.user._id,
              email: report.post.user.email,
              full_name: postProfile?.full_name || report.post.user.email,
              profile_pic: postProfile?.profile_pic || null
            }
          },
          reason: report.reason,
          reported_by: {
            id: report.reported_by._id,
            email: report.reported_by.email,
            full_name: reporterProfile?.full_name || report.reported_by.email,
            profile_pic: reporterProfile?.profile_pic || null
          },
          created_at: report.createdAt
        };
      })
    );

    return res.json({
      success: true,
      circle: {
        id: circle._id,
        name: circle.name,
        description: circle.description,
        cover_image: circle.cover_image,
        visibility: circle.visibility
      },
      pending_requests: formattedRequests,
      members: formattedMembers,
      pending_posts: formattedPendingPosts,
      flagged_posts: formattedFlaggedPosts.filter(f => f !== null),
      reported_posts: formattedReportedPosts.filter(r => r !== null),
      admin_count: adminCount,
      pending_posts_count: formattedPendingPosts.length,
      flagged_posts_count: formattedFlaggedPosts.filter(f => f !== null).length,
      reported_posts_count: formattedReportedPosts.filter(r => r !== null).length,
      total_pending: formattedPendingPosts.length + formattedFlaggedPosts.filter(f => f !== null).length + formattedReportedPosts.filter(r => r !== null).length + formattedRequests.length
    });

  } catch (error) {
    console.error("❌ Get circle management error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/approve-request/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { user_id } = req.body;

    const joinRequest = await CircleJoinRequest.findById(request_id);
    if (!joinRequest) {
      return res.status(404).json({ success: false, message: "Join request not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, joinRequest.circle);
    if (!isAdmin) {
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

    if (req.io) {
      await sendNotification({
        recipientId: joinRequest.user.toString(),
        senderId: user_id,
        notificationType: 'approval',
        message: `${adminName} approved your request to join ${circle?.name || 'the circle'}.`,
        circleId: joinRequest.circle.toString(),
        targetUrl: `/circle/${joinRequest.circle}`,
        io: req.io
      });
    }

    await CircleJoinRequest.deleteOne({ _id: request_id });

    return res.json({ success: true, message: "Join request approved" });

  } catch (error) {
    console.error("❌ Approve join request error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/reject-request/:request_id", async (req, res) => {
  try {
    const { request_id } = req.params;
    const { user_id } = req.body;

    const joinRequest = await CircleJoinRequest.findById(request_id);
    if (!joinRequest) {
      return res.status(404).json({ success: false, message: "Join request not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, joinRequest.circle);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circle = await Circle.findById(joinRequest.circle);
    const adminProfile = await Profile.findOne({ user: user_id });
    const adminName = adminProfile?.full_name || 'Admin';

    if (req.io) {
      await sendNotification({
        recipientId: joinRequest.user.toString(),
        senderId: user_id,
        notificationType: 'rejection',
        message: `${adminName} rejected your request to join ${circle?.name || 'the circle'}.`,
        circleId: joinRequest.circle.toString(),
        targetUrl: `/circles`,
        io: req.io
      });
    }

    await CircleJoinRequest.deleteOne({ _id: request_id });

    return res.json({ success: true, message: "Join request rejected" });

  } catch (error) {
    console.error("❌ Reject join request error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/promote-admin", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
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
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/remove-admin", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    if (circle.created_by.toString() === member_id) {
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
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/remove-member", async (req, res) => {
  try {
    const { user_id, circle_id, member_id } = req.body;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    await CircleMembership.deleteOne({ user: member_id, circle: circle_id });

    return res.json({ success: true, message: "Member removed from circle" });

  } catch (error) {
    console.error("❌ Remove member error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/approve-post/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, post.circle);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    post.is_approved = true;
    await post.save();

    if (req.io) {
      const circle = await Circle.findById(post.circle);
      const adminProfile = await Profile.findOne({ user: user_id });
      const adminName = adminProfile?.full_name || 'Admin';
      
      await sendNotification({
        recipientId: post.user.toString(),
        senderId: user_id,
        notificationType: 'post_approved',
        message: `${adminName} approved your post in ${circle?.name || 'the circle'}.`,
        postId: post_id,
        circleId: post.circle.toString(),
        targetUrl: `/post/${post_id}`,
        io: req.io
      });
    }

    return res.json({ success: true, message: "Post approved" });

  } catch (error) {
    console.error("❌ Approve post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/reject-post/:post_id", async (req, res) => {
  try {
    const { post_id } = req.params;
    const { user_id } = req.body;

    const post = await Post.findById(post_id);
    if (!post) {
      return res.status(404).json({ success: false, message: "Post not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, post.circle);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    await Post.deleteOne({ _id: post_id });

    return res.json({ success: true, message: "Post rejected and deleted" });

  } catch (error) {
    console.error("❌ Reject post error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/restrict-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id, days = 7 } = req.body;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

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
      reason: "Restricted by admin",
      restricted_until: restrictedUntil
    });

    if (req.io) {
      const circle = await Circle.findById(circle_id);
      const adminProfile = await Profile.findOne({ user: user_id });
      const adminName = adminProfile?.full_name || 'Admin';
      
      await sendNotification({
        recipientId: target_user_id,
        senderId: user_id,
        notificationType: 'restriction',
        message: `${adminName} restricted you from ${circle?.name || 'the circle'} for ${days} days.`,
        circleId: circle_id,
        targetUrl: `/circle/${circle_id}`,
        io: req.io
      });
    }

    return res.json({ success: true, message: `User restricted for ${days} days` });

  } catch (error) {
    console.error("❌ Restrict user error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/ban-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id, reason = "Banned by admin" } = req.body;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
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
      reason: reason
    });

    if (req.io) {
      const circle = await Circle.findById(circle_id);
      const adminProfile = await Profile.findOne({ user: user_id });
      const adminName = adminProfile?.full_name || 'Admin';
      
      await sendNotification({
        recipientId: target_user_id,
        senderId: user_id,
        notificationType: 'ban',
        message: `${adminName} banned you from ${circle?.name || 'the circle'}.`,
        circleId: circle_id,
        targetUrl: `/circles`,
        io: req.io
      });
    }

    return res.json({ success: true, message: "User has been banned from the circle" });

  } catch (error) {
    console.error("❌ Ban user error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.post("/unban-user", async (req, res) => {
  try {
    const { user_id, circle_id, target_user_id } = req.body;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    await CircleBanList.deleteOne({ user: target_user_id, circle: circle_id });

    if (req.io) {
      const circle = await Circle.findById(circle_id);
      const adminProfile = await Profile.findOne({ user: user_id });
      const adminName = adminProfile?.full_name || 'Admin';
      
      await sendNotification({
        recipientId: target_user_id,
        senderId: user_id,
        notificationType: 'unban',
        message: `${adminName} unbanned you from ${circle?.name || 'the circle'}.`,
        circleId: circle_id,
        targetUrl: `/circle/${circle_id}`,
        io: req.io
      });
    }

    return res.json({ success: true, message: "User has been unbanned" });

  } catch (error) {
    console.error("❌ Unban user error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.get("/pending-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const pendingPosts = await Post.find({
      circle: circle_id,
      is_approved: false
    }).populate('user').lean();

    const formattedPosts = await Promise.all(
      pendingPosts.map(async (post) => {
        const profile = await Profile.findOne({ user: post.user._id });
        return {
          id: post._id,
          content: post.content,
          created_at: post.created_at,
          user: {
            id: post.user._id,
            email: post.user.email,
            full_name: profile?.full_name || post.user.email,
            profile_pic: profile?.profile_pic || null
          },
          media_files: []
        };
      })
    );

    return res.json({ success: true, pending_posts: formattedPosts });

  } catch (error) {
    console.error("❌ Get pending posts error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.put("/update/:circle_id", upload.single("cover_image"), async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id, name, description, rules, visibility } = req.body;

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    if (name) circle.name = name.trim();
    if (description !== undefined) circle.description = description;
    if (rules !== undefined) circle.rules = rules;
    if (visibility) circle.visibility = visibility;

    if (req.file) {
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "circles" },
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        circle.cover_image = uploaded.secure_url;
      } catch (err) {
        console.error('Cover image upload error:', err);
      }
    }

    await circle.save();

    return res.json({
      success: true,
      message: "Circle updated successfully",
      circle: {
        id: circle._id,
        name: circle.name,
        description: circle.description,
        rules: circle.rules,
        cover_image: circle.cover_image,
        visibility: circle.visibility
      }
    });

  } catch (error) {
    console.error("❌ Update circle error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.get("/flagged-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circlePosts = await Post.find({ circle: circle_id }).distinct('_id');
    const flaggedPosts = await ModerationQueue.find({
      post: { $in: circlePosts },
      reviewed_by_admin: false
    }).populate('post').populate('user').lean();

    const formattedFlaggedPosts = await Promise.all(
      flaggedPosts.map(async (flagged) => {
        const postProfile = await Profile.findOne({ user: flagged.post.user._id });
        const flaggedProfile = await Profile.findOne({ user: flagged.user._id });
        return {
          id: flagged._id,
          post: {
            id: flagged.post._id,
            content: flagged.post.content,
            user: {
              id: flagged.post.user._id,
              email: flagged.post.user.email,
              full_name: postProfile?.full_name || flagged.post.user.email,
              profile_pic: postProfile?.profile_pic || null
            }
          },
          reason: flagged.reason,
          flagged_by: {
            id: flagged.user._id,
            email: flagged.user.email,
            full_name: flaggedProfile?.full_name || flagged.user.email,
            profile_pic: flaggedProfile?.profile_pic || null
          },
          created_at: flagged.createdAt
        };
      })
    );

    return res.json({ success: true, flagged_posts: formattedFlaggedPosts });

  } catch (error) {
    console.error("❌ Get flagged posts error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

router.get("/reported-posts/:circle_id", async (req, res) => {
  try {
    const { circle_id } = req.params;
    const { user_id } = req.query;

    const isAdmin = await isCircleAdmin(user_id, circle_id);
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: "You are not authorized" });
    }

    const circlePosts = await Post.find({ circle: circle_id }).distinct('_id');
    const reportedPosts = await PostReport.find({
      post: { $in: circlePosts },
      resolved: false
    }).populate('post').populate('reported_by').lean();

    const formattedReportedPosts = await Promise.all(
      reportedPosts.map(async (report) => {
        const postProfile = await Profile.findOne({ user: report.post.user._id });
        const reporterProfile = await Profile.findOne({ user: report.reported_by._id });
        return {
          id: report._id,
          post: {
            id: report.post._id,
            content: report.post.content,
            user: {
              id: report.post.user._id,
              email: report.post.user.email,
              full_name: postProfile?.full_name || report.post.user.email,
              profile_pic: postProfile?.profile_pic || null
            }
          },
          reason: report.reason,
          reported_by: {
            id: report.reported_by._id,
            email: report.reported_by.email,
            full_name: reporterProfile?.full_name || report.reported_by.email,
            profile_pic: reporterProfile?.profile_pic || null
          },
          created_at: report.createdAt
        };
      })
    );

    return res.json({ success: true, reported_posts: formattedReportedPosts });

  } catch (error) {
    console.error("❌ Get reported posts error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
