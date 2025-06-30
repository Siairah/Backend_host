const express = require("express");
const User = require("./models");

const router = express.Router();

router.post("/", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ 
      success: false, 
      message: "Email and OTP required" 
    });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP VERIFY] Attempt for ${normalizedEmail}`);

  try {
    // First try finding normally
    let user = await User.findOne({ email: normalizedEmail });
    
    // If OTP is undefined, try forcing a fresh read
    if (user && (user.otp === undefined || user.otpExpiresAt === undefined)) {
      console.log('[OTP DEBUG] Initial read failed, forcing fresh read');
      user = await User.findOne({ email: normalizedEmail }).lean().exec();
    }

    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    console.log('[OTP DEBUG] Retrieved user data:', {
      storedOTP: user.otp,
      storedExpiry: user.otpExpiresAt,
      currentTime: new Date()
    });

    if (!user.otp || !user.otpExpiresAt) {
      return res.status(400).json({ 
        success: false, 
        message: "No active OTP found",
        debug: {
          hadOtp: !!user.otp,
          hadExpiry: !!user.otpExpiresAt
        }
      });
    }

    if (new Date() > user.otpExpiresAt) {
      // Auto-clean expired OTPs
      await User.updateOne(
        { _id: user._id },
        { $unset: { otp: "", otpExpiresAt: "" } }
      );
      return res.status(400).json({ 
        success: false, 
        message: "OTP expired" 
      });
    }

    if (user.otp !== otp) {
      return res.status(400).json({ 
        success: false, 
        message: "Invalid OTP",
        debug: {
          expected: user.otp,
          received: otp
        }
      });
    }

    // Clear OTP on successful verification
    await User.updateOne(
      { _id: user._id },
      { $unset: { otp: "", otpExpiresAt: "" } }
    );

    return res.status(200).json({ 
      success: true, 
      message: "OTP verified" 
    });

  } catch (error) {
    console.error('[OTP VERIFY ERROR]', error);
    return res.status(500).json({ 
      success: false, 
      message: "Verification failed",
      error: error.message
    });
  }
});

module.exports = router;