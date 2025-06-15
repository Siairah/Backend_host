const express = require("express");
const mongoose = require("mongoose");
const signupRoute = require("./signup");

const app = express();
app.use(express.json());

// MongoDB connection
const mongoURI = "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI)
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB connection error:", err));

// Use signup route
app.use("/signup", signupRoute);

// ✅ Use the port Render provides or 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
app.get("/", (req, res) => {
  res.send("Backend is working ✅");
});
