import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const userSchema = new Schema({
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
if (models.User) {
  delete models.User;
}
const User = model("User", userSchema);

export default User;