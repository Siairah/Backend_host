const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { 
    type: String, 
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{10}$/.test(v);
      },
      message: props => `${props.value} is not a valid 10-digit phone number!`
    }
  },
  email: { 
    type: String, 
    required: true, 
    unique: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v);
      },
      message: props => `${props.value} is not a valid email!`
    }
  },
  password: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

router.post("/", async (req, res) => {
  const { fullName, phone, email, password } = req.body;

  console.log("Received signup data:", req.body);

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  try {
    // Check if user exists by email (unique)
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const newUser = new User({ fullName, phone, email: email.toLowerCase(), password });
    await newUser.save();

    return res.status(201).json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("Signup route error:", error);

    // If validation error from mongoose
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
