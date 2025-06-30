// routes/forgotPassword.js
const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 min

    user.otp = otp;
    user.otpExpiresAt = expiresAt;
    await user.save();

    console.log(`✅ OTP for ${normalizedEmail}: ${otp} (expires at ${expiresAt.toISOString()})`);

    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("[ERROR] Sending OTP failed:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
