/**
 * Admin CRUD + analytics. All paths are relative to `/admin` (this router is mounted in `adminRoutes.js`).
 * Middleware: `verifyAdmin` (JWT `type: "admin"` from POST /admin/login).
 */
import { Router } from "express";
import mongoose from "mongoose";
import { verifyAdmin } from "./adminAuthMiddleware.js";
import { User } from "./models/index.js";
import Profile from "./models/profile.js";
import { Post, PostMedia, Comment, Like, PostReport, ModerationQueue } from "./models/post.js";
import {
  Circle,
  CircleMembership,
  CircleJoinRequest,
  CircleRestriction,
  CircleBanList,
} from "./models/circle.js";
import { adminHardDeletePost } from "./adminPostUtils.js";
import { adminHardDeleteUser } from "./adminUserDelete.js";
import Notification from "./models/notification.js";

const router = Router();
router.use(verifyAdmin);

/** Pending reports + unreviewed flags in a circle → health score for superadmin UI. */
async function circleModerationStats(circleObjectId) {
  const postIds = await Post.find({ circle: circleObjectId }).distinct("_id");
  if (!postIds.length) return { pending_reports: 0, flagged_posts: 0, health_score: 100 };
  const [pr, fp] = await Promise.all([
    PostReport.countDocuments({ post: { $in: postIds }, resolved: false }),
    ModerationQueue.countDocuments({ post: { $in: postIds }, reviewed_by_admin: false }),
  ]);
  const health_score = Math.max(0, Math.min(100, 100 - pr * 4 - fp * 6));
  return { pending_reports: pr, flagged_posts: fp, health_score };
}

function pagination(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------- Users ----------
router.get("/users", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const status = req.query.status;
    const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;

    const q = {};
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const profileUsers = await Profile.find({ full_name: re }).distinct("user");
      q.$or = [{ email: re }, { phone: re }, ...(profileUsers.length ? [{ _id: { $in: profileUsers } }] : [])];
    }
    if (status === "active") q.isActive = true;
    if (status === "inactive") q.isActive = false;
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) q.createdAt = { $gte: dateFrom };

    const [total, items, statsPack] = await Promise.all([
      User.countDocuments(q),
      User.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Promise.all([
        User.countDocuments({}),
        User.countDocuments({ isActive: true }),
        User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
        User.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } }),
      ]),
    ]);

    const [total_users, active_users, new_users_30d, online_users] = statsPack;

    const itemIds = items.map((u) => u._id);
    const profilesForPage =
      itemIds.length > 0 ? await Profile.find({ user: { $in: itemIds } }).select("user full_name").lean() : [];
    const displayNameByUser = new Map(profilesForPage.map((p) => [String(p.user), (p.full_name || "").trim()]));

    const rows = items.map((u) => ({
      id: String(u._id),
      email: u.email,
      phone: u.phone || "",
      isActive: u.isActive,
      createdAt: u.createdAt,
      displayName: displayNameByUser.get(String(u._id)) || "",
      isBanned: !!u.isBanned,
      bannedUntil: u.bannedUntil || null,
      banReason: u.banReason || "",
    }));

    return res.json({
      success: true,
      items: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      stats: { total_users, active_users, new_users_30d, online_users },
    });
  } catch (e) {
    console.error("admin users list:", e);
    return res.status(500).json({ success: false, message: "Failed to list users" });
  }
});

router.get("/users/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const user = await User.findById(req.params.id).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const profile = await Profile.findOne({ user: user._id }).lean();
    return res.json({
      success: true,
      user: {
        id: String(user._id),
        email: user.email,
        phone: user.phone || "",
        isActive: user.isActive,
        isBanned: !!user.isBanned,
        bannedUntil: user.bannedUntil || null,
        banReason: user.banReason || "",
        createdAt: user.createdAt,
        profile: profile
          ? {
              full_name: profile.full_name,
              bio: profile.bio,
              profile_pic: profile.profile_pic,
            }
          : null,
      },
    });
  } catch (e) {
    console.error("admin user detail:", e);
    return res.status(500).json({ success: false, message: "Failed to load user" });
  }
});

router.patch("/users/:id/toggle-active", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    user.isActive = !user.isActive;
    await user.save();
    return res.json({ success: true, isActive: user.isActive });
  } catch (e) {
    console.error("admin toggle user:", e);
    return res.status(500).json({ success: false, message: "Failed to update user" });
  }
});

router.post("/users/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !["activate", "deactivate"].includes(action)) {
      return res.status(400).json({ success: false, message: "ids[] and action activate|deactivate required" });
    }
    const oids = ids.filter((id) => mongoose.isValidObjectId(id));
    const isActive = action === "activate";
    const result = await User.updateMany({ _id: { $in: oids } }, { $set: { isActive } });
    return res.json({ success: true, modified: result.modifiedCount });
  } catch (e) {
    console.error("admin users bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk action failed" });
  }
});

