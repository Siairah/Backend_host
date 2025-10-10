import { Router } from "express";
import multer from "multer";
import cloudinary from "./cloudinaryConfig.js";
import { Circle, CircleMembership, CircleJoinRequest } from "./models/circle.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// POST /circles/create (Django logic)
router.post("/create", upload.single("cover_image"), async (req, res) => {
  try {
    const { name, description, rules, visibility, created_by } = req.body;
    
    if (!name || !created_by) {
      return res.status(400).json({ success: false, message: "Name and creator required" });
    }

    const existing = await Circle.findOne({ name: name.trim() });
    if (existing) {
      return res.status(400).json({ success: false, message: "Circle name already exists" });
    }

    let coverImageUrl = null;
    if (req.file) {
      try {
        const uploaded = await new Promise((resolve, reject) => {
          const stream = cloudinary.uploader.upload_stream(
            { folder: "circles" }, 
            (err, result) => {
              if (err) reject(err);
              else resolve(result);
            }
          );
          stream.end(req.file.buffer);
        });
        coverImageUrl = uploaded.secure_url;
      } catch (err) {
        console.error('Cover image upload error:', err);
      }
    }

    const circle = await Circle.create({
      name: name.trim(),
      description: description || '',
      rules: rules || '',
      cover_image: coverImageUrl,
      created_by: created_by,
      visibility: visibility || 'public'
    });

    // Django logic: creator becomes admin member
    await CircleMembership.create({
      user: created_by,
      circle: circle._id,
      is_admin: true
    });

    return res.status(201).json({
      success: true,
      message: "Circle created successfully",
      circle: { id: circle._id, name: circle.name }
    });

  } catch (error) {
    console.error("❌ Create circle error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// GET /circles/list (Django logic)
router.get("/list", async (req, res) => {
  try {
    const { user_id } = req.query;
    
    let circles;
    
    if (user_id) {
      const memberships = await CircleMembership.find({ user: user_id }).populate('circle');
      
      circles = await Promise.all(memberships.map(async (membership) => {
        const memberCount = await CircleMembership.countDocuments({ circle: membership.circle._id });
        
        return {
          id: membership.circle._id,
          name: membership.circle.name,
          description: membership.circle.description,
          cover_image: membership.circle.cover_image,
          visibility: membership.circle.visibility,
          member_count: memberCount,
          is_admin: membership.is_admin
        };
      }));
    } else {
      const allCircles = await Circle.find({ visibility: 'public' });
      
      circles = await Promise.all(allCircles.map(async (circle) => {
        const memberCount = await CircleMembership.countDocuments({ circle: circle._id });
        
        return {
          id: circle._id,
          name: circle.name,
          description: circle.description,
          cover_image: circle.cover_image,
          visibility: circle.visibility,
          member_count: memberCount
        };
      }));
    }

    return res.json({ success: true, circles: circles });

  } catch (error) {
    console.error("❌ Get circles error:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

// POST /circles/join (Django logic)
router.post("/join", async (req, res) => {
  try {
    const { user_id, circle_id } = req.body;
    
    if (!user_id || !circle_id) {
      return res.status(400).json({ success: false, message: "User ID and Circle ID required" });
    }

    const circle = await Circle.findById(circle_id);
    if (!circle) {
      return res.status(404).json({ success: false, message: "Circle not found" });
    }

    const existingMembership = await CircleMembership.findOne({ user: user_id, circle: circle_id });
    if (existingMembership) {
      return res.status(400).json({ success: false, message: "Already a member" });
    }

    // Django logic: public = instant join, private = request
    if (circle.visibility === 'public') {
      await CircleMembership.create({
        user: user_id,
        circle: circle_id,
        is_admin: false
      });

      return res.json({ success: true, message: "Joined circle successfully" });
    } else {
      await CircleJoinRequest.create({
        user: user_id,
        circle: circle_id
      });

      return res.json({ success: true, message: "Join request sent" });
    }

  } catch (error) {
    console.error("❌ Join circle error:", error);
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: "Already requested" });
    }
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

export default router;

