const express = require("express");
const sendOtpEmail = require("./sendOtpEmail");

const router = express.Router();
const otpStore = {}; // Store in memory for demo

router.post("/send-otp", async (req, res) => {
  const { email } = req.body;

  if (!email) return res.status(400).json({ message: "Email is required" });

  const otp = Math.floor(100000 + Math.random() * 900000); // 6-digit
  otpStore[email] = otp;

  const sent = await sendOtpEmail(email, otp);
  if (sent) {
    res.status(200).json({ success: true, message: "OTP sent" });
  } else {
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

module.exports = router;
