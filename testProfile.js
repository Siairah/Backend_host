import { Router } from "express";
import User from "./models/models.js";
import Profile from "./models/profile.js";

const router = Router();

// GET /test-profile/:email - Debug endpoint to check profile in database
router.get("/:email", async (req, res) => {
  try {
    const { email } = req.params;
    
    console.log('🔍 Testing profile for:', email);
    
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.json({ success: false, message: "User not found" });
    }
    
    const profile = await Profile.findOne({ user: user._id });
    if (!profile) {
      return res.json({ success: false, message: "Profile not found" });
    }
    
    console.log('✅ Profile found in database:', {
      full_name: profile.full_name,
      bio: profile.bio?.substring(0, 50),
      profile_pic: profile.profile_pic,
      dob: profile.dob,
      gender: profile.gender
    });
    
    return res.json({
      success: true,
      profile: {
        full_name: profile.full_name,
        bio: profile.bio,
        dob: profile.dob,
        gender: profile.gender,
        profile_pic: profile.profile_pic
      }
    });
  } catch (error) {
    console.error("Test profile error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

