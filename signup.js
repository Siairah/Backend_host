import { Router } from "express";
import mongoose from "mongoose";
const { Schema, model } = mongoose;

import { hash } from "bcrypt";

const router = Router();

const userSchema = new Schema({
  fullName: { type: String, required: true },
  phone: {
    type: String,
    required: true,
    validate: {
      validator: v => /^\d{10}$/.test(v),
      message: props => `${props.value} is not a valid 10-digit phone number!`,
    },
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    validate: {
      validator: v => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(v),
      message: props => `${props.value} is not a valid email!`,
    },
  },
  password: { type: String, required: true },
});

import { User } from "./models/index.js"; 

router.post("/", async (req, res) => {
  const { fullName, phone, email, password } = req.body;

  console.log("Received signup data:", req.body);

  if (!fullName || !phone || !email || !password) {
    return res.status(400).json({ success: false, message: "All fields are required" });
  }

  try {
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: "Email already registered" });
    }

    // Hash the password
    const saltRounds = 10;
    const hashedPassword = await hash(password, saltRounds);

    const newUser = new User({
      fullName,
      phone,
      email: email.toLowerCase(),
      password: hashedPassword,
    });

    await newUser.save();

    return res.status(201).json({ success: true, message: "User registered successfully" });
  } catch (error) {
    console.error("Signup route error:", error);

    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join(", ") });
    }

    if (error.code === 11000) {
      // Duplicate key error (in case unique constraint violation)
      return res.status(400).json({ success: false, message: "Email already exists" });
    }

    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
