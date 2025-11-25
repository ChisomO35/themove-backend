// emailService.js
// Email service using Resend (recommended) or SendGrid
// Install: npm install resend
// Or: npm install @sendgrid/mail

// Option 1: Using Resend (Recommended - better deliverability)
const useResend = true; // Set to false to use SendGrid

let emailClient;

if (useResend) {
  // Resend setup
  const { Resend } = require("resend");
  emailClient = new Resend(process.env.RESEND_API_KEY);
} else {
  // SendGrid setup
  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
  emailClient = sgMail;
}

// Use support@ for transactional emails (better deliverability than noreply@)
const FROM_EMAIL = process.env.FROM_EMAIL || "support@usethemove.com";
const FROM_NAME = process.env.FROM_NAME || "TheMove";

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

  if (useResend) {
    // Resend - with better deliverability settings
    const { data, error } = await emailClient.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: email,
      reply_to: process.env.REPLY_TO_EMAIL || FROM_EMAIL, // Add reply-to
      subject,
      html,
      text, // Plain text version
      headers: {
        'X-Entity-Ref-ID': `verify-${Date.now()}`, // Unique tracking
        'List-Unsubscribe': `<mailto:${process.env.REPLY_TO_EMAIL || FROM_EMAIL}?subject=unsubscribe>`, // Help with spam filters
      },
    });

    if (error) {
      console.error("❌ Resend error:", error);
      throw error;
    }

    return { success: true, messageId: data?.id };
  } else {
    // SendGrid - with better deliverability settings
    const msg = {
      to: email,
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      replyTo: process.env.REPLY_TO_EMAIL || FROM_EMAIL,
      subject,
      html,
      text, // Plain text version
      mailSettings: {
        sandboxMode: {
          enable: false, // Make sure sandbox mode is off
        },
      },
    };

    await emailClient.send(msg);
    return { success: true };
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

  if (useResend) {
    // Resend - with better deliverability settings
    const { data, error } = await emailClient.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: email,
      reply_to: process.env.REPLY_TO_EMAIL || FROM_EMAIL, // Add reply-to
      subject,
      html,
      text, // Plain text version
      headers: {
        'X-Entity-Ref-ID': `reset-${Date.now()}`, // Unique tracking
        'List-Unsubscribe': `<mailto:${process.env.REPLY_TO_EMAIL || FROM_EMAIL}?subject=unsubscribe>`, // Help with spam filters
      },
    });

    if (error) {
      console.error("❌ Resend error:", error);
      throw error;
    }

    return { success: true, messageId: data?.id };
  } else {
    // SendGrid - with better deliverability settings
    const msg = {
      to: email,
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      replyTo: process.env.REPLY_TO_EMAIL || FROM_EMAIL,
      subject,
      html,
      text, // Plain text version
      mailSettings: {
        sandboxMode: {
          enable: false, // Make sure sandbox mode is off
        },
      },
    };

    await emailClient.send(msg);
    return { success: true };
  }
}

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
};

