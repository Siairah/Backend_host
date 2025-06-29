const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  host: process.env.MAILTRAP_HOST,
  port: process.env.MAILTRAP_PORT,
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS,
  },
});

const sendOtpEmail = async (email, otp) => {
  const htmlContent = `
    <div style="background: #f0f4f8; padding: 30px; font-family: Arial, sans-serif;">
      <div style="max-width: 500px; margin: auto; background: white; padding: 20px; border-radius: 10px; box-shadow: 0px 2px 8px rgba(0,0,0,0.1);">
        <h2 style="text-align: center; color: #007bff;">🔐 OTP Code for Password Reset</h2>
        <p>Hello,</p>
        <p>Your OTP code is valid for <strong>5 minutes</strong>:</p>
        <div style="font-size: 28px; text-align: center; margin: 20px 0; font-weight: bold; color: #007bff;">
          ${otp}
        </div>
        <p>Please do not share this code with anyone.</p>
        <p style="font-size: 12px; color: gray;">If you didn’t request this, ignore this email.</p>
        <p style="text-align: right;">— Your App Team</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: '"Your App" <no-reply@yourapp.com>',
    to: email,
    subject: "Your OTP Code (valid for 5 minutes)",
    html: htmlContent,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendOtpEmail;
