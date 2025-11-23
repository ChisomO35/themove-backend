// authHelpers.js
// Custom authentication helpers using Twilio and proper email service

const twilio = require("twilio");
const admin = require("firebase-admin");
const crypto = require("crypto");

// Initialize Twilio
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Phone verification code storage (in production, use Redis or Firestore)
const phoneVerificationCodes = new Map(); // { phone: { code, expiresAt, attempts } }

// Email verification token storage
const emailVerificationTokens = new Map(); // { token: { uid, email, expiresAt } }

// Password reset token storage
const passwordResetTokens = new Map(); // { token: { uid, email, expiresAt } }

// Generate 6-digit code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate secure token
function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Send SMS verification code via Twilio
async function sendPhoneVerificationCode(phoneNumber) {
  try {
    // Normalize phone number
    let normalized = phoneNumber.replace(/\s+/g, "");
    if (!normalized.startsWith("+1")) {
      normalized = "+1" + normalized;
    }

    // Generate code
    const code = generateVerificationCode();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    // Store code
    phoneVerificationCodes.set(normalized, {
      code,
      expiresAt,
      attempts: 0,
    });

    // Send SMS via Twilio
    await twilioClient.messages.create({
      body: `Your TheMove verification code is: ${code}. This code expires in 10 minutes.`,
      from: process.env.TWILIO_PHONE_NUMBER || "+14244478183",
      to: normalized,
    });

    return { success: true, message: "Verification code sent" };
  } catch (error) {
    console.error("❌ Error sending phone verification:", error);
    return { success: false, message: "Failed to send verification code" };
  }
}

// Verify phone code
function verifyPhoneCode(phoneNumber, code) {
  const normalized = phoneNumber.replace(/\s+/g, "");
  const normalizedWithPlus = normalized.startsWith("+1") ? normalized : "+1" + normalized;

  const stored = phoneVerificationCodes.get(normalizedWithPlus);

  if (!stored) {
    return { success: false, message: "No verification code found. Please request a new code." };
  }

  if (Date.now() > stored.expiresAt) {
    phoneVerificationCodes.delete(normalizedWithPlus);
    return { success: false, message: "Verification code expired. Please request a new code." };
  }

  if (stored.attempts >= 5) {
    phoneVerificationCodes.delete(normalizedWithPlus);
    return { success: false, message: "Too many attempts. Please request a new code." };
  }

  stored.attempts++;

  if (stored.code !== code) {
    return { success: false, message: "Invalid verification code." };
  }

  // Code is valid - remove it
  phoneVerificationCodes.delete(normalizedWithPlus);
  return { success: true, message: "Phone number verified" };
}

// Send email verification (using proper email service)
async function sendEmailVerification(uid, email) {
  try {
    // Generate token
    const token = generateSecureToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Store token
    emailVerificationTokens.set(token, { uid, email, expiresAt });

    // Create verification URL
    const verificationUrl = `${process.env.PUBLIC_APP_URL || "https://usethemove.com"}/verify-email?token=${token}`;

    // Use email service
    const { sendVerificationEmail } = require("./emailService");
    await sendVerificationEmail(email, verificationUrl);

    return { success: true, message: "Verification email sent" };
  } catch (error) {
    console.error("❌ Error sending email verification:", error);
    return { success: false, message: "Failed to send verification email" };
  }
}

