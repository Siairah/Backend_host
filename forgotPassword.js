const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    console.log("[ERROR] Forgot Password: Email not provided");
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    console.log(`[INFO] Forgot Password requested for email: ${normalizedEmail}`);

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      console.log(`[WARN] User not found for email: ${normalizedEmail}`);
      return res.status(404).json({ success: false, message: "User not found" });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes from now

    user.otp = otp;
    user.otpExpiresAt = expiresAt;
    try {
  await user.save();
  console.log(`[SUCCESS] OTP saved for ${normalizedEmail}`);
} catch (saveError) {
  console.error("[ERROR] Failed to save OTP to user:", saveError);
  return res.status(500).json({ success: false, message: "Failed to save OTP" });
}


    console.log(`[SUCCESS] OTP generated and saved for ${normalizedEmail}: ${otp} (expires at ${expiresAt.toISOString()})`);

    await sendOtpEmail(normalizedEmail, otp);
    console.log(`[SUCCESS] OTP email sent to ${normalizedEmail}`);

    return res.status(200).json({ success: true, message: "OTP sent to email" });
  } catch (error) {
    console.error("[ERROR] Sending OTP failed:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

router.get("/debug-user", async (req, res) => {
  // Temporary debug route to check user OTP status
  try {
    const email = req.query.email?.toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, message: "Email query parameter required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log(`[DEBUG-USER] OTP for ${email}:`, user.otp);
    console.log(`[DEBUG-USER] OTP expiry for ${email}:`, user.otpExpiresAt);

    return res.status(200).json({ otp: user.otp, otpExpiresAt: user.otpExpiresAt });
  } catch (err) {
    console.error("[ERROR] Debug user route failed:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