/** Superadmin: ban or unban user (optional timed ban via hours or ISO until). */
router.patch("/users/:id/ban", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const banned = !!req.body?.banned;
    const reason = String(req.body?.reason || "").trim();
    const hours = req.body?.hours != null ? Number(req.body.hours) : null;
    const untilRaw = req.body?.until;
    let bannedUntil = null;
    if (banned) {
      if (untilRaw) {
        const d = new Date(untilRaw);
        if (!Number.isNaN(d.getTime())) bannedUntil = d;
      } else if (hours != null && Number.isFinite(hours) && hours > 0) {
        bannedUntil = new Date(Date.now() + hours * 3600000);
      }
    }
    user.isBanned = banned;
    user.banReason = banned ? reason : "";
    user.bannedUntil = banned ? bannedUntil : null;
    await user.save();
    return res.json({
      success: true,
      isBanned: !!user.isBanned,
      bannedUntil: user.bannedUntil,
      banReason: user.banReason || "",
    });
  } catch (e) {
    console.error("admin user ban:", e);
    return res.status(500).json({ success: false, message: "Failed to update ban" });
  }
});

/** Superadmin: send in-app warning notification to user. */
router.post("/users/:id/warning", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ success: false, message: "message required" });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    await Notification.create({
      recipient: user._id,
      sender: null,
      post: null,
      circle: null,
      notification_type: "warning",
      message: `[Moderation] ${message}`,
      is_read: false,
      acknowledged: false,
      target_url: "/profile",
    });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin user warning:", e);
    return res.status(500).json({ success: false, message: "Failed to send warning" });
  }
});

/** Superadmin: permanently delete user and owned posts/content. */
router.delete("/users/:id", async (req, res) => {
  try {
    const userId = req.params.id;
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const r = await adminHardDeleteUser(userId);
    if (!r.ok) return res.status(404).json({ success: false, message: r.message });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin delete user:", e);
    return res.status(500).json({ success: false, message: "Failed to delete user" });
  }
});

// ---------- Posts (superadmin: all visibility, approval states, moderation) ----------
router.get("/posts", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const circleId = req.query.circle_id;
    const hasMedia = req.query.has_media;
    const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;
    const flaggedOnly = req.query.flagged_only === "true" || req.query.flagged_only === "1";
    const reportedOnly = req.query.reported_only === "true" || req.query.reported_only === "1";
    const needsAttention =
      req.query.needs_attention === "true" || req.query.needs_attention === "1" || req.query.needs_attention === "yes";
    const approval = req.query.approval;

    const andParts = [];

    if (approval === "pending") andParts.push({ is_approved: false });
    else if (approval === "approved") andParts.push({ is_approved: true });

    if (circleId && mongoose.isValidObjectId(circleId)) {
      andParts.push({ circle: new mongoose.Types.ObjectId(circleId) });
    }

    if (needsAttention) {
      const [flaggedPostIds, reportedPostIds] = await Promise.all([
        ModerationQueue.find({ reviewed_by_admin: false }).distinct("post"),
        PostReport.distinct("post", { resolved: false }),
      ]);
      const idSet = new Set([...flaggedPostIds.map(String), ...reportedPostIds.map(String)]);
      const merged = [...idSet].map((id) => new mongoose.Types.ObjectId(id));
      andParts.push({ _id: { $in: merged.length ? merged : [] } });
    } else {
      if (flaggedOnly) {
        const flaggedPostIds = await ModerationQueue.find({ reviewed_by_admin: false }).distinct("post");
        andParts.push({ _id: { $in: flaggedPostIds.length ? flaggedPostIds : [] } });
      }
      if (reportedOnly) {
        const reportedPostIds = await PostReport.distinct("post", { resolved: false });
        andParts.push({ _id: { $in: reportedPostIds.length ? reportedPostIds : [] } });
      }
    }

    if (hasMedia === "yes") {
      const withMedia = await PostMedia.distinct("post");
      andParts.push({ _id: { $in: withMedia.length ? withMedia : [] } });
    } else if (hasMedia === "no") {
      const withMedia = await PostMedia.distinct("post");
      if (withMedia.length) andParts.push({ _id: { $nin: withMedia } });
    }

    if (dateFrom && !Number.isNaN(dateFrom.getTime())) {
      andParts.push({ createdAt: { $gte: dateFrom } });
    }

    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const [userIds, circleIds] = await Promise.all([
        User.find({ email: re }).distinct("_id"),
        Circle.find({ name: re }).distinct("_id"),
      ]);
      const orParts = [{ content: re }];
      if (userIds.length) orParts.push({ user: { $in: userIds } });
      if (circleIds.length) orParts.push({ circle: { $in: circleIds } });
      andParts.push({ $or: orParts });
    }

    const q = andParts.length === 0 ? {} : andParts.length === 1 ? andParts[0] : { $and: andParts };

    const [total, posts, statsPack] = await Promise.all([
      Post.countDocuments(q),
      Post.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("user", "email").populate("circle", "name").lean(),
      Promise.all([
        Post.countDocuments({}),
        Post.countDocuments({ createdAt: { $gte: startOfToday() } }),
        Comment.countDocuments({}),
        Like.countDocuments({}),
      ]),
    ]);
    const [total_posts, posts_today, total_comments, total_likes] = statsPack;

    const postIds = posts.map((p) => p._id);
    const [modRows, reportAgg] = await Promise.all([
      postIds.length
        ? ModerationQueue.find({
            post: { $in: postIds },
            reviewed_by_admin: false,
          }).lean()
        : [],
      postIds.length
        ? PostReport.aggregate([
            { $match: { post: { $in: postIds }, resolved: false } },
            { $group: { _id: "$post", c: { $sum: 1 } } },
          ])
        : [],
    ]);
    const modByPost = new Map(modRows.map((m) => [String(m.post), m]));
    const reportsByPost = new Map(reportAgg.map((r) => [String(r._id), r.c]));

    const items = await Promise.all(
      posts.map(async (p) => {
        const mediaCount = await PostMedia.countDocuments({ post: p._id });
        const mod = modByPost.get(String(p._id));
        return {
          id: String(p._id),
          content: (p.content || "").slice(0, 500),
          is_public: p.is_public,
          is_approved: p.is_approved,
          createdAt: p.createdAt,
          authorEmail: p.user?.email || "",
          circleName: p.circle?.name || "",
          circleId: p.circle ? String(p.circle._id || p.circle) : "",
          mediaCount,
          commentsCount: await Comment.countDocuments({ post: p._id, is_deleted: false }),
          likesCount: await Like.countDocuments({ post: p._id }),
          flagged_pending: !!mod,
          moderation_reason: mod?.reason || null,
          open_reports: reportsByPost.get(String(p._id)) || 0,
        };
      })
    );

    return res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      stats: { total_posts, posts_today, total_comments, total_likes },
    });
  } catch (e) {
    console.error("admin posts list:", e);
    return res.status(500).json({ success: false, message: "Failed to list posts" });
  }
});

