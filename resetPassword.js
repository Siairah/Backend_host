import { Router } from "express";
import mongoose from "mongoose";
const { connection } = mongoose;

import { hash } from "bcryptjs"; // or use bcrypt
import { User } from "./models/index.js"; // Adjust the path as necessary

const router = Router();

router.post("/", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    console.log('[RESET PASSWORD] Missing email or password');
    return res.status(400).json({
      success: false,
      message: "Email and password are required"
    });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    const collection = connection.db.collection("users");

    // Check if user exists
    const user = await collection.findOne({ email: normalizedEmail });

    if (!user) {
      console.log(`[RESET PASSWORD] No user found for ${normalizedEmail}`);
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    // Hash the new password
    const hashedPassword = await hash(password, 10);

    // Update the password and remove OTP fields
    await collection.updateOne(
      { _id: user._id },
      {
        $set: { password: hashedPassword },
        $unset: { otp: "", otpExpiresAt: "" }
      }
    );

    console.log(`[RESET PASSWORD] Password updated for ${normalizedEmail}`);
    return res.status(200).json({
      success: true,
      message: "Password updated successfully"
    });

  } catch (error) {
    console.error('[RESET ERROR]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: "Password reset failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
