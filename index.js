import express, { json } from "express";
import mongoose from "mongoose";
import cors from "cors";

import signupRoute from "./signup.js";
import loginRoute from "./login.js";
import forgotPasswordRoute from "./forgotPassword.js";
import verifyOtpRoute from "./verifyOtp.js";
import resetPasswordRoute from "./resetPassword.js";
import categoryRoute from "./category.js";

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

// MongoDB connection
const mongoURI =
  "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch(err => console.error("❌ MongoDB connection error:", err));

// Root test route
app.get("/", (req, res) => res.send("Backend is working"));

// Auth routes
app.use("/signup", signupRoute);
app.use("/login", loginRoute);
app.use("/forgot-password", forgotPasswordRoute);
app.use("/verify-otp", verifyOtpRoute);
app.use("/reset-password", resetPasswordRoute);
app.use("/category", categoryRoute);

// Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