function startOfToday() {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}

router.get("/posts/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const p = await Post.findById(req.params.id).populate("user", "email").populate("circle", "name").lean();
    if (!p) return res.status(404).json({ success: false, message: "Post not found" });
    const [media, commentsRaw, reportsRaw, modEntry] = await Promise.all([
      PostMedia.find({ post: p._id }).lean(),
      Comment.find({ post: p._id }).sort({ createdAt: -1 }).limit(500).populate("user", "email").lean(),
      PostReport.find({ post: p._id }).sort({ createdAt: -1 }).populate("reported_by", "email").lean(),
      ModerationQueue.findOne({ post: p._id }).sort({ createdAt: -1 }).lean(),
    ]);

    const comments = commentsRaw.map((c) => ({
      id: String(c._id),
      content: c.content || "",
      createdAt: c.createdAt,
      is_deleted: !!c.is_deleted,
      authorEmail: c.user?.email || "",
    }));

    const reports = reportsRaw.map((r) => ({
      id: String(r._id),
      reason: r.reason || "",
      resolved: !!r.resolved,
      createdAt: r.createdAt,
      reporterEmail: r.reported_by?.email || "",
    }));

    let moderation = null;
    if (modEntry) {
      moderation = {
        id: String(modEntry._id),
        reason: modEntry.reason,
        text: modEntry.text || "",
        reviewed_by_admin: !!modEntry.reviewed_by_admin,
        createdAt: modEntry.createdAt,
      };
    }

    return res.json({
      success: true,
      post: {
        id: String(p._id),
        content: p.content || "",
        is_public: p.is_public,
        is_approved: p.is_approved,
        createdAt: p.createdAt,
        authorEmail: p.user?.email,
        circle: p.circle ? { id: String(p.circle._id), name: p.circle.name } : null,
        media: media.map((m) => ({ id: String(m._id), file: m.file, type: m.type })),
        commentsCount: await Comment.countDocuments({ post: p._id, is_deleted: false }),
        likesCount: await Like.countDocuments({ post: p._id }),
        open_reports_count: reports.filter((r) => !r.resolved).length,
        comments,
        reports,
        moderation,
      },
    });
  } catch (e) {
    console.error("admin post detail:", e);
    return res.status(500).json({ success: false, message: "Failed to load post" });
  }
});

router.delete("/posts/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const r = await adminHardDeletePost(req.params.id);
    if (!r.ok) return res.status(404).json({ success: false, message: r.message });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin delete post:", e);
    return res.status(500).json({ success: false, message: "Delete failed" });
  }
});