// Verify email token
async function verifyEmailToken(token) {
  console.log(`🔍 [verifyEmailToken] Starting verification for token: ${token.substring(0, 10)}...`);
  
  const stored = emailVerificationTokens.get(token);

  if (!stored) {
    console.warn(`⚠️ [verifyEmailToken] Token not found in storage`);
    return { success: false, message: "Invalid or expired verification token" };
  }

  if (Date.now() > stored.expiresAt) {
    console.warn(`⚠️ [verifyEmailToken] Token expired. Expires: ${new Date(stored.expiresAt).toISOString()}, Now: ${new Date().toISOString()}`);
    emailVerificationTokens.delete(token);
    return { success: false, message: "Verification token expired" };
  }

  console.log(`✅ [verifyEmailToken] Token valid, verifying user: ${stored.uid}`);

  try {
    // Mark email as verified in Firebase with timeout
    const firebasePromise = admin.auth().updateUser(stored.uid, {
      emailVerified: true,
    });
    
    const firebaseTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Firebase update timeout")), 10000)
    );
    
    await Promise.race([firebasePromise, firebaseTimeout]);
    console.log(`✅ [verifyEmailToken] Firebase auth updated`);

    // Update in Firestore with timeout
    const db = admin.firestore();
    const firestorePromise = db.collection("users").doc(stored.uid).update({
      emailVerified: true,
    });
    
    const firestoreTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Firestore update timeout")), 10000)
    );
    
    await Promise.race([firestorePromise, firestoreTimeout]);
    console.log(`✅ [verifyEmailToken] Firestore updated`);

    // Remove token
    emailVerificationTokens.delete(token);
    console.log(`✅ [verifyEmailToken] Token removed from storage`);

    return { success: true, message: "Email verified successfully" };
  } catch (error) {
    console.error("❌ [verifyEmailToken] Error:", error);
    console.error("❌ [verifyEmailToken] Error stack:", error.stack);
    return { success: false, message: "Failed to verify email" };
  }
}

// Send password reset email
async function sendPasswordResetEmail(email) {
  try {
    // Find user by email
    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch (error) {
      // User not found - don't reveal this for security
      return { success: true, message: "If an account exists, a password reset email has been sent" };
    }

    // Generate token
    const token = generateSecureToken();
    const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour

    // Store token
    passwordResetTokens.set(token, { uid: user.uid, email, expiresAt });

    // Create reset URL
    const resetUrl = `${process.env.PUBLIC_APP_URL || "https://usethemove.com"}/reset-password?token=${token}`;

    // Use email service
    const { sendPasswordResetEmail } = require("./emailService");
    await sendPasswordResetEmail(email, resetUrl);

    return { success: true, message: "If an account exists, a password reset email has been sent" };
  } catch (error) {
    console.error("❌ Error sending password reset:", error);
    return { success: false, message: "Failed to send password reset email" };
  }
}

// Verify password reset token
function verifyPasswordResetToken(token) {
  const stored = passwordResetTokens.get(token);

  if (!stored) {
    return { success: false, message: "Invalid or expired reset token" };
  }

  if (Date.now() > stored.expiresAt) {
    passwordResetTokens.delete(token);
    return { success: false, message: "Reset token expired" };
  }

  return { success: true, uid: stored.uid, email: stored.email };
}

// Reset password
async function resetPassword(token, newPassword) {
  const verification = verifyPasswordResetToken(token);
  if (!verification.success) {
    return verification;
  }

  try {
    // Update password in Firebase
    await admin.auth().updateUser(verification.uid, {
      password: newPassword,
    });

    // Remove token
    passwordResetTokens.delete(token);

    return { success: true, message: "Password reset successfully" };
  } catch (error) {
    console.error("❌ Error resetting password:", error);
    return { success: false, message: "Failed to reset password" };
  }
}

// Clean up expired tokens (run periodically)
function cleanupExpiredTokens() {
  const now = Date.now();

  // Clean phone codes
  for (const [phone, data] of phoneVerificationCodes.entries()) {
    if (now > data.expiresAt) {
      phoneVerificationCodes.delete(phone);
    }
  }

  // Clean email tokens
  for (const [token, data] of emailVerificationTokens.entries()) {
    if (now > data.expiresAt) {
      emailVerificationTokens.delete(token);
    }
  }

  // Clean password reset tokens
  for (const [token, data] of passwordResetTokens.entries()) {
    if (now > data.expiresAt) {
      passwordResetTokens.delete(token);
    }
  }
}

// Run cleanup every hour
setInterval(cleanupExpiredTokens, 60 * 60 * 1000);

module.exports = {
  sendPhoneVerificationCode,
  verifyPhoneCode,
  sendEmailVerification,
  verifyEmailToken,
  sendPasswordResetEmail,
  verifyPasswordResetToken,
  resetPassword,
};

