const express = require("express");
const mongoose = require("mongoose");
const router = express.Router();

// User schema and model
const userSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  phone: { type: String, required: true, match: /^\d{10}$/ },
  email: { type: String, required: true, unique: true, match: /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i },
  password: { type: String, required: true },
});

const User = mongoose.model("User", userSchema);

// POST /signup endpoint
router.post("/", async (req, res) => {
  const { fullName, phone, email, password } = req.body;

  // Simple validation
  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ success: false, message: "Phone must be a valid 10-digit Nepal number" });
  }

  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) {
    return res.status(400).json({ success: false, message: "Invalid email format" });
  }

  try {
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    const newUser = new User({ fullName, phone, email, password });
    await newUser.save();

    return res.status(201).json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

console.log("Signup route loaded");
module.exports = router;
