const express = require("express");
const mongoose = require("mongoose");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Email and OTP required" 
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP VERIFY] Attempt for ${normalizedEmail}`);

  try {
    // Bypass Mongoose and go directly to collection
    const collection = mongoose.connection.db.collection('users');
    const user = await collection.findOne({
      email: normalizedEmail,
      otp: otp,
      otpExpiresAt: { $gt: new Date() }
    });

    if (!user) {
      // Check if OTP exists but expired
      const expiredUser = await collection.findOne({
        email: normalizedEmail,
        otp: { $exists: true }
      });

      if (expiredUser) {
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
      
      return res.status(400).json({ 
        success: false, 
        message: "Invalid OTP or user" 
      });
    }

    // OTP is valid - clear it
    await collection.updateOne(
      { _id: user._id },
      { $unset: { otp: "", otpExpiresAt: "" } }
    );

    return res.status(200).json({ 
      success: true, 
      message: "OTP verified" 
    });

  } catch (error) {
    console.error('[VERIFICATION ERROR]', error);
    return res.status(500).json({ 
      success: false, 
      message: "Verification failed",
      error: error.message
    });
  }
});

module.exports = router;