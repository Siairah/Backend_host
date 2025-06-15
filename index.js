const express = require("express");
const mongoose = require("mongoose");
const signupRoute = require("./signup");

const app = express();
app.use(express.json());

// MongoDB connection string
const mongoURI = "mongodb+srv://sisir:sharma@cluster0.zbk23.mongodb.net/myDatabase?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("MongoDB connected"))
.catch(err => console.error("MongoDB connection error:", err));

// Use signup route at /signup
app.use("/signup", signupRoute);

// Listen on Render's port or 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
