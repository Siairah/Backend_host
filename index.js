require('dotenv').config();
const express = require("express");
const mongoose = require("mongoose");
const signupRoute = require("./signup");
const loginRoute = require("./login");
const forgotPasswordRoute = require("./forgotPassword"); // ✅ OTP route

const app = express();
app.use(express.json());

// MongoDB connection
const mongoURI = "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Root test route
app.get("/", (req, res) => {
  console.log("📥 GET / hit");
  res.send("Backend is working ✅");
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

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
