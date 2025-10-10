import express, { json } from "express";
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

// Debug/Test Route
app.use("/test-profile", testProfileRoute);

// Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
