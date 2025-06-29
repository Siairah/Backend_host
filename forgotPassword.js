const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();
const otpStore = new Map(); // Stores { email: { code, expiresAt } }

/**
 * @route POST /forgot-password
 * @desc Send OTP to user email
 */
router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    otpStore.set(email, { code: otp, expiresAt });
    console.log("Found user:", user.email);
    console.log("Generated OTP:", otp);

    await sendOtpEmail(email, otp);

    return res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * @route POST /forgot-password/verify
 * @desc Verify OTP
 */
router.post("/verify", (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: "Email and OTP are required" });
  }

  const record = otpStore.get(email);
  if (!record) {
    return res.status(400).json({ success: false, message: "OTP not found or expired" });
  }

  const { code, expiresAt } = record;

  if (Date.now() > expiresAt) {
    otpStore.delete(email);
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  if (otp !== code) {
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }

  otpStore.delete(email); // one-time use
  return res.json({ success: true, message: "OTP verified successfully" });
});

module.exports = router;
