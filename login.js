import { Router } from "express";
import { compare } from "bcrypt";
import jwt from "jsonwebtoken";
import { User } from "./models/index.js"; 

const router = Router();

// POST /login
router.post("/", async (req, res) => {
  const { email, password } = req.body;
  console.log("Login attempt:", req.body);

  if (!email || !password) {
    return res.status(400).json({ success: false, message: "Email and password are required" });
  }

  try {
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    const isMatch = await compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: "Invalid email or password" });
    }

    // 🔹 Generate JWT token
    const token = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET || "supersecretkey",
      { expiresIn: "1d" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token, // ⬅️ send token to frontend
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
      },
    });
  } catch (error) {
    console.error("Login route error:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

export default router;
