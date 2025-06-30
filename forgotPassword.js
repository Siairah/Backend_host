const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();
const otpStore = new Map(); // email => { code, expiresAt }

// Send OTP and overwrite any previous OTP immediately
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

    // Delete old OTP if exists
    if (otpStore.has(normalizedEmail)) {
      otpStore.delete(normalizedEmail);
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes from now

    otpStore.set(normalizedEmail, { code: otp, expiresAt });

    console.log("Stored OTP for:", normalizedEmail, "OTP:", otp, "Expires at:", new Date(expiresAt));
    console.log("Current OTP Store:", Array.from(otpStore.entries()));

    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("Error sending OTP:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Verify OTP
router.post("/verify", (req, res) => {
  const { email, otp } = req.body;
  const normalizedEmail = email.toLowerCase();
  
  console.log("Current OTP Store:", Array.from(otpStore.entries()));
  console.log("Verification attempt for:", normalizedEmail, "with OTP:", otp);

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: "Email and OTP are required" });
  }

  const record = otpStore.get(normalizedEmail);
  if (!record) {
    return res.status(400).json({ success: false, message: "OTP not found or expired" });
  }

  const { code, expiresAt } = record;

  console.log("Current time:", new Date(), "Expiry time:", new Date(expiresAt));

  if (Date.now() > expiresAt) {
    otpStore.delete(normalizedEmail);
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  if (otp !== code) {
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }

  otpStore.delete(normalizedEmail);
  return res.json({ success: true, message: "OTP verified successfully" });
});

module.exports = router;