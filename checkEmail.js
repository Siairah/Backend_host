import { Router } from "express";
import User from "./models/models.js";

const router = Router();

// Check if email already exists
router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: "Email is required" 
    });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    
    if (existingUser) {
      console.log(`Email check: ${normalizedEmail} already exists`);
      return res.status(200).json({ 
        success: true, 
        exists: true,
        message: "Email already registered" 
      });
    }
    
    console.log(`Email check: ${normalizedEmail} is available`);
    return res.status(200).json({ 
      success: true, 
      exists: false,
      message: "Email is available" 
    });
  } catch (error) {
    console.error("Check email error:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error" 
    });
  }
});

export default router;
