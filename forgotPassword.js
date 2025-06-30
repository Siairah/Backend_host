const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");
const otpStore = require("./otpStore"); // 👈 Use shared store instead of new Map()


const router = express.Router();

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
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    otpStore.set(normalizedEmail, { code: otp, expiresAt });

    console.log("\n[OTP STORE] ✅ OTP generated and stored:");
    console.log(`Email        : ${normalizedEmail}`);
    console.log(`OTP Code     : ${otp}`);
    console.log(`Expires At   : ${new Date(expiresAt).toISOString()}`);
    console.log("[OTP STORE] Current entries:");
    console.table(Array.from(otpStore.entries()).map(([email, data]) => ({
      email,
      otp: data.code,
      expiresAt: new Date(data.expiresAt).toISOString()
    })));

    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("[ERROR] ❌ Failed to send OTP:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// Verify OTP
router.post("/verify", (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: "Email and OTP are required" });
  }

  const normalizedEmail = email.toLowerCase();
  const record = otpStore.get(normalizedEmail);

  console.log("\n[VERIFY ATTEMPT] 🔍 Verifying OTP...");
  console.log(`Email         : ${normalizedEmail}`);
  console.log(`OTP Provided  : ${otp}`);
  console.log(`Current Time  : ${new Date().toISOString()}`);

  if (!record) {
    console.warn("[VERIFY ATTEMPT] ⚠️ OTP not found or already expired.");
    return res.status(400).json({ success: false, message: "OTP not found or expired" });
  }

  const { code, expiresAt } = record;

  console.log(`Stored OTP    : ${code}`);
  console.log(`Expires At    : ${new Date(expiresAt).toISOString()}`);

  if (Date.now() > expiresAt) {
    otpStore.delete(normalizedEmail);
    console.warn("[VERIFY ATTEMPT] ⏰ OTP expired.");
    return res.status(400).json({ success: false, message: "OTP expired" });
  }

  if (otp !== code) {
    console.warn("[VERIFY ATTEMPT] ❌ Invalid OTP.");
    return res.status(400).json({ success: false, message: "Invalid OTP" });
  }

  otpStore.delete(normalizedEmail);
  console.log("[VERIFY ATTEMPT] ✅ OTP verified successfully.");

  return res.status(200).json({ success: true, message: "OTP verified successfully" });
});

module.exports = router;
