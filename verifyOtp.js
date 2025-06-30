const express = require("express");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Email and OTP are required" 
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[INFO] OTP verification for: ${normalizedEmail}`);

  try {
    // Verify database connection
    if (mongoose.connection.readyState !== 1) {
      console.error("[ERROR] Database not connected");
      return res.status(500).json({ success: false, message: "Database not connected" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const user = await User.findOne({ email: normalizedEmail }).session(session);
      
      if (!user) {
        console.log(`[WARN] User not found: ${normalizedEmail}`);
        await session.abortTransaction();
        return res.status(404).json({ success: false, message: "User not found" });
      }

      console.log(`[DEBUG] User OTP: ${user.otp}, Expiry: ${user.otpExpiresAt}`);
      console.log(`[DEBUG] Current time: ${new Date()}`);

      // Check if OTP exists
      if (!user.otp || !user.otpExpiresAt) {
        console.log(`[WARN] No OTP found for: ${normalizedEmail}`);
        await session.abortTransaction();
        return res.status(400).json({ 
          success: false, 
          message: "OTP not found or expired" 
        });
      }

      // Check expiration
      if (new Date() > user.otpExpiresAt) {
        console.log(`[WARN] OTP expired for: ${normalizedEmail}`);
        // Clear expired OTP
        await User.updateOne(
          { _id: user._id },
          { $unset: { otp: "", otpExpiresAt: "" } },
          { session }
        );
        await session.commitTransaction();
        return res.status(400).json({ 
          success: false, 
          message: "OTP expired" 
        });
      }

      // Verify OTP
      if (user.otp !== otp) {
        console.log(`[WARN] Invalid OTP for: ${normalizedEmail}`);
        await session.abortTransaction();
        return res.status(400).json({ 
          success: false, 
          message: "Invalid OTP" 
        });
      }

      // OTP is valid - clear it
      await User.updateOne(
        { _id: user._id },
        { $unset: { otp: "", otpExpiresAt: "" } },
        { session }
      );

      await session.commitTransaction();
      console.log(`[SUCCESS] OTP verified for: ${normalizedEmail}`);

      return res.status(200).json({ 
        success: true, 
        message: "OTP verified successfully" 
      });

    } catch (transactionError) {
      await session.abortTransaction();
      console.error("[ERROR] Transaction failed:", transactionError);
      throw transactionError;
    } finally {
      session.endSession();
    }

  } catch (error) {
    console.error("[ERROR] OTP verification failed:", error);
    return res.status(500).json({ 
      success: false, 
      message: "Server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
});

module.exports = router;