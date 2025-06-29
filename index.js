const express = require("express");
const mongoose = require("mongoose");
const signupRoute = require("./signup");
const loginRoute = require("./login")
const sendOtpRoute = require("./sendOtp");

const app = express();
app.use(express.json());

// MongoDB connection
const mongoURI = "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// Root route for testing if backend is up
app.get("/", (req, res) => {
  res.send("Backend is working ✅");
});

// Use signup route
app.use("/signup", signupRoute);
app.use("/login", loginRoute);
app.use("/sendOtp", sendOtpRoute);

// Use port from environment or default 3000
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
