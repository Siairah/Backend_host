import { Router } from "express";
import jwt from "jsonwebtoken";
import User from "./models/models.js";
import Profile from "./models/profile.js";

const router = Router();

// GET /get-user-profile
router.get("/", async (req, res) => {
  try {
    // Get token from Authorization header
    const token = req.headers.authorization?.split(" ")[1];
    
    if (!token) {
      return res.status(401).json({ success: false, message: "No token provided" });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || "supersecretkey");
    } catch (err) {
      return res.status(401).json({ success: false, message: "Invalid or expired token" });
    }

    // Find user
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Find profile
    const profile = await Profile.findOne({ user: user._id });

    // Return user data with profile
    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        isActive: user.isActive,
        fullName: profile?.full_name || "User",
        bio: profile?.bio || "",
        dob: profile?.dob || null,
        gender: profile?.gender || null,
        profilePic: profile?.profile_pic || "/images/default_profile.png",
        hasProfile: !!profile
      }
    });
  } catch (error) {
    console.error("Get user profile error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /get-user-profile/:email - Get profile by email
router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    
    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Find profile
    const profile = await Profile.findOne({ user: user._id });

    // Return user data with profile
    return res.json({
      success: true,
      user: {
        id: user._id,
        email: user.email,
        phone: user.phone,
        fullName: profile?.full_name || "User",
        bio: profile?.bio || "",
        dob: profile?.dob || null,
        gender: profile?.gender || null,
        profilePic: profile?.profile_pic || "/images/default_profile.png",
        hasProfile: !!profile
      }
    });
  } catch (error) {
    console.error("Get user profile by email error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;

