const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

// Helper function to verify persistence
async function verifyOTPPersistence(userId, expectedOTP) {
  const freshUser = await User.findById(userId).lean();
  if (!freshUser || freshUser.otp !== expectedOTP) {
    console.error('Persistence verification failed!');
    console.error('Expected OTP:', expectedOTP);
    console.error('Actual stored OTP:', freshUser?.otp);
    throw new Error('OTP not persisted correctly');
  }
  return true;
}

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP] Request for ${normalizedEmail}`);

  try {
    // Use findOneAndUpdate for atomic operation
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const updatedUser = await User.findOneAndUpdate(
      { email: normalizedEmail },
      { 
        $set: { 
          otp: otp,
          otpExpiresAt: expiresAt 
        } 
      },
      { 
        new: true,
        upsert: false,
        runValidators: true
      }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Verify the OTP was actually saved
    await verifyOTPPersistence(updatedUser._id, otp);

    // Send email
    await sendOtpEmail(normalizedEmail, otp);
    
    console.log(`[OTP SUCCESS] For ${normalizedEmail}: ${otp}`);
    console.log(`[STORAGE VERIFIED] OTP persisted correctly`);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent",
      debug: {
        otp: otp,
        expiresAt: expiresAt,
        userId: updatedUser._id
      }
    });

  } catch (error) {
    console.error('[OTP ERROR]', error);
    return res.status(500).json({ 
      success: false, 
      message: "Failed to process OTP",
      error: error.message
    });
  }
});

// Add real-time verification endpoint
router.get("/verify-storage/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    return res.status(200).json({
      success: true,
      otp: user.otp,
      otpExpiresAt: user.otpExpiresAt,
      exists: !!user.otp
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;