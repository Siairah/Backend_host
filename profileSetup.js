import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import User from "./models/models.js";
import Profile from "./models/profile.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/", upload.single("profile_pic"), async (req, res) => {
  try {
    const { email, full_name, dob, gender, bio, remove_profile_pic } = req.body;
    
    console.log('📝 Profile update request received:', { 
      email, 
      full_name, 
      dob, 
      gender, 
      bio: bio?.substring(0, 50),
      hasFile: !!req.file,
      removePhoto: remove_profile_pic === 'true'
    });
    
    // Get email from localStorage or request body
    let userEmail = email;
    if (!userEmail) {
      // Try to get from pending user data (stored during signup)
      return res.status(400).json({ success: false, message: "Email required" });
    }

    const user = await User.findOne({ email: userEmail.toLowerCase().trim() });
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    if (!user.isActive) return res.status(403).json({ success: false, message: "User not verified" });

    // Get existing profile first to preserve current profile picture
    let profile = await Profile.findOne({ user: user._id });
    
    // Start with existing profile picture or default
    let profilePicUrl = profile?.profile_pic || '/images/default_profile.png';
    let shouldUpdateProfilePic = false;
    
    // Handle profile picture removal
    if (remove_profile_pic === 'true') {
      console.log('🗑️ User requested to remove profile picture');
      profilePicUrl = '/images/default_profile.png';
      shouldUpdateProfilePic = true;
    }
    // Only upload and update profile picture if a new file is provided
    else if (req.file) {
      console.log('📸 New profile picture provided, uploading to Cloudinary...');
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { 
              folder: "profiles",
              resource_type: "image",
              transformation: [
                { width: 500, height: 500, crop: "limit" },
                { quality: "auto" }
              ]
            }, 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        profilePicUrl = uploaded.secure_url;
        shouldUpdateProfilePic = true;
        console.log('✅ Profile picture uploaded:', profilePicUrl);
      } catch (uploadError) {
        console.error('❌ Cloudinary upload error:', uploadError);
        // Keep existing profile picture if upload fails
        console.log('⚠️ Keeping existing profile picture:', profilePicUrl);
      }
    } else {
      console.log('ℹ️ No new file provided, keeping existing profile picture:', profilePicUrl);
    }

    // Create or update Profile (separate from User like Django)
    if (profile) {
      // Update existing profile - only update provided fields
      console.log('🔄 Updating existing profile...');
      
      if (full_name) profile.full_name = full_name;
      if (dob) profile.dob = dob;
      if (gender) profile.gender = gender;
      if (bio !== undefined) profile.bio = bio; // Allow empty string
      
      // IMPORTANT: Only update profile_pic if new file was uploaded OR user wants to remove it
      if (shouldUpdateProfilePic) {
        profile.profile_pic = profilePicUrl;
        if (remove_profile_pic === 'true') {
          console.log('✅ Profile picture removed, set to default');
        } else {
          console.log('✅ Profile picture updated in database');
        }
      } else {
        console.log('ℹ️ Profile picture unchanged, keeping:', profile.profile_pic);
      }
      
      await profile.save();
      console.log('✅ Profile updated for:', user.email);
      console.log('📸 Profile picture in database after save:', profile.profile_pic);
    } else {
      // Create new profile
      console.log('🆕 Creating new profile...');
      profile = new Profile({
        user: user._id,
        full_name: full_name,
        dob: dob,
        gender: gender,
        bio: bio || '',
        profile_pic: profilePicUrl
      });
      await profile.save();
      console.log('✅ Profile created for:', user.email);
    }

    // Log final profile_pic value before sending response
    console.log('📸 Final profile_pic in database:', profile.profile_pic);
    console.log('📤 Sending response with profile data...');

    const responseData = {
      success: true, 
      message: "Profile updated successfully", 
      user: { 
        email: user.email,
        userId: user._id
      },
      profile: {
        full_name: profile.full_name,
        dob: profile.dob,
        gender: profile.gender,
        bio: profile.bio,
        profile_pic: profile.profile_pic
      }
    };

    console.log('✅ Response profile_pic:', responseData.profile.profile_pic);
    return res.json(responseData);
  } catch (error) {
    console.error("Profile setup error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;






