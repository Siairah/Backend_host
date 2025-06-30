const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: String,
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: String,
  otp: String, // For OTP verification
  otpExpiresAt: Date, // For OTP expiration
});

// ✅ Avoid OverwriteModelError
const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;
