const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

// Simple, reliable OTP generation
async function generateAndSaveOTP(email) {
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Direct update without transaction
  const result = await User.updateOne(
    { email: email },
    { 
      $set: { 
        otp: otp,
        otpExpiresAt: expiresAt 
      } 
    },
    { 
      runValidators: true,
      strict: true
    }
  );

  if (result.modifiedCount === 0) {
    throw new Error("No document was modified");
  }

  // Verify with fresh read
  const user = await User.findOne({ email }).lean();
  if (!user || user.otp !== otp) {
    console.error('OTP verification failed:', {
      expected: otp,
      actual: user?.otp,
      userExists: !!user
    });
    throw new Error("OTP not persisted correctly");
  }

  return { otp, expiresAt };
}

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP] Generation request for ${normalizedEmail}`);

  try {
    // Verify DB connection is ready
    if (mongoose.connection.readyState !== 1) {
      throw new Error("Database not connected");
    }

    // Generate and save OTP
    const { otp, expiresAt } = await generateAndSaveOTP(normalizedEmail);
    console.log(`[OTP SUCCESS] Generated for ${normalizedEmail}: ${otp}`);

    // Send email
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent",
      debug: {
        otpSaved: otp,
        expiresAt: expiresAt.toISOString()
      }
    });

  } catch (error) {
    console.error('[OTP FAILURE]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      dbState: mongoose.connection.readyState,
      dbHost: mongoose.connection.host
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to generate OTP",
      error: error.message
    });
  }
});

// Direct database verification endpoint
router.get("/verify-db/:email", async (req, res) => {
  try {
    const user = await User.findOne(
      { email: req.params.email },
      { otp: 1, otpExpiresAt: 1 }
    ).lean();
    
    return res.json({
      exists: !!user,
      otp: user?.otp,
      expiry: user?.otpExpiresAt,
      now: new Date(),
      isValid: user?.otpExpiresAt ? new Date() < new Date(user.otpExpiresAt) : false
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;