router.post("/posts/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !["delete", "hide", "show"].includes(action)) {
      return res.status(400).json({ success: false, message: "ids[] and action delete|hide|show required" });
    }
    const oids = ids.filter((id) => mongoose.isValidObjectId(id));
    if (action === "delete") {
      let n = 0;
      for (const id of oids) {
        const r = await adminHardDeletePost(id);
        if (r.ok) n += 1;
      }
      return res.json({ success: true, deleted: n });
    }
    const is_public = action === "show";
    const r = await Post.updateMany({ _id: { $in: oids } }, { $set: { is_public } });
    return res.json({ success: true, modified: r.modifiedCount });
  } catch (e) {
    console.error("admin posts bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk failed" });
  }
});

// ---------- Comments ----------
router.get("/comments", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const postId = req.query.post_id;
    const includeDeleted = req.query.include_deleted === "true";

    const q = includeDeleted ? {} : { is_deleted: false };
    if (postId && mongoose.isValidObjectId(postId)) q.post = postId;
    if (search) q.content = new RegExp(escapeRegex(search), "i");

    const [total, rows] = await Promise.all([
      Comment.countDocuments(q),
      Comment.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "email")
        .populate({ path: "post", select: "content circle", populate: { path: "circle", select: "name" } })
        .lean(),
    ]);

    return res.json({
      success: true,
      items: rows.map((c) => {
        const post = c.post && typeof c.post === "object" ? c.post : null;
        const circleName =
          post && post.circle && typeof post.circle === "object" && post.circle.name ? String(post.circle.name) : "";
        return {
          id: String(c._id),
          content: (c.content || "").slice(0, 300),
          is_deleted: !!c.is_deleted,
          createdAt: c.createdAt,
          authorEmail: c.user?.email || "",
          postId: post ? String(post._id) : "",
          postPreview: post?.content ? String(post.content).slice(0, 80) : "",
          postCircleName: circleName,
        };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    console.error("admin comments list:", e);
    return res.status(500).json({ success: false, message: "Failed to list comments" });
  }
});

router.get("/comments/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const c = await Comment.findById(req.params.id).populate("user", "email").populate("post").lean();
    if (!c) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({
      success: true,
      comment: {
        id: String(c._id),
        content: c.content,
        is_deleted: c.is_deleted,
        createdAt: c.createdAt,
        authorEmail: c.user?.email,
        post: c.post
          ? { id: String(c.post._id), content: (c.post.content || "").slice(0, 500) }
          : null,
      },
    });
  } catch (e) {
    console.error("admin comment detail:", e);
    return res.status(500).json({ success: false, message: "Failed to load comment" });
  }
});

router.delete("/comments/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    await Comment.findByIdAndUpdate(req.params.id, { $set: { is_deleted: true } });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin delete comment:", e);
    return res.status(500).json({ success: false, message: "Failed" });
  }
});

router.post("/comments/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !["soft_delete", "restore"].includes(action)) {
      return res.status(400).json({ success: false, message: "ids[] and action soft_delete|restore required" });
    }
    const oids = ids.filter((id) => mongoose.isValidObjectId(id));
    const is_deleted = action === "soft_delete";
    const r = await Comment.updateMany({ _id: { $in: oids } }, { $set: { is_deleted } });
    return res.json({ success: true, modified: r.modifiedCount });
  } catch (e) {
    console.error("admin comments bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk failed" });
  }
});

// ---------- Circles ----------
router.get("/circles", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;

    const q = {};
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const creators = await User.find({ email: re }).distinct("_id");
      q.$or = [{ name: re }, { description: re }, ...(creators.length ? [{ created_by: { $in: creators } }] : [])];
    }
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) q.createdAt = { $gte: dateFrom };

    const [total, circles, statsPack] = await Promise.all([
      Circle.countDocuments(q),
      Circle.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).populate("created_by", "email").lean(),
      Promise.all([
        Circle.countDocuments({}),
        Circle.countDocuments({ createdAt: { $gte: startOfToday() } }),
        CircleMembership.countDocuments({}),
      ]),
    ]);
    const [total_circles, circles_today, total_memberships] = statsPack;

    const items = await Promise.all(
      circles.map(async (c) => {
        const mod = await circleModerationStats(c._id);
        return {
          id: String(c._id),
          name: c.name,
          description: c.description,
          visibility: c.visibility,
          createdAt: c.createdAt,
          creatorEmail: c.created_by?.email || "",
          memberCount: await CircleMembership.countDocuments({ circle: c._id }),
          suspended: !!c.suspended,
          suspendedUntil: c.suspendedUntil || null,
          ...mod,
        };
      })
    );

    return res.json({
      success: true,
      items,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      stats: { total_circles, circles_today, total_memberships },
    });
  } catch (e) {
    console.error("admin circles list:", e);
    return res.status(500).json({ success: false, message: "Failed to list circles" });
  }
});

