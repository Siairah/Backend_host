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

const router = Router();
router.use(verifyAdmin);

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

    const rows = items.map((u) => ({
      id: String(u._id),
      email: u.email,
      phone: u.phone || "",
      isActive: u.isActive,
      createdAt: u.createdAt,
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

// ---------- Posts ----------
router.get("/posts", async (req, res) => {
  try {
    const { page, limit, skip } = pagination(req);
    const search = (req.query.search || "").trim();
    const circleId = req.query.circle_id;
    const hasMedia = req.query.has_media;
    const dateFrom = req.query.date_from ? new Date(req.query.date_from) : null;

    const q = {};
    if (search) {
      const re = new RegExp(escapeRegex(search), "i");
      const users = await User.find({ email: re }).distinct("_id");
      q.$or = [{ content: re }, ...(users.length ? [{ user: { $in: users } }] : [])];
    }
    if (circleId && mongoose.isValidObjectId(circleId)) q.circle = circleId;
    if (hasMedia === "yes") {
      const withMedia = await PostMedia.distinct("post");
      q._id = withMedia.length ? { $in: withMedia } : { $in: [] };
    } else if (hasMedia === "no") {
      const withMedia = await PostMedia.distinct("post");
      if (withMedia.length) q._id = { $nin: withMedia };
    }
    if (dateFrom && !Number.isNaN(dateFrom.getTime())) q.createdAt = { $gte: dateFrom };

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

    const items = await Promise.all(
      posts.map(async (p) => {
        const mediaCount = await PostMedia.countDocuments({ post: p._id });
        return {
          id: String(p._id),
          content: (p.content || "").slice(0, 200),
          is_public: p.is_public,
          is_approved: p.is_approved,
          createdAt: p.createdAt,
          authorEmail: p.user?.email || "",
          circleName: p.circle?.name || "",
          mediaCount,
          commentsCount: await Comment.countDocuments({ post: p._id, is_deleted: false }),
          likesCount: await Like.countDocuments({ post: p._id }),
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
    const media = await PostMedia.find({ post: p._id }).lean();
    return res.json({
      success: true,
      post: {
        id: String(p._id),
        content: p.content,
        is_public: p.is_public,
        is_approved: p.is_approved,
        createdAt: p.createdAt,
        authorEmail: p.user?.email,
        circle: p.circle ? { id: String(p.circle._id), name: p.circle.name } : null,
        media: media.map((m) => ({ id: String(m._id), file: m.file, type: m.type })),
        commentsCount: await Comment.countDocuments({ post: p._id, is_deleted: false }),
        likesCount: await Like.countDocuments({ post: p._id }),
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
        .populate("post", "content")
        .lean(),
    ]);

    return res.json({
      success: true,
      items: rows.map((c) => ({
        id: String(c._id),
        content: (c.content || "").slice(0, 300),
        is_deleted: !!c.is_deleted,
        createdAt: c.createdAt,
        authorEmail: c.user?.email || "",
        postId: c.post ? String(c.post._id) : "",
        postPreview: c.post?.content ? String(c.post.content).slice(0, 80) : "",
      })),
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
      circles.map(async (c) => ({
        id: String(c._id),
        name: c.name,
        description: c.description,
        visibility: c.visibility,
        createdAt: c.createdAt,
        creatorEmail: c.created_by?.email || "",
        memberCount: await CircleMembership.countDocuments({ circle: c._id }),
      }))
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
    const members = await CircleMembership.find({ circle: c._id })
      .sort({ joined_at: -1 })
      .limit(15)
      .populate("user", "email")
      .lean();
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
        memberCount: await CircleMembership.countDocuments({ circle: c._id }),
        members: members.map((m) => ({
          userId: String(m.user?._id),
          email: m.user?.email,
          is_admin: m.is_admin,
          joined_at: m.joined_at,
        })),
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
        .populate({ path: "post", select: "content", populate: { path: "user", select: "email" } })
        .lean(),
    ]);

    return res.json({
      success: true,
      items: rows.map((row) => ({
        id: String(row._id),
        reason: row.reason,
        text: (row.text || "").slice(0, 200),
        reviewed_by_admin: row.reviewed_by_admin,
        createdAt: row.createdAt,
        reporterContext: row.user?.email,
        postId: row.post ? String(row.post._id) : "",
        postPreview: row.post?.content ? String(row.post.content).slice(0, 120) : "",
        postAuthorEmail: row.post?.user?.email,
      })),
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
        Post.countDocuments({ is_public: true, createdAt: { $gte: ds, $lte: de } }),
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
