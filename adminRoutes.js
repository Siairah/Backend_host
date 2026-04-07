import { Router } from "express";
import jwt from "jsonwebtoken";
import { User } from "./models/index.js";
import { Post, PostReport, ModerationQueue, Comment, Like, PostMedia } from "./models/post.js";
import { verifyAdmin, adminJwtSecret } from "./adminAuthMiddleware.js";
import adminManagementApi from "./adminManagementApi.js";

function getAdminCreds() {
  const email = (process.env.ADMIN_EMAIL || "admin12@gmail.com").toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || "Itachi@123";
  return { email, password };
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function calculateGrowthRate(todayVal, yesterdayVal) {
  const t = Number(todayVal) || 0;
  const y = Number(yesterdayVal) || 0;
  if (y === 0) return t > 0 ? 100 : 0;
  return Math.round(((t - y) / y) * 1000) / 10;
}

const router = Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body || {};
  const { email: admE, password: admP } = getAdminCreds();
  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password required" });
  }
  if (email.trim().toLowerCase() !== admE || password !== admP) {
    return res.status(401).json({ success: false, message: "Invalid admin credentials" });
  }
  const token = jwt.sign({ type: "admin", email: admE }, adminJwtSecret(), { expiresIn: "7d" });
  return res.json({ success: true, token });
});

router.get("/dashboard-stats", verifyAdmin, async (req, res) => {
  try {
    const now = new Date();
    const today = startOfDay(now);
    const yesterdayStart = startOfDay(new Date(now.getTime() - 86400000));
    const yesterdayEnd = endOfDay(new Date(now.getTime() - 86400000));
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const endToday = endOfDay(now);

    const [
      total_users,
      new_users_today,
      online_users,
      total_posts,
      posts_today,
      posts_yesterday,
      posts_media_ids,
      total_likes,
      likes_today,
      total_comments,
      comments_today,
      flagged_posts,
      pending_reports,
      reports_today,
      likes_yesterday,
      comments_yesterday,
      new_users_yesterday,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ createdAt: { $gte: today, $lte: endToday } }),
      User.countDocuments({ updatedAt: { $gte: fiveMinAgo } }),
      Post.countDocuments({ is_public: true }),
      Post.countDocuments({ is_public: true, createdAt: { $gte: today, $lte: endToday } }),
      Post.countDocuments({
        is_public: true,
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      PostMedia.distinct("post"),
      Like.countDocuments({}),
      Like.countDocuments({ createdAt: { $gte: today, $lte: endToday } }),
      Comment.countDocuments({ is_deleted: false }),
      Comment.countDocuments({
        is_deleted: false,
        createdAt: { $gte: today, $lte: endToday },
      }),
      ModerationQueue.countDocuments({ reviewed_by_admin: false }),
      PostReport.countDocuments({ resolved: false }),
      PostReport.countDocuments({ createdAt: { $gte: today, $lte: endToday } }),
      Like.countDocuments({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      Comment.countDocuments({
        is_deleted: false,
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
      User.countDocuments({
        createdAt: { $gte: yesterdayStart, $lte: yesterdayEnd },
      }),
    ]);

    const posts_with_media = Array.isArray(posts_media_ids) ? posts_media_ids.length : 0;

    const latest_posts_raw = await Post.find({ is_public: true })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("user", "email")
      .lean();

    const latest_posts = latest_posts_raw.map((p) => ({
      id: String(p._id),
      content: (p.content || "").slice(0, 200),
      createdAt: p.createdAt,
      authorLabel: p.user?.email || "Unknown",
    }));

    const latest_reports_raw = await PostReport.find({ resolved: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("reported_by", "email")
      .lean();

    const latest_reports = latest_reports_raw.map((r) => ({
      id: String(r._id),
      reason: (r.reason || "").slice(0, 200),
      createdAt: r.createdAt,
      reporterLabel: r.reported_by?.email || "Unknown",
    }));

    const dates = [];
    const user_trend = [];
    const post_trend = [];
    const engagement_trend = [];

    for (let i = 6; i >= 0; i--) {
      const day = new Date(now);
      day.setDate(day.getDate() - i);
      const ds = startOfDay(day);
      const de = endOfDay(day);
      dates.push(ds.toISOString().slice(0, 10));

      const [u, po, li, co] = await Promise.all([
        User.countDocuments({ createdAt: { $gte: ds, $lte: de } }),
        Post.countDocuments({ is_public: true, createdAt: { $gte: ds, $lte: de } }),
        Like.countDocuments({ createdAt: { $gte: ds, $lte: de } }),
        Comment.countDocuments({
          is_deleted: false,
          createdAt: { $gte: ds, $lte: de },
        }),
      ]);
      user_trend.push(u);
      post_trend.push(po);
      engagement_trend.push(li + co);
    }

    const active_users = await User.countDocuments({
      updatedAt: { $gte: sevenDaysAgo },
    });

    const user_stats = {
      total_users,
      new_users_today,
      active_users,
      online_users,
    };

    const post_stats = {
      total_posts,
      posts_today,
      posts_yesterday,
      posts_with_media,
    };

    const engagement_stats = {
      total_likes,
      likes_today,
      total_comments,
      comments_today,
    };

    const moderation_stats = {
      flagged_posts,
      pending_reports,
      reports_today,
    };

    const growth_rates = {
      users: calculateGrowthRate(new_users_today, new_users_yesterday),
      posts: calculateGrowthRate(posts_today, posts_yesterday),
      engagement: calculateGrowthRate(
        likes_today + comments_today,
        likes_yesterday + comments_yesterday
      ),
    };

    return res.json({
      success: true,
      user_stats,
      post_stats,
      engagement_stats,
      moderation_stats,
      recent_activity: {
        latest_posts,
        latest_reports,
      },
      trend_data: {
        dates,
        user_trend,
        post_trend,
        engagement_trend,
      },
      growth_rates,
    });
  } catch (e) {
    console.error("admin dashboard-stats error:", e);
    return res.status(500).json({ success: false, message: "Failed to load dashboard stats" });
  }
});

router.use(adminManagementApi);

export default router;
