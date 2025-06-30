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
    index: true,
    sparse: true
  },
  otpExpiresAt: {
    type: Date,
    index: { expires: '5m' } // Auto-expire after 5 minutes
  }
}, {
  timestamps: true,
  // Ensure we can see the actual error when save fails
  writeConcern: {
    w: 'majority',
    j: true,
    wtimeout: 1000
  }
});

// Add compound index for faster OTP lookups
userSchema.index({ email: 1, otp: 1 }, { unique: true, sparse: true });

// Add method to verify OTP
userSchema.methods.verifyOTP = function(otp) {
  return this.otp === otp && new Date() < this.otpExpiresAt;
};

// Middleware to ensure clean OTP data
userSchema.pre('save', function(next) {
  if (this.isModified('otp') && !this.otp) {
    this.otpExpiresAt = undefined;
  }
  next();
});

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;