router.get("/circles/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const c = await Circle.findById(req.params.id).populate("created_by", "email").lean();
    if (!c) return res.status(404).json({ success: false, message: "Not found" });

    if (c.suspended && c.suspendedUntil && c.suspendedUntil <= new Date()) {
      await Circle.findByIdAndUpdate(c._id, { $set: { suspended: false, suspendedUntil: null } });
      c.suspended = false;
      c.suspendedUntil = null;
    }

    const postsPage = Math.max(1, parseInt(req.query.posts_page, 10) || 1);
    const postsLimit = Math.min(50, Math.max(5, parseInt(req.query.posts_limit, 10) || 15));
    const postsSkip = (postsPage - 1) * postsLimit;

    const members = await CircleMembership.find({ circle: c._id })
      .sort({ joined_at: -1 })
      .limit(20)
      .populate("user", "email")
      .lean();

    const [memberCount, mod, postTotal, postDocs] = await Promise.all([
      CircleMembership.countDocuments({ circle: c._id }),
      circleModerationStats(c._id),
      Post.countDocuments({ circle: c._id }),
      Post.find({ circle: c._id })
        .sort({ createdAt: -1 })
        .skip(postsSkip)
        .limit(postsLimit)
        .populate("user", "email")
        .lean(),
    ]);

    const postIds = postDocs.map((p) => p._id);
    const [modRows, reportAgg] = await Promise.all([
      postIds.length
        ? ModerationQueue.find({ post: { $in: postIds }, reviewed_by_admin: false }).lean()
        : [],
      postIds.length
        ? PostReport.aggregate([
            { $match: { post: { $in: postIds }, resolved: false } },
            { $group: { _id: "$post", c: { $sum: 1 } } },
          ])
        : [],
    ]);
    const modByPost = new Map(modRows.map((m) => [String(m.post), m]));
    const reportsByPost = new Map(reportAgg.map((r) => [String(r._id), r.c]));

    const posts = await Promise.all(
      postDocs.map(async (p) => {
        const modEntry = modByPost.get(String(p._id));
        const openReports = reportsByPost.get(String(p._id)) || 0;
        const commentsCount = await Comment.countDocuments({ post: p._id, is_deleted: false });
        const likesCount = await Like.countDocuments({ post: p._id });
        const mediaCount = await PostMedia.countDocuments({ post: p._id });
        const pr = openReports;
        const fp = modEntry ? 1 : 0;
        const health_score = Math.max(0, Math.min(100, 100 - pr * 4 - fp * 6));
        return {
          id: String(p._id),
          content: (p.content || "").slice(0, 400),
          is_public: p.is_public,
          is_approved: p.is_approved,
          createdAt: p.createdAt,
          authorEmail: p.user?.email || "",
          commentsCount,
          likesCount,
          mediaCount,
          open_reports: pr,
          flagged_pending: !!modEntry,
          moderation_reason: modEntry?.reason || null,
          health_score,
        };
      })
    );

    return res.json({
      success: true,
      circle: {
        id: String(c._id),
        name: c.name,
        description: c.description,
        rules: c.rules,
        visibility: c.visibility,
        createdAt: c.createdAt,
        creatorEmail: c.created_by?.email,
        suspended: !!c.suspended,
        suspendedUntil: c.suspendedUntil || null,
        memberCount,
        moderation: mod,
        members: members.map((m) => ({
          userId: String(m.user?._id),
          email: m.user?.email,
          is_admin: m.is_admin,
          joined_at: m.joined_at,
        })),
        posts,
        posts_pagination: {
          page: postsPage,
          limit: postsLimit,
          total: postTotal,
          pages: Math.ceil(postTotal / postsLimit) || 1,
        },
      },
    });
  } catch (e) {
    console.error("admin circle detail:", e);
    return res.status(500).json({ success: false, message: "Failed to load circle" });
  }
});

router.delete("/circles/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const circleId = req.params.id;
    await Post.updateMany({ circle: circleId }, { $set: { circle: null } });
    await CircleMembership.deleteMany({ circle: circleId });
    await CircleJoinRequest.deleteMany({ circle: circleId });
    await CircleRestriction.deleteMany({ circle: circleId });
    await CircleBanList.deleteMany({ circle: circleId });
    const r = await Circle.findByIdAndDelete(circleId);
    if (!r) return res.status(404).json({ success: false, message: "Circle not found" });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin delete circle:", e);
    return res.status(500).json({ success: false, message: "Failed to delete circle" });
  }
});

router.post("/circles/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || action !== "delete") {
      return res.status(400).json({ success: false, message: "ids[] and action delete required" });
    }
    let n = 0;
    for (const id of ids) {
      if (!mongoose.isValidObjectId(id)) continue;
      await Post.updateMany({ circle: id }, { $set: { circle: null } });
      await CircleMembership.deleteMany({ circle: id });
      await CircleJoinRequest.deleteMany({ circle: id });
      await CircleRestriction.deleteMany({ circle: id });
      await CircleBanList.deleteMany({ circle: id });
      const r = await Circle.findByIdAndDelete(id);
      if (r) n += 1;
    }
    return res.json({ success: true, deleted: n });
  } catch (e) {
    console.error("admin circles bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk failed" });
  }
});

