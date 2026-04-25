import { Router } from "express";
import { compare } from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "./models/index.js";
import Profile from "./models/profile.js";

const router = Router();

router.post("/", async (req, res) => {
  const { email, password } = req.body;
  console.log("Login attempt:", req.body);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: " Samikshya Email and password are required" });
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

    if (!user.isActive) {
      return res.status(403).json({ 
        success: false, 
        message: "Please verify your email first. Check your inbox for the verification code.",
        requiresVerification: true,
        email: user.email
      });
    }

    if (user.isBanned) {
      const now = new Date();
      if (user.bannedUntil && user.bannedUntil <= now) {
        user.isBanned = false;
        user.bannedUntil = null;
        user.banReason = "";
        await user.save();
      } else {
        const untilMsg = user.bannedUntil
          ? ` Banned until ${user.bannedUntil.toISOString()}.`
          : "";
        return res.status(403).json({
          success: false,
          message: (user.banReason || "Your account has been suspended.") + untilMsg,
          banned: true,
        });
      }
    }

    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || "supersecretkey",
      { expiresIn: "1d" }
    );

    const profile = await Profile.findOne({ user: user._id });
    console.log("📦 Profile data:", profile);
    console.log("🖼️ Profile pic:", profile?.profile_pic);

    const userData = {
      id: user._id,
      fullName: profile?.full_name || user.fullName || "User",
      email: user.email,
      phone: user.phone,
      profilePic: profile?.profile_pic || "/images/default_profile.png",
      bio: profile?.bio || "",
      dob: profile?.dob || null,
      gender: profile?.gender || null,
      hasProfile: !!profile
    };

    console.log("✅ Sending user data:", userData);

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: userData,
    });
  } catch (error) {
    console.error("Login route error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
