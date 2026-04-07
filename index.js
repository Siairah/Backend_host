import dotenv from 'dotenv';
dotenv.config();

import express, { json } from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import mongoose from "mongoose";
import cors from "cors";

// Active routes used in frontend
import loginRoute from "./login.js";
import forgotPasswordRoute from "./forgotPassword.js";
import resetPasswordRoute from "./resetPassword.js";
import profileSetupRoute from "./profileSetup.js";
import sendOtpOnlyRoute from "./sendOtpOnly.js";
import checkEmailRoute from "./checkEmail.js";
import completeRegistrationRoute from "./completeRegistration.js";
import getUserProfileRoute from "./getUserProfile.js";
import testProfileRoute from "./testProfile.js";

// Post, Circle, Like, Comment routes (Django logic)
import createPostRoute from "./createPost.js";
import getPostsRoute from "./getPosts.js";
import getPostByIdRoute from "./getPostById.js";
import deletePostRoute from "./deletePost.js";
import editPostRoute from "./editPost.js";
import toggleLikeRoute from "./toggleLike.js";
import addCommentRoute from "./addComment.js";
import circleRoutes from "./circleRoutes.js";
import getCircleDetailsRoute from "./getCircleDetails.js";
import chatRoutes from "./chatRoutes.js";
import notificationRoutes from "./notificationRoutes.js";
import getUserModerationStatusRoute from "./getUserModerationStatus.js";
import getModerationHistoryRoute from "./getModerationHistory.js";
import getUserPostsRoute from "./getUserPosts.js";
import getUserGalleryRoute from "./getUserGallery.js";
import reportPostRoute from "./reportPost.js";
import getSharedCirclePostsRoute from "./getSharedCirclePosts.js";
import eventRoutes from "./eventRoutes.js";
import adminRoutes from "./adminRoutes.js";

const app = express();
app.use(json());

// ✅ CORS - allow everywhere (localhost any port, 127.0.0.1, env URLs, vercel, netlify, etc.)
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // Allow requests with no origin (Postman, mobile, same-origin)
    const allowed = [
      /^https?:\/\/localhost(:\d+)?$/,
      /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
      /\.vercel\.app$/,
      /\.netlify\.app$/,
      /\.onrender\.com$/,
      /\.railway\.app$/,
    ];
    const envOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (envOrigins.includes(origin)) return callback(null, true);
    if (allowed.some((pattern) => pattern.test(origin))) return callback(null, true);
    callback(null, true); // Allow all for flexibility - set to callback(new Error('Not allowed')) to restrict
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
};

app.use(cors(corsOptions));

