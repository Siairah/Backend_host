const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  fullName: String,
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    trim: true
  },
  password: { type: String, required: true },
  phone: String,
  otp: {
    type: String,
    validate: {
      validator: v => v === undefined || /^\d{6}$/.test(v),
      message: props => `${props.value} is not a valid 6-digit OTP!`
    }
  },
  otpExpiresAt: Date
}, {
  // Disable virtuals and other potential middleware
  id: false,
  virtuals: false,
  strict: true,
  timestamps: true
});

// Create model only once
if (mongoose.models.User) {
  delete mongoose.models.User;
}
const User = mongoose.model("User", userSchema);

module.exports = User;