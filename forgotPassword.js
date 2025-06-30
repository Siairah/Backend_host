const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

// Reliable OTP generation with retry mechanism
async function generateAndSaveOTP(email) {
  const MAX_RETRIES = 3;
  let attempts = 0;
  
  while (attempts < MAX_RETRIES) {
    attempts++;
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    try {
      // Use findOneAndUpdate to ensure we get the updated document
      const updatedUser = await User.findOneAndUpdate(
        { email: email },
        { 
          $set: { 
            otp: otp,
            otpExpiresAt: expiresAt 
          } 
        },
        { 
          new: true, // Return the updated document
          runValidators: true,
          session: await mongoose.startSession() // Use session for atomicity
        }
      ).lean();

      if (!updatedUser) {
        throw new Error("User not found");
      }

      // Immediate verification
      if (updatedUser.otp === otp) {
        return { otp, expiresAt };
      } else {
        console.warn(`OTP mismatch on attempt ${attempts}`, {
          expected: otp,
          actual: updatedUser.otp
        });
      }
    } catch (error) {
      console.error(`Attempt ${attempts} failed:`, error.message);
      if (attempts === MAX_RETRIES) throw error;
    }
  }
  
  throw new Error("Failed to persist OTP after multiple attempts");
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
    console.log(`[OTP SUCCESS] Persisted OTP for ${normalizedEmail}: ${otp}`);

    // Send email
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent successfully",
      debug: {
        otp: otp,
        expiresAt: expiresAt.toISOString()
      }
    });

  } catch (error) {
    console.error('[OTP FINAL FAILURE]', {
      error: error.message,
      email: normalizedEmail,
      time: new Date(),
      dbState: mongoose.connection.readyState,
      dbHost: mongoose.connection.host,
      stack: error.stack
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to generate OTP",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Deep verification endpoint
router.get("/deep-verify/:email", async (req, res) => {
  try {
    // Check via Mongoose
    const mongooseUser = await User.findOne(
      { email: req.params.email },
      { otp: 1, otpExpiresAt: 1, _id: 0 }
    ).lean();

    // Check via native driver
    const nativeUser = await mongoose.connection.db.collection('users').findOne(
      { email: req.params.email },
      { projection: { otp: 1, otpExpiresAt: 1 } }
    );

    return res.json({
      success: true,
      mongooseResult: mongooseUser,
      nativeDriverResult: nativeUser,
      consistent: mongooseUser?.otp === nativeUser?.otp,
      now: new Date()
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;