const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

async function saveOTP(email, otp, expiresAt) {
  // Method 1: Try native driver first
  try {
    const result = await mongoose.connection.db.collection('users').updateOne(
      { email: email },
      { $set: { otp: otp, otpExpiresAt: expiresAt } },
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
    await User.findOneAndUpdate(
      { email: email },
      { otp: otp, otpExpiresAt: expiresAt },
      { runValidators: true, context: 'query' }
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
    return res.status(400).json({ success: false, message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP] Request for ${normalizedEmail}`);

  try {
    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Persist OTP
    await saveOTP(normalizedEmail, otp, expiresAt);

    // Verify persistence
    const user = await mongoose.connection.db.collection('users').findOne(
      { email: normalizedEmail },
      { projection: { otp: 1, otpExpiresAt: 1 } }
    );

    if (!user || user.otp !== otp) {
      throw new Error('OTP verification failed after save');
    }

    // Send email
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent successfully"
    });

  } catch (error) {
    console.error('[OTP FINAL ERROR]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      dbState: mongoose.connection.readyState,
      dbHost: mongoose.connection.host
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to process OTP request"
    });
  }
});

router.get("/verify-otp/:email", async (req, res) => {
  try {
    const user = await mongoose.connection.db.collection('users').findOne(
      { email: req.params.email },
      { projection: { otp: 1, otpExpiresAt: 1 } }
    );
    
    return res.json({
      success: true,
      otp: user?.otp,
      expiresAt: user?.otpExpiresAt,
      isValid: user?.otpExpiresAt ? new Date() < user.otpExpiresAt : false,
      now: new Date()
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;