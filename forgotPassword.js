const express = require("express");
const crypto = require("crypto");
const sendOtpEmail = require("./sendOtpEmail");
const User = require("./models");

const router = express.Router();

// Atomic OTP generation and save
async function generateAndSaveOTP(email) {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const otp = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const result = await User.updateOne(
      { email: email },
      { 
        $set: { 
          otp: otp,
          otpExpiresAt: expiresAt 
        } 
      },
      { 
        session,
        runValidators: true,
        strict: true
      }
    );

    if (result.modifiedCount === 0) {
      throw new Error("No document was modified");
    }

    // Verify immediately in the same transaction
    const user = await User.findOne({ email }).session(session).lean();
    if (!user || user.otp !== otp) {
      throw new Error("OTP verification failed within transaction");
    }

    await session.commitTransaction();
    return { otp, expiresAt };

  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

router.post("/", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Email required" });
  }

  const normalizedEmail = email.toLowerCase().trim();
  console.log(`[OTP] Generation request for ${normalizedEmail}`);

  try {
    // Verify DB connection is ready
    if (mongoose.connection.readyState !== 1) {
      throw new Error("Database not connected");
    }

    // Generate and save OTP atomically
    const { otp, expiresAt } = await generateAndSaveOTP(normalizedEmail);
    console.log(`[OTP SUCCESS] Generated for ${normalizedEmail}: ${otp}`);

    // Send email (outside transaction)
    await sendOtpEmail(normalizedEmail, otp);

    return res.status(200).json({ 
      success: true, 
      message: "OTP sent",
      debug: {
        otpSaved: otp,
        expiresAt: expiresAt.toISOString()
      }
    });

  } catch (error) {
    console.error('[OTP FAILURE]', {
      error: error.message,
      stack: error.stack,
      email: normalizedEmail,
      time: new Date()
    });

    return res.status(500).json({ 
      success: false, 
      message: "Failed to generate OTP",
      error: error.message
    });
  }
});

// Direct database verification endpoint
router.get("/verify-db/:email", async (req, res) => {
  try {
    const collection = mongoose.connection.db.collection('users');
    const user = await collection.findOne(
      { email: req.params.email },
      { projection: { otp: 1, otpExpiresAt: 1 } }
    );
    
    return res.json({
      exists: !!user,
      otp: user?.otp,
      expiry: user?.otpExpiresAt,
      rawData: user
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;