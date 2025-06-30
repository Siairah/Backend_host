const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    console.log("[ERROR] Email not provided");
    return res.status(400).json({ success: false, message: "Email is required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[INFO] Forgot Password requested for: ${normalizedEmail}`);

  try {
    // Verify database connection first
    if (mongoose.connection.readyState !== 1) {
      console.error("[ERROR] Database not connected");
      return res.status(500).json({ success: false, message: "Database not connected" });
    }

    // Find user with session to ensure consistency
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ email: normalizedEmail }).session(session);
      if (!user) {
        console.log(`[WARN] User not found: ${normalizedEmail}`);
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: "User not found" });
      }

      const otp = crypto.randomInt(100000, 999999).toString();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

      console.log(`[DEBUG] Attempting to save OTP ${otp} for ${normalizedEmail}`);

      // Use atomic update
      const updatedUser = await User.findOneAndUpdate(
        { _id: user._id },
        { 
          $set: { 
            otp: otp,
            otpExpiresAt: expiresAt 
          } 
        },
        { new: true, session }
      );

      if (!updatedUser) {
        throw new Error("User update failed");
      }

      await session.commitTransaction();
      console.log(`[SUCCESS] OTP saved to database for ${normalizedEmail}: ${otp}`);

      // Verify the save actually worked
      const freshUser = await User.findById(user._id);
      console.log(`[VERIFY] Fresh read OTP: ${freshUser.otp}, Expiry: ${freshUser.otpExpiresAt}`);

      // Send email
      await sendOtpEmail(normalizedEmail, otp);
      console.log(`[SUCCESS] Email sent to ${normalizedEmail}`);

      return res.status(200).json({ 
        success: true, 
        message: "OTP sent to email",
        debug: {
          savedOtp: freshUser.otp,
          savedExpiry: freshUser.otpExpiresAt
        }
      });

    } catch (transactionError) {
      await session.abortTransaction();
      console.error("[ERROR] Transaction failed:", transactionError);
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("[ERROR] Forgot password process failed:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

// Debug endpoint
router.get("/debug", async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email required" });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      otp: user.otp,
      otpExpiresAt: user.otpExpiresAt,
      now: new Date(),
      isExpired: user.otpExpiresAt ? new Date() > user.otpExpiresAt : true
    });
  } catch (error) {
    console.error("[ERROR] Debug failed:", error);
    return res.status(500).json({ success: false, message: "Debug error" });
  }
});

module.exports = router;