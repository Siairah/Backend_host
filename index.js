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
import toggleLikeRoute from "./toggleLike.js";
import addCommentRoute from "./addComment.js";
import circleRoutes from "./circleRoutes.js";
import chatRoutes from "./chatRoutes.js";
import notificationRoutes from "./notificationRoutes.js";

const app = express();
app.use(json());

// ✅ CORS
app.use(cors({
  origin: [
    "http://localhost:3000",             // dev frontend
    "https://backend-host-wgti.onrender.com" // deployed frontend
  ],
  credentials: true,
}));

// Create HTTP server and Socket.IO (must be before routes that use req.io)
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: [
      "http://localhost:3000",
      "https://backend-host-wgti.onrender.com"
    ],
    credentials: true,
  },
});

// Attach io to all requests so chat routes can emit
app.use((req, res, next) => {
  req.io = io;
  next();
});

import dotenv from 'dotenv';
dotenv.config();

const mongoURI = process.env.MONGODB_URI;

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Root test route
app.get("/", (req, res) => res.send("Backend is working"));

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

// Post Management Routes (Django logic)
app.use("/create-post", createPostRoute);
app.use("/get-posts", getPostsRoute);
app.use("/toggle-like", toggleLikeRoute);
app.use("/add-comment", addCommentRoute);
app.use("/get-comments", addCommentRoute);

// Circle Management Routes (Django logic)
app.use("/circles", circleRoutes);

// Chat Management Routes (Django logic)
app.use("/chat", chatRoutes);

// Notification Routes
app.use("/notifications", notificationRoutes);

// Debug/Test Route
app.use("/test-profile", testProfileRoute);

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
      socket.join(`notif_${userId}`);
      socket.join(userId); // Also join user ID room for chat events (group_created, dm_created)
      socket.emit("tab_registered", { success: true, tabId, room: `notif_${userId}` });
      console.log(`Tab ${tabId} registered for user ${userId}`);
    } else {
      socket.emit("tab_registered", { success: false });
    }
  });

  socket.on("update_tab_auth", (data) => {
    socket.emit("auth_updated", { success: true });
  });

  socket.on("disconnect", () => {
    console.log("❌ Socket disconnected:", socket.id);
  });
});

// Server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
