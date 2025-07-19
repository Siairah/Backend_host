import express, { json } from "express";
import mongoose from "mongoose";
const { connection } = mongoose;

import signupRoute from "./signup.js";
import loginRoute from "./login.js";
import forgotPasswordRoute from "./forgotPassword.js";
import verifyOtpRoute from "./verifyOtp.js";
import resetPasswordRoute from "./resetPassword.js";
import categoryRoute from "./category.js";

const app = express();
app.use(json());

// MongoDB connection
const mongoURI = "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Root test route
app.get("/", (req, res) => {
  console.log("📥 GET / hit");
  res.send("Backend is working");
});

// Auth routes
app.use("/signup", (req, res, next) => {
  console.log("📥 POST /signup hit");
  next();
}, signupRoute);

app.use("/login", (req, res, next) => {
  console.log("📥 POST /login hit");
  next();
}, loginRoute);

app.use("/forgot-password", (req, res, next) => {
  console.log("📥 POST /forgot-password hit");
  next();
}, forgotPasswordRoute);

app.use("/verify-otp", (req, res, next) => {
  console.log("📥 POST /verify-otp hit");
  next();
}, verifyOtpRoute);

app.use("/reset-password", (req, res, next) => {
  console.log("📥 POST /reset-password hit");
  next();
}, resetPasswordRoute);

app.use("/category", (req, res, next) => {
  console.log("📥 POST /category hit");
  next();
}, categoryRoute);

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
