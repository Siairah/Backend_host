import { Router } from "express";
import { randomInt } from "crypto";
import mongoose from "mongoose";
const { connection } = mongoose;

import sendOtpEmail from "./sendOtpEmail.js";

const router = Router();

async function saveOTP(email, otp, expiresAt) {
  // Method 1: Try native driver first
  try {
    const result = await connection.db.collection('users').updateOne(
      { email: email },
      { $set: { otp: otp, otpExpiresAt: expiresAt, otpCreatedAt: new Date() } },
      { upsert: false }
    );
    
    if (result.modifiedCount === 1) {
      return true;
    }
  } catch (nativeError) {
    console.error('Native driver update failed:', nativeError.message);
  }

  // Method 2: Fallback to Mongoose
  try {
    await connection.db.collection('users').findOneAndUpdate(
      { email: email },
      { $set: { otp: otp, otpExpiresAt: expiresAt, otpCreatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    return true;
  } catch (mongooseError) {
    console.error('Mongoose update failed:', mongooseError.message);
    throw new Error('All persistence methods failed');
  }
}

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ 
      success: false, 
      message: "Email is required" 
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[FORGOT PASSWORD] Request for ${normalizedEmail}`);

  try {
    // Check if user exists
    const user = await connection.db.collection('users').findOne(
      { email: normalizedEmail },
      { projection: { email: 1, isUser: 1 } }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found with that email address"
      });
    }

    // Generate 6-digit OTP
    const otp = randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Save OTP to database
    await saveOTP(normalizedEmail, otp, expiresAt);

    // Send OTP email
    await sendOtpEmail(normalizedEmail, otp);

    console.log(`[FORGOT PASSWORD] OTP sent successfully to ${normalizedEmail}`);

    return res.status(200).json({ 
      success: true, 
      message: "Verification code sent to your email address",
      email: normalizedEmail // Include email for frontend navigation
    });

  } catch (error) {
    console.error('[FORGOT PASSWORD ERROR]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      stack: error.stack
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to send verification code. Please try again later."
    });
  }
});

// Verify OTP for password reset
router.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({
      success: false,
      message: "Email and OTP are required"
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[VERIFY OTP] Attempt for ${normalizedEmail}`);

  try {
    const user = await connection.db.collection('users').findOne(
      { email: normalizedEmail },
      { projection: { otp: 1, otpExpiresAt: 1, email: 1 } }
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "No OTP found for this user"
      });
    }

    // Check if OTP is expired
    const now = new Date();
    if (now > user.otpExpiresAt) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new one."
      });
    }

    // Check if OTP matches
    if (user.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please check and try again."
      });
    }

    console.log(`[VERIFY OTP] OTP verified successfully for ${normalizedEmail}`);

    return res.status(200).json({
      success: true,
      message: "OTP verified successfully",
      email: normalizedEmail
    });

  } catch (error) {
    console.error('[VERIFY OTP ERROR]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date()
    });

    return res.status(500).json({
      success: false,
      message: "Failed to verify OTP. Please try again."
    });
  }
});

export default router;