// Create HTTP server and Socket.IO (must be before routes that use req.io)
const httpServer = createServer(app);
const socketCorsOrigins = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /\.vercel\.app$/,
  /\.netlify\.app$/,
  /\.onrender\.com$/,
  /\.railway\.app$/,
];
const envCorsOrigins = (process.env.CORS_ORIGINS || process.env.FRONTEND_URL || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const io = new Server(httpServer, {
  cors: {
    origin: envCorsOrigins.length ? [...socketCorsOrigins, ...envCorsOrigins] : socketCorsOrigins,
    credentials: true,
    methods: ['GET', 'POST'],
  },
});

// Attach io to all requests so chat routes can emit
app.use((req, res, next) => {
  req.io = io;
  next();
});

/** Ref-count tabs per user so "online" stays true until last tab disconnects */
const onlineUserRefCount = new Map();

function adjustOnlineRef(userId, delta) {
  const uid = userId != null ? String(userId) : "";
  if (!uid) return { prev: 0, next: 0 };
  const prev = onlineUserRefCount.get(uid) || 0;
  const next = Math.max(0, prev + delta);
  if (next === 0) onlineUserRefCount.delete(uid);
  else onlineUserRefCount.set(uid, next);
  return { prev, next };
}

const mongoURI = process.env.MONGODB_URI;

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Root test route
app.get("/", (req, res) => res.send("Backend is working"));

// Verify moderation is active (hit /api/ping-moderation to confirm correct backend)
app.get("/ping-moderation", (req, res) => res.json({ ok: true, moderation: "enabled", version: "v2" }));

// Admin (dashboard stats — JWT from POST /admin/login)
app.use("/admin", adminRoutes);

// Authentication & Registration Routes
app.use("/check-email", checkEmailRoute);
app.use("/send-otp", sendOtpOnlyRoute);
app.use("/complete-registration", completeRegistrationRoute);
app.use("/login", loginRoute);

// Password Reset Routes
app.use("/forgot-password", forgotPasswordRoute);
app.use("/reset-password", resetPasswordRoute);

// Profile Management Routes
app.use("/profile-setup", profileSetupRoute);
app.use("/get-user-profile", getUserProfileRoute);

// User posts and gallery (profile page)
app.use(getUserPostsRoute);
app.use(getUserGalleryRoute);

// Posts - report and shared circle posts
app.use("/posts", reportPostRoute);
app.use("/posts", getSharedCirclePostsRoute);

// Post Management Routes 
app.use("/create-post", createPostRoute);
app.use("/get-posts", getPostsRoute);
app.use("/get-post", getPostByIdRoute);
app.use("/delete-post", deletePostRoute);
app.use("/edit-post", editPostRoute);
app.use("/toggle-like", toggleLikeRoute);
app.use("/add-comment", addCommentRoute);
app.use("/get-comments", addCommentRoute);

// Circle Management Routes 
app.use("/circles", circleRoutes);
app.use("/circle-details", getCircleDetailsRoute);

// Chat Management Routes
app.use("/chat", chatRoutes);

// Circle Events (admin add/delete, members reserve)
app.use("/events", eventRoutes);

// Notification Routes
app.use("/notifications", notificationRoutes);

// User moderation status (for moderation history page)
app.use("/user-moderation-status", getUserModerationStatusRoute);

// Moderation history (admin view)
app.use("/moderation-history", getModerationHistoryRoute);

// Debug/Test Route
app.use("/test-profile", testProfileRoute);

// Debug: test content detection (POST JSON { content: "I will kill you" })
app.post("/debug-check-content", (req, res) => {
  const content = (req.body?.content ?? '').trim();
  let flagged = false;
  let reason = null;
  const threatPatterns = [
    /\b(i will|i'll|im gonna|i'm gonna|going to)\s+(kill|murder|hurt|harm|attack)\s+(you|them|him|her)\b/i,
    /\b(kill|murder)\s+(you|yourself|them)\b/i,
    /\b(will|gonna)\s+kill\s+you\b/i,
    /\bi\s+will\s+kill\b/i,
    /\bkill\s+you\b/i
  ];
  for (const re of threatPatterns) {
    if (re.test(content)) {
      flagged = true;
      reason = 'Violence/threat content detected';
      break;
    }
  }
  res.json({ content, flagged, reason });
});

// Socket.IO connection handlers (io already created above)
io.on("connection", (socket) => {
  console.log("✅ Socket connected:", socket.id);

  socket.on("join_room", (roomId) => {
    if (roomId) {
      socket.join(roomId);
      console.log(`Socket ${socket.id} joined room: ${roomId}`);
    }
  });

  socket.on("leave_room", (roomId) => {
    if (roomId) {
      socket.leave(roomId);
      console.log(`Socket ${socket.id} left room: ${roomId}`);
    }
  });

  socket.on("register_tab", (data) => {
    const { tabId, userId, token } = data || {};
    if (userId) {
      const uid = String(userId);
      socket.data.appUserId = uid;
      socket.join(`notif_${uid}`);
      socket.join(uid); // Also join user ID room for chat events (group_created, dm_created)
      socket.emit("tab_registered", { success: true, tabId, room: `notif_${uid}` });
      const { prev, next } = adjustOnlineRef(uid, 1);
      if (prev === 0 && next > 0) {
        io.emit("user_presence", { userId: uid, online: true });
      }
      const snapshotIds = [...onlineUserRefCount.entries()]
        .filter(([, c]) => c > 0)
        .map(([id]) => id);
      socket.emit("presence_snapshot", { onlineUserIds: snapshotIds });
      console.log(`Tab ${tabId} registered for user ${uid}`);
    } else {
      socket.emit("tab_registered", { success: false });
    }
  });

  socket.on("update_tab_auth", (data) => {
    socket.emit("auth_updated", { success: true });
  });

  /** WebRTC 1:1 signaling — forward to target user's room (joined on register_tab) */
  socket.on("webrtc_signal", (data) => {
    try {
      if (!data || typeof data !== "object") return;
      const to = data.to != null ? String(data.to) : "";
      if (!to) return;
      io.to(to).emit("webrtc_signal", data);
    } catch (e) {
      console.error("webrtc_signal relay error:", e);
    }
  });

  /** Let clients fetch current online users after mount (avoids missing snapshot sent with register_tab) */
  socket.on("request_presence", () => {
    try {
      const snapshotIds = [...onlineUserRefCount.entries()]
        .filter(([, c]) => c > 0)
        .map(([id]) => id);
      socket.emit("presence_snapshot", { onlineUserIds: snapshotIds });
    } catch (e) {
      console.error("request_presence error:", e);
    }
  });

  socket.on("disconnect", () => {
    const uid = socket.data?.appUserId;
    if (uid) {
      const { prev, next } = adjustOnlineRef(uid, -1);
      if (prev > 0 && next === 0) {
        io.emit("user_presence", { userId: uid, online: false });
      }
    }
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// Server - fixed port (no auto-increment). Set PORT in .env to change.
const PORT = parseInt(process.env.PORT || '5001', 10);

httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   Frontend: NEXT_PUBLIC_API_URL=http://localhost:${PORT} in .env.local`);
});
