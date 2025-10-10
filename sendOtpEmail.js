import { createTransport } from "nodemailer";
import "dotenv/config"; // Ensure environment variables are loaded

// Debug print environment variables
console.log("MAILTRAP_HOST:", process.env.MAILTRAP_HOST);
console.log("MAILTRAP_PORT:", process.env.MAILTRAP_PORT);
console.log("MAILTRAP_USER:", process.env.MAILTRAP_USER);
console.log("MAILTRAP_PASS:", process.env.MAILTRAP_PASS ? "****" : undefined);

const transporter = createTransport({
  host: process.env.MAILTRAP_HOST,
  port: Number(process.env.MAILTRAP_PORT), // make sure port is a number
  auth: {
    user: process.env.MAILTRAP_USER,
    pass: process.env.MAILTRAP_PASS,
  },
});

// Verify SMTP connection immediately
transporter.verify(function (error, success) {
  if (error) {
    console.error("SMTP connection error:", error);
  } else {
    console.log("SMTP server is ready to take messages");
  }
});

const sendOtpEmail = async (email, otp) => {
  const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset OTP</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f8f9fa; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #6a14eb, #8a2be2); padding: 30px; text-align: center; border-radius: 12px 12px 0 0;">
                <h1 style="color: white; margin: 0; font-size: 28px;">
                    <i style="margin-right: 10px;">🔐</i>Password Reset
                </h1>
                <p style="color: white; margin: 10px 0 0 0; font-size: 16px;">Chautari Social Platform</p>
            </div>
            
            <div style="background: white; padding: 40px; border-radius: 0 0 12px 12px; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.08);">
                <h2 style="color: #333; margin-bottom: 20px; text-align: center;">Reset Your Password</h2>
                
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 20px;">
                    Hello,
                </p>
                
                <p style="color: #666; font-size: 16px; line-height: 1.6; margin-bottom: 30px;">
                    You requested to reset your password. Use the verification code below to proceed:
                </p>
                
                <div style="background: linear-gradient(135deg, #6a14eb, #8a2be2); color: white; padding: 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
                    <p style="margin: 0 0 10px 0; font-size: 14px; opacity: 0.9;">Your verification code:</p>
                    <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; margin: 0;">
                        ${otp}
                    </div>
                </div>
                
                <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 30px 0;">
                    <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">
                        <strong>⏰ This code expires in 5 minutes</strong>
                    </p>
                    <p style="margin: 0; color: #666; font-size: 14px;">
                        Please do not share this code with anyone.
                    </p>
                </div>
                
                <p style="color: #666; font-size: 14px; line-height: 1.6; margin-bottom: 30px;">
                    If you didn't request this password reset, please ignore this email. Your account remains secure.
                </p>
                
                <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
                
                <div style="text-align: center;">
                    <p style="color: #999; font-size: 12px; margin: 0;">
                        This email was sent from Chautari Social Platform<br>
                        If you have any questions, please contact our support team.
                    </p>
                </div>
            </div>
        </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"Chautari" <no-reply@chautari.com>',
    to: email,
    subject: "🔐 Password Reset Verification Code - Chautari",
    html: htmlContent,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✅ OTP email sent successfully to ${email}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send OTP email:", error);
    throw error;
  }
};

export default sendOtpEmail;
