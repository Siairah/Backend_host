const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

async function persistOTP(email, otp, expiresAt) {
  // Bypass Mongoose completely for the update
  const result = await User.directUpdate(
    { email: email },
    { $set: { otpData: { code: otp, expiresAt: expiresAt } } }
  );

  if (result.modifiedCount === 0) {
    throw new Error("Database update failed");
  }

  // Verify using raw driver
  const user = await mongoose.connection.db.collection('users').findOne(
    { email: email },
    { projection: { 'otpData.code': 1, 'otpData.expiresAt': 1 } }
  );

  if (!user?.otpData?.code || user.otpData.code !== otp) {
    console.error('Database verification failed:', {
      expected: otp,
      actual: user?.otpData?.code,
      fullDocument: user
    });
    throw new Error("OTP verification failed");
  }

  return true;
}

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP] Generation request for ${normalizedEmail}`);

  try {
    // Generate OTP
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Persist with verification
    await persistOTP(normalizedEmail, otp, expiresAt);
    console.log(`[OTP SUCCESS] Persisted for ${normalizedEmail}`);

    // Send email
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent successfully" 
    });

  } catch (error) {
    console.error('[OTP ULTIMATE FAILURE]', {
      error: error.message,
      email: normalizedEmail,
      dbTime: new Date(await mongoose.connection.db.command({ serverStatus: 1 }).then(s => s.localTime)),
      mongodbVersion: await mongoose.connection.db.command({ buildInfo: 1 }).then(i => i.version),
      storageEngine: await mongoose.connection.db.command({ serverStatus: 1 }).then(s => s.storageEngine.name)
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to process OTP request",
      systemStatus: "Please contact support with the request timestamp"
    });
  }
});

// Ultimate verification endpoint
router.get("/ultimate-verify/:email", async (req, res) => {
  try {
    const result = await mongoose.connection.db.command({
      find: "users",
      filter: { email: req.params.email },
      projection: { otpData: 1 },
      limit: 1
    });

    const doc = result.cursor.firstBatch[0];
    return res.json({
      success: true,
      otpExists: !!doc?.otpData?.code,
      otp: doc?.otpData?.code,
      expiresAt: doc?.otpData?.expiresAt,
      storageEngine: await mongoose.connection.db.command({ serverStatus: 1 }).then(s => s.storageEngine.name),
      mongodbVersion: await mongoose.connection.db.command({ buildInfo: 1 }).then(i => i.version),
      serverTime: new Date(await mongoose.connection.db.command({ serverStatus: 1 }).then(s => s.localTime))
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