// emailService.js
// Email service using Mailgun API
// Install: npm install mailgun-js
// Updated: Using Mailgun API instead of Nodemailer (works on all Railway plans)

const mailgun = require("mailgun-js");

// Email configuration
// Using postmaster@usethemove.com as shown in Mailgun working example
const FROM_EMAIL = process.env.FROM_EMAIL || "support@usethemove.com";
const FROM_NAME = process.env.FROM_NAME || "TheMove";
const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;

// Initialize Mailgun client
let mailgunClient = null;
if (MAILGUN_API_KEY && MAILGUN_DOMAIN) {
  mailgunClient = mailgun({
    apiKey: MAILGUN_API_KEY,
    domain: MAILGUN_DOMAIN,
  });
  console.log("✅ Mailgun client initialized");
} else {
  console.warn("⚠️ Mailgun not configured: MAILGUN_API_KEY or MAILGUN_DOMAIN missing");
}

// Send email verification
async function sendVerificationEmail(email, verificationUrl) {
  const subject = "Verify Your Email";
  
  // Plain text version (better for spam filters)
  const text = `Thanks for signing up for TheMove! Please verify your email address by clicking the link below:\n\n${verificationUrl}\n\nThis link will expire in 24 hours.\n\nIf you didn't create an account, you can safely ignore this email.\n\nTheMove - Find any event on campus in one text`;
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">TheMove</h1>
        </div>
        <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1E1B4B; margin-top: 0;">Verify Your Email</h2>
          <p>Thanks for signing up for TheMove! Please verify your email address by clicking the button below:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${verificationUrl}" style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Verify Email</a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${verificationUrl}</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">This link will expire in 24 hours.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't create an account, you can safely ignore this email.</p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
          <p>TheMove - Find any event on campus in one text</p>
        </div>
      </body>
    </html>
  `;

  try {
    // Check if Mailgun is configured
    if (!mailgunClient) {
      console.error("❌ Mailgun not configured: MAILGUN_API_KEY or MAILGUN_DOMAIN missing");
      throw new Error("Email service not configured: Mailgun credentials missing");
    }

    const data = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: email,
      subject,
      text, // Plain text version
      html,
      'h:Reply-To': process.env.REPLY_TO_EMAIL || FROM_EMAIL,
      'h:X-Entity-Ref-ID': `verify-${Date.now()}`, // Unique tracking
      'h:List-Unsubscribe': `<mailto:${process.env.REPLY_TO_EMAIL || FROM_EMAIL}?subject=unsubscribe>`, // Help with spam filters
    };

    // Add timeout to email sending (30 seconds max)
    const sendPromise = new Promise((resolve, reject) => {
      mailgunClient.messages().send(data, (error, body) => {
        if (error) {
          reject(error);
        } else {
          resolve(body);
        }
      });
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Email send timeout after 30 seconds")), 30000)
    );

    const body = await Promise.race([sendPromise, timeoutPromise]);
    console.log(`✅ Verification email sent to ${email}, messageId: ${body.id || body.message}`);
    return { success: true, messageId: body.id || body.message };
  } catch (error) {
    console.error("❌ Error sending verification email:", error);
    console.error("❌ Error details:", error.message);
    throw error;
  }
}

// Send password reset email
async function sendPasswordResetEmail(email, resetUrl) {
  const subject = "Reset your TheMove password";
  
  // Plain text version (better for spam filters)
  const text = `We received a request to reset your password. Click the link below to create a new password:\n\n${resetUrl}\n\nThis link will expire in 1 hour.\n\nIf you didn't request a password reset, you can safely ignore this email.\n\nTheMove - Find any event on campus in one text`;
  
  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #4F46E5 0%, #6366F1 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">TheMove</h1>
        </div>
        <div style="background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 10px 10px;">
          <h2 style="color: #1E1B4B; margin-top: 0;">Reset Your Password</h2>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${resetUrl}" style="background: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;">Reset Password</a>
          </div>
          <p style="color: #6b7280; font-size: 14px;">Or copy and paste this link into your browser:</p>
          <p style="color: #6b7280; font-size: 12px; word-break: break-all;">${resetUrl}</p>
          <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">This link will expire in 1 hour.</p>
          <p style="color: #6b7280; font-size: 14px;">If you didn't request a password reset, you can safely ignore this email.</p>
        </div>
        <div style="text-align: center; margin-top: 20px; color: #9ca3af; font-size: 12px;">
          <p>TheMove - Find any event on campus in one text</p>
        </div>
      </body>
    </html>
  `;

  try {
    // Check if Mailgun is configured
    if (!mailgunClient) {
      console.error("❌ Mailgun not configured: MAILGUN_API_KEY or MAILGUN_DOMAIN missing");
      throw new Error("Email service not configured: Mailgun credentials missing");
    }

    const data = {
      from: `"${FROM_NAME}" <${FROM_EMAIL}>`,
      to: email,
      subject,
      text, // Plain text version
      html,
      'h:Reply-To': process.env.REPLY_TO_EMAIL || FROM_EMAIL,
      'h:X-Entity-Ref-ID': `reset-${Date.now()}`, // Unique tracking
      'h:List-Unsubscribe': `<mailto:${process.env.REPLY_TO_EMAIL || FROM_EMAIL}?subject=unsubscribe>`, // Help with spam filters
    };

    // Add timeout to email sending (30 seconds max)
    const sendPromise = new Promise((resolve, reject) => {
      mailgunClient.messages().send(data, (error, body) => {
        if (error) {
          reject(error);
        } else {
          resolve(body);
        }
      });
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Email send timeout after 30 seconds")), 30000)
    );

    const body = await Promise.race([sendPromise, timeoutPromise]);
    console.log(`✅ Password reset email sent to ${email}, messageId: ${body.id || body.message}`);
    return { success: true, messageId: body.id || body.message };
  } catch (error) {
    console.error("❌ Error sending password reset email:", error);
    console.error("❌ Error details:", error.message);
    throw error;
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};
