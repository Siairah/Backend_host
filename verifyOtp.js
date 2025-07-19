import { Router } from "express";
import mongoose from "mongoose";
const { connection } = mongoose;

import { User } from "./models/index.js"; // Adjust the path as necessary

const router = Router();

router.post("/", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    console.log('[OTP VERIFY] Missing email or OTP');
    return res.status(400).json({ 
      success: false, 
      message: "Email and OTP required" 
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP VERIFY] Attempt for ${normalizedEmail} with OTP: ${otp}`);

  try {
    const collection = connection.db.collection('users');
    
    // First check for valid, unexpired OTP
    const user = await collection.findOne({
      email: normalizedEmail,
      otp: otp,
      otpExpiresAt: { $gt: new Date() }
    });

    if (user) {
      console.log(`[OTP SUCCESS] Valid OTP for ${normalizedEmail}`);
      
      // Clear OTP after successful verification
      await collection.updateOne(
        { _id: user._id },
        { $unset: { otp: "", otpExpiresAt: "" } }
      );
      
      return res.status(200).json({ 
        success: true, 
        message: "OTP verified successfully" 
      });
    }

    // Check for expired OTP
    const expiredUser = await collection.findOne({
      email: normalizedEmail,
      otp: { $exists: true }
    });

    if (expiredUser) {
      console.log(`[OTP EXPIRED] For ${normalizedEmail} at ${expiredUser.otpExpiresAt}`);
      
      // Clean up expired OTP
      await collection.updateOne(
        { _id: expiredUser._id },
        { $unset: { otp: "", otpExpiresAt: "" } }
      );
      
      return res.status(400).json({ 
        success: false, 
        message: "OTP expired" 
      });
    }

    console.log(`[OTP INVALID] No matching OTP for ${normalizedEmail}`);
    return res.status(400).json({ 
      success: false, 
      message: "Invalid OTP or user" 
    });

  } catch (error) {
    console.error('[VERIFICATION ERROR]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      stack: error.stack
    });
    
    return res.status(500).json({ 
      success: false, 
      message: "Verification failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;