/** Superadmin: broadcast a message to circle admins or all members (in-app notifications). */
router.post("/circles/:id/notice", async (req, res) => {
  try {
    const circleId = req.params.id;
    if (!mongoose.isValidObjectId(circleId)) {
      return res.status(400).json({ success: false, message: "Invalid circle id" });
    }
    const circle = await Circle.findById(circleId);
    if (!circle) return res.status(404).json({ success: false, message: "Circle not found" });
    const message = String(req.body?.message || "").trim();
    const audience = req.body?.audience === "all_members" ? "all_members" : "admins_only";
    if (!message) return res.status(400).json({ success: false, message: "message required" });

    const q =
      audience === "all_members"
        ? { circle: circle._id }
        : { circle: circle._id, is_admin: true };
    const memberships = await CircleMembership.find(q).select("user").lean();
    const text = `[Admin] ${circle.name}: ${message}`;
    let n = 0;
    for (const m of memberships) {
      if (!m.user) continue;
      await Notification.create({
        recipient: m.user,
        sender: null,
        post: null,
        circle: circle._id,
        notification_type: "admin_broadcast",
        message: text,
        is_read: false,
        acknowledged: false,
        target_url: `/circle/${circle._id}`,
      });
      n += 1;
    }
    return res.json({ success: true, delivered: n });
  } catch (e) {
    console.error("admin circle notice:", e);
    return res.status(500).json({ success: false, message: "Failed to send notice" });
  }
});

/** Superadmin: suspend or restore a circle. Optional timed suspension: `hours` or ISO `until`. */
router.patch("/circles/:id/suspension", async (req, res) => {
  try {
    const circleId = req.params.id;
    if (!mongoose.isValidObjectId(circleId)) {
      return res.status(400).json({ success: false, message: "Invalid circle id" });
    }
    const suspended = !!req.body?.suspended;
    const hours = req.body?.hours != null ? Number(req.body.hours) : null;
    const untilRaw = req.body?.until;
    let suspendedUntil = null;
    if (suspended) {
      if (untilRaw) {
        const d = new Date(untilRaw);
        if (!Number.isNaN(d.getTime())) suspendedUntil = d;
      } else if (hours != null && Number.isFinite(hours) && hours > 0) {
        suspendedUntil = new Date(Date.now() + hours * 3600000);
      }
    }
    const c = await Circle.findByIdAndUpdate(
      circleId,
      { $set: { suspended, suspendedUntil: suspended ? suspendedUntil : null } },
      { new: true }
    );
    if (!c) return res.status(404).json({ success: false, message: "Circle not found" });
    return res.json({
      success: true,
      suspended: !!c.suspended,
      suspendedUntil: c.suspendedUntil || null,
    });
  } catch (e) {
    console.error("admin circle suspension:", e);
    return res.status(500).json({ success: false, message: "Failed to update suspension" });
  }
});

/** Superadmin: send warning-style in-app notification to circle admins or all members. */
router.post("/circles/:id/warning", async (req, res) => {
  try {
    const circleId = req.params.id;
    if (!mongoose.isValidObjectId(circleId)) {
      return res.status(400).json({ success: false, message: "Invalid circle id" });
    }
    const circle = await Circle.findById(circleId);
    if (!circle) return res.status(404).json({ success: false, message: "Circle not found" });
    const message = String(req.body?.message || "").trim();
    const audience = req.body?.audience === "all_members" ? "all_members" : "admins_only";
    if (!message) return res.status(400).json({ success: false, message: "message required" });

    const q =
      audience === "all_members"
        ? { circle: circle._id }
        : { circle: circle._id, is_admin: true };
    const memberships = await CircleMembership.find(q).select("user").lean();
    const text = `[Warning] ${circle.name}: ${message}`;
    let n = 0;
    for (const m of memberships) {
      if (!m.user) continue;
      await Notification.create({
        recipient: m.user,
        sender: null,
        post: null,
        circle: circle._id,
        notification_type: "warning",
        message: text,
        is_read: false,
        acknowledged: false,
        target_url: `/circle/${circle._id}`,
      });
      n += 1;
    }
    return res.json({ success: true, delivered: n });
  } catch (e) {
    console.error("admin circle warning:", e);
    return res.status(500).json({ success: false, message: "Failed to send warning" });
  }
});

