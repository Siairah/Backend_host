const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

// Hybrid OTP persistence with fallback
async function persistOTP(email, otp, expiresAt) {
  // Try Mongoose update first
  const mongooseResult = await User.updateOne(
    { email: email },
    { $set: { otp: otp, otpExpiresAt: expiresAt } },
    { runValidators: true }
  );

  // If Mongoose fails, try native driver
  if (mongooseResult.modifiedCount === 0) {
    console.warn('Mongoose update failed, trying native driver');
    const nativeResult = await mongoose.connection.db.collection('users').updateOne(
      { email: email },
      { $set: { otp: otp, otpExpiresAt: expiresAt } }
    );
    return nativeResult.modifiedCount > 0;
  }

  return true;
}

async function generateAndSaveOTP(email) {
  const otp = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  // Persist using hybrid approach
  const persisted = await persistOTP(email, otp, expiresAt);
  if (!persisted) {
    throw new Error("Failed to persist OTP");
  }

  // Verify with native driver
  const user = await mongoose.connection.db.collection('users').findOne(
    { email: email },
    { projection: { otp: 1, otpExpiresAt: 1 } }
  );

  if (!user || user.otp !== otp) {
    console.error('Final verification failed', {
      expected: otp,
      actual: user?.otp,
      userExists: !!user
    });
    throw new Error("OTP verification failed");
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
    // Triple-check connection
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connection.asPromise();
      if (mongoose.connection.readyState !== 1) {
        throw new Error("Database connection unstable");
      }
    }

    // Generate and persist OTP
    const { otp, expiresAt } = await generateAndSaveOTP(normalizedEmail);
    console.log(`[OTP SUCCESS] Verified persistence for ${normalizedEmail}`);

    // Send email
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent successfully"
    });

  } catch (error) {
    console.error('[OTP CRITICAL FAILURE]', {
      error: error.message,
      email: normalizedEmail,
      dbState: mongoose.connection.readyState,
      dbHost: mongoose.connection.host,
      time: new Date().toISOString()
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to process OTP request",
      systemError: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Nuclear verification endpoint
router.get("/nuclear-verify/:email", async (req, res) => {
  try {
    // Check all possible ways
    const mongooseUser = await User.findOne({ email: req.params.email }).lean();
    const nativeUser = await mongoose.connection.db.collection('users').findOne(
      { email: req.params.email }
    );
    const rawDb = await mongoose.connection.db.admin().command({
      find: "users",
      filter: { email: req.params.email },
      limit: 1
    });

    return res.json({
      success: true,
      mongoose: mongooseUser?.otp,
      nativeDriver: nativeUser?.otp,
      rawDatabase: rawDb?.cursor?.firstBatch[0]?.otp,
      consistent: (
        mongooseUser?.otp === nativeUser?.otp && 
        nativeUser?.otp === rawDb?.cursor?.firstBatch[0]?.otp
      ),
      timestamp: new Date()
    });
  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
});

module.exports = router;