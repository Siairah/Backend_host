require("dotenv").config(); // 👈 Add this at the top
const nodemailer = require("nodemailer");

// ✅ Use environment variables from your `.env` file
const transporter = nodemailer.createTransport({
  host: "sandbox.smtp.mailtrap.io",
  port: 2525,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS,
  },
});

const sendOtpEmail = async (toEmail, otp) => {
  const mailOptions = {
    from: '"YourApp Support" <support@yourapp.com>',
    to: toEmail,
    subject: "Your OTP Code",
    text: `Your OTP is: ${otp}`,
    html: `<p>Your OTP code is: <strong>${otp}</strong></p>`,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ OTP sent to:", toEmail);
    return true;
  } catch (error) {
    console.error("❌ Error sending OTP:", error);
    return false;
  }
};

module.exports = sendOtpEmail;
