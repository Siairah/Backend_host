import { Router } from "express";
import mongoose from "mongoose";
const { connection } = mongoose;

import { compare } from "bcrypt";

const router = Router();

// Reuse your existing User model
import { User } from "./models/index.js"; 

// POST /login
router.post("/", async (req, res) => {
  const { email, password } = req.body;

  console.log("Login attempt:", req.body);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error("Login route error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
