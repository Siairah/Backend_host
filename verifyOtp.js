// routes/verifyOtp.js
const express = require("express");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: "Email and OTP are required" });
  }

  try {
    const normalizedEmail = email.toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });
    console.log("User OTP:", user.otp);
console.log("User OTP expiry:", user.otpExpiresAt);


    if (!user || !user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ success: false, message: "OTP not found or expired" });
    }

    if (Date.now() > new Date(user.otpExpiresAt).getTime()) {
      user.otp = undefined;
      user.otpExpiresAt = undefined;
      await user.save();
      return res.status(400).json({ success: false, message: "OTP expired" });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ success: false, message: "Invalid OTP" });
    }

    user.otp = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    return res.status(200).json({ success: true, message: "OTP verified successfully" });
  } catch (error) {
    console.error("[ERROR] Verifying OTP failed:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