// ---------- Reports ----------
router.get("/reports", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const status = req.query.status;
    const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;

    const q = {};
    if (status === "pending") q.resolved = false;
    if (status === "resolved") q.resolved = true;
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) q.createdAt = { $gte: dateFrom };
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const posts = await Post.find({ content: re }).distinct("_id");
      const reporters = await User.find({ email: re }).distinct("_id");
      q.$or = [
        { reason: re },
        ...(posts.length ? [{ post: { $in: posts } }] : []),
        ...(reporters.length ? [{ reported_by: { $in: reporters } }] : []),
      ];
    }

    const [total, rows, statsPack] = await Promise.all([
      PostReport.countDocuments(q),
      PostReport.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("reported_by", "email")
        .populate("post", "content")
        .lean(),
      Promise.all([
        PostReport.countDocuments({}),
        PostReport.countDocuments({ resolved: false }),
        PostReport.countDocuments({ resolved: true }),
        PostReport.countDocuments({ createdAt: { $gte: startOfToday() } }),
      ]),
    ]);
    const [total_reports, pending_reports, resolved_reports, reports_today] = statsPack;

    return res.json({
      success: true,
      items: rows.map((r) => ({
        id: String(r._id),
        reason: (r.reason || "").slice(0, 200),
        resolved: r.resolved,
        createdAt: r.createdAt,
        reporterEmail: r.reported_by?.email || "",
        postId: r.post ? String(r.post._id) : "",
        postPreview: r.post?.content ? String(r.post.content).slice(0, 80) : "",
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
      stats: { total_reports, pending_reports, resolved_reports, reports_today },
    });
  } catch (e) {
    console.error("admin reports list:", e);
    return res.status(500).json({ success: false, message: "Failed to list reports" });
  }
});

router.get("/reports/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const r = await PostReport.findById(req.params.id)
      .populate("reported_by", "email")
      .populate({ path: "post", populate: { path: "user", select: "email" } })
      .lean();
    if (!r) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({
      success: true,
      report: {
        id: String(r._id),
        reason: r.reason,
        resolved: r.resolved,
        createdAt: r.createdAt,
        reporterEmail: r.reported_by?.email,
        post: r.post
          ? {
              id: String(r.post._id),
              content: r.post.content,
              authorEmail: r.post.user?.email,
            }
          : null,
      },
    });
  } catch (e) {
    console.error("admin report detail:", e);
    return res.status(500).json({ success: false, message: "Failed to load report" });
  }
});

router.post("/reports/:id/resolve", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const r = await PostReport.findByIdAndUpdate(req.params.id, { $set: { resolved: true } }, { new: true });
    if (!r) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin resolve report:", e);
    return res.status(500).json({ success: false, message: "Failed" });
  }
});

router.post("/reports/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !["resolve", "delete_posts"].includes(action)) {
      return res.status(400).json({ success: false, message: "ids[] and action resolve|delete_posts required" });
    }
    const oids = ids.filter((id) => mongoose.isValidObjectId(id));
    const reports = await PostReport.find({ _id: { $in: oids } }).lean();
    if (action === "resolve") {
      const r = await PostReport.updateMany({ _id: { $in: oids } }, { $set: { resolved: true } });
      return res.json({ success: true, modified: r.modifiedCount });
    }
    let deletedPosts = 0;
    for (const rep of reports) {
      if (rep.post) {
        const d = await adminHardDeletePost(String(rep.post));
        if (d.ok) deletedPosts += 1;
      }
    }
    await PostReport.updateMany({ _id: { $in: oids } }, { $set: { resolved: true } });
    return res.json({ success: true, deletedPosts });
  } catch (e) {
    console.error("admin reports bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk failed" });
  }
});

router.delete("/reports/post/:postId", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.postId)) {
      return res.status(400).json({ success: false, message: "Invalid post id" });
    }
    const r = await adminHardDeletePost(req.params.postId);
    if (!r.ok) return res.status(404).json({ success: false, message: r.message });
    await PostReport.updateMany({ post: req.params.postId }, { $set: { resolved: true } });
    return res.json({ success: true });
  } catch (e) {
    console.error("admin delete reported post:", e);
    return res.status(500).json({ success: false, message: "Failed" });
  }
});

// ---------- Flagged (moderation queue) ----------
router.get("/flagged-posts", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const pendingOnly = req.query.pending !== "false";

    const q = pendingOnly ? { reviewed_by_admin: false } : {};
    const [total, rows] = await Promise.all([
      ModerationQueue.countDocuments(q),
      ModerationQueue.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "email")
        .populate({
          path: "post",
          select: "content circle",
          populate: [
            { path: "user", select: "email" },
            { path: "circle", select: "name" },
          ],
        })
        .lean(),
    ]);

    const postIds = rows.map((r) => r.post?._id).filter(Boolean);
    const reportAgg =
      postIds.length > 0
        ? await PostReport.aggregate([
            { $match: { post: { $in: postIds }, resolved: false } },
            { $group: { _id: "$post", c: { $sum: 1 } } },
          ])
        : [];
    const openReportsByPost = new Map(reportAgg.map((x) => [String(x._id), x.c]));

    return res.json({
      success: true,
      items: rows.map((row) => {
        const pid = row.post ? String(row.post._id) : "";
        const openRep = pid ? openReportsByPost.get(pid) || 0 : 0;
        const sightRisk = row.reason === "sightengine_text" || row.reason === "sightengine_image" ? 35 : 20;
        const risk_score = Math.max(0, Math.min(100, 100 - openRep * 6 - sightRisk));
        return {
          id: String(row._id),
          reason: row.reason,
          text: (row.text || "").slice(0, 200),
          reviewed_by_admin: row.reviewed_by_admin,
          createdAt: row.createdAt,
          reporterContext: row.user?.email,
          postId: pid,
          postPreview: row.post?.content ? String(row.post.content).slice(0, 120) : "",
          postAuthorEmail: row.post?.user?.email,
          circleName: row.post?.circle?.name || "",
          open_reports: openRep,
          risk_score,
        };
      }),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) || 1 },
    });
  } catch (e) {
    console.error("admin flagged list:", e);
    return res.status(500).json({ success: false, message: "Failed to list flagged items" });
  }
});

