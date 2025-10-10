import { Router } from "express";
import sendOtpEmail from "./sendOtpEmail.js";

const router = Router();

// Send OTP email only (for registration flow)
router.post("/", async (req, res) => {
  const { email, otp, purpose } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Email and OTP are required" 
    });
  }

  try {
    // Use the existing sendOtpEmail function
    await sendOtpEmail(email, otp);
    
    console.log(`✅ OTP email sent successfully to ${email} for ${purpose || 'verification'}`);
    
    return res.status(200).json({
      success: true,
      message: "OTP sent successfully"
    });
  } catch (error) {
    console.error("❌ Failed to send OTP email:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send OTP email"
    });
  }
});

export default router;
