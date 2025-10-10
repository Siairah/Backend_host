import { Router } from "express";
import { hash } from "bcrypt";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import User from "./models/models.js";
import Profile from "./models/profile.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Complete registration: Create User + Profile together (after all steps completed)
router.post("/", upload.single("profile_pic"), async (req, res) => {
  try {
    const { email, phone, password, full_name, dob, gender, bio } = req.body;
    
    console.log('Complete registration request:', { 
      email, 
      full_name, 
      dob, 
      gender, 
      hasFile: !!req.file,
      fileName: req.file?.originalname,
      fileSize: req.file?.size,
      fileType: req.file?.mimetype
    });
    
    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({ success: false, message: "Email and password are required" });
    }
    
    if (!full_name || !dob || !gender) {
      return res.status(400).json({ success: false, message: "Profile information is required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    
    // Check if user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await hash(password, 10);

    // Upload profile picture to Cloudinary if provided
    let profilePicUrl = '/images/default_profile.png';
    if (req.file) {
      console.log('📤 Uploading file to Cloudinary...');
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
              if (err) {
                console.error('Cloudinary stream error:', err);
                reject(err);
              } else {
                console.log('Cloudinary upload success:', result.secure_url);
                resolve(result);
              }
            }
          );
          stream.end(req.file.buffer);
        });
        profilePicUrl = uploaded.secure_url;
        console.log('✅ Profile picture uploaded to Cloudinary:', profilePicUrl);
      } catch (uploadError) {
        console.error('❌ Cloudinary upload error:', uploadError);
        console.error('Error details:', uploadError.message);
        // Continue without profile picture (use default)
      }
    } else {
      console.log('ℹ️ No file uploaded, using default profile picture');
    }

    // Create User (ACTIVE from the start since all steps completed)
    const newUser = new User({
      email: normalizedEmail,
      password: hashedPassword,
      phone,
      isActive: true, // User is ACTIVE because they completed all steps
    });

    await newUser.save();
    console.log(`✅ User created: ${normalizedEmail}`);

    // Create Profile
    const newProfile = new Profile({
      user: newUser._id,
      full_name: full_name,
      dob: dob,
      gender: gender,
      bio: bio || '',
      profile_pic: profilePicUrl
    });

    await newProfile.save();
    console.log(`✅ Profile created for: ${normalizedEmail}`);

    return res.status(201).json({
      success: true,
      message: "Registration completed successfully",
      user: {
        id: newUser._id,
        email: newUser.email,
        phone: newUser.phone,
        isActive: newUser.isActive
      },
      profile: {
        full_name: newProfile.full_name,
        dob: newProfile.dob,
        gender: newProfile.gender,
        bio: newProfile.bio,
        profile_pic: newProfile.profile_pic
      }
    });
  } catch (error) {
    console.error("Complete registration error:", error);
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Email already exists" });
    }
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;