router.get("/flagged-posts/:id", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const row = await ModerationQueue.findById(req.params.id)
      .populate("user", "email")
      .populate({ path: "post", populate: { path: "user", select: "email" } })
      .lean();
    if (!row) return res.status(404).json({ success: false, message: "Not found" });
    return res.json({
      success: true,
      item: {
        id: String(row._id),
        reason: row.reason,
        text: row.text,
        image: row.image,
        reviewed_by_admin: row.reviewed_by_admin,
        createdAt: row.createdAt,
        reporterEmail: row.user?.email,
        post: row.post
          ? {
              id: String(row.post._id),
              content: row.post.content,
              authorEmail: row.post.user?.email,
            }
          : null,
      },
    });
  } catch (e) {
    console.error("admin flagged detail:", e);
    return res.status(500).json({ success: false, message: "Failed" });
  }
});

router.post("/flagged-posts/:id/review", async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }
    const action = (req.body && req.body.action) || "";
    const entry = await ModerationQueue.findById(req.params.id);
    if (!entry) return res.status(404).json({ success: false, message: "Not found" });

    if (action === "approve") {
      entry.reviewed_by_admin = true;
      await entry.save();
      return res.json({ success: true });
    }
    if (action === "delete") {
      const postId = entry.post ? String(entry.post) : null;
      if (postId) await adminHardDeletePost(postId);
      await ModerationQueue.findByIdAndDelete(entry._id);
      return res.json({ success: true });
    }
    return res.status(400).json({ success: false, message: "action approve|delete required" });
  } catch (e) {
    console.error("admin flagged review:", e);
    return res.status(500).json({ success: false, message: "Failed" });
  }
});

router.post("/flagged-posts/bulk", async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    if (!Array.isArray(ids) || !ids.length || !["approve", "delete"].includes(action)) {
      return res.status(400).json({ success: false, message: "ids[] and action approve|delete required" });
    }
    const oids = ids.filter((id) => mongoose.isValidObjectId(id));
    const entries = await ModerationQueue.find({ _id: { $in: oids } });
    if (action === "approve") {
      const r = await ModerationQueue.updateMany({ _id: { $in: oids } }, { $set: { reviewed_by_admin: true } });
      return res.json({ success: true, modified: r.modifiedCount });
    }
    let n = 0;
    for (const e of entries) {
      if (e.post) await adminHardDeletePost(String(e.post));
      await ModerationQueue.findByIdAndDelete(e._id);
      n += 1;
    }
    return res.json({ success: true, processed: n });
  } catch (e) {
    console.error("admin flagged bulk:", e);
    return res.status(500).json({ success: false, message: "Bulk failed" });
  }
});

// ---------- Analytics (summary + 30d trend) ----------
router.get("/analytics", async (req, res) => {
  try {
    const now = new Date();
    const dates = [];
    const newUsers = [];
    const newPosts = [];
    const engagement = [];
    for (let i = 29; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const ds = new Date(day);
      ds.setHours(0, 0, 0, 0);
      const de = new Date(day);
      de.setHours(23, 59, 59, 999);
      dates.push(ds.toISOString().slice(0, 10));
      const [u, p, l, c] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: ds, $lte: de } }),
        Post.countDocuments({ createdAt: { $gte: ds, $lte: de } }),
        Like.countDocuments({ createdAt: { $gte: ds, $lte: de } }),
        Comment.countDocuments({ is_deleted: false, createdAt: { $gte: ds, $lte: de } }),
      ]);
      newUsers.push(u);
      newPosts.push(p);
      engagement.push(l + c);
    }

    const [circles, memberships, pending_reports, flagged_pending] = await Promise.all([
      Circle.countDocuments({}),
      CircleMembership.countDocuments({}),
      PostReport.countDocuments({ resolved: false }),
      ModerationQueue.countDocuments({ reviewed_by_admin: false }),
    ]);

    return res.json({
      success: true,
      summary: { circles, memberships, pending_reports, flagged_pending },
      trend_30d: { dates, newUsers, newPosts, engagement },
    });
  } catch (e) {
    console.error("admin analytics:", e);
    return res.status(500).json({ success: false, message: "Failed analytics" });
  }
});

export default router;
