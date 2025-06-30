const mongoose = require("mongoose");

// Create separate schema for OTP to ensure no interference
const OTPSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    validate: {
      validator: v => /^\d{6}$/.test(v),
      message: props => `${props.value} is not a valid 6-digit OTP!`
    }
  },
  expiresAt: {
    type: Date,
    required: true
  }
}, { _id: false });

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
  otpData: OTPSchema // Embedded document for OTP
}, {
  timestamps: true,
  // Disable all middleware that might interfere
  bufferCommands: false,
  autoIndex: false,
  autoCreate: false
});

// Create collection explicitly with proper settings
userSchema.set('collection', 'users');
userSchema.set('strict', 'throw'); // Throw errors for unknown fields

// Completely bypass Mongoose for critical operations
userSchema.statics.directUpdate = async function(filter, update) {
  return this.collection.updateOne(filter, update);
};

const User = mongoose.models.User || mongoose.model("User", userSchema);

module.exports = User;