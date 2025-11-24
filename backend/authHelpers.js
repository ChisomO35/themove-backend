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

// Get Firestore instance (will use existing admin app if already initialized)
let db;
try {
  db = admin.firestore();
} catch (error) {
  // If admin not initialized yet, it will be initialized in server.js
  // We'll get db lazily when needed
}

// Phone verification code storage (in production, use Redis or Firestore)
// Note: Phone codes are short-lived (10 min) so in-memory is acceptable for now
const phoneVerificationCodes = new Map(); // { phone: { code, expiresAt, attempts } }

// Note: Email and password reset tokens are stored in Firestore for persistence
// This ensures tokens survive Railway container restarts

// Generate 6-digit code
function generateVerificationCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Generate secure token
function generateSecureToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Normalize phone number to E.164 format
function normalizePhoneToE164(phoneNumber) {
  if (!phoneNumber) {
    throw new Error("No phone number provided");
  }
  
  // Convert to string if not already
  const phoneStr = String(phoneNumber).trim();
  
  if (!phoneStr) {
    throw new Error("Phone number is empty");
  }
  
  // Remove all non-digit characters
  let digits = phoneStr.replace(/\D/g, "");
  
  if (!digits || digits.length === 0) {
    throw new Error(`Phone number contains no digits: ${phoneNumber}`);
  }
  
  // Must be 10 digits for US (without country code)
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // Already includes country code (11 digits starting with 1)
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  
  // If longer, try to extract valid number
  if (digits.length > 11 && digits.startsWith("1")) {
    // Take first 11 digits
    return `+${digits.substring(0, 11)}`;
  }
  
  // If 10 digits at the end, use those
  if (digits.length > 10) {
    const last10 = digits.slice(-10);
    if (last10.length === 10) {
      return `+1${last10}`;
    }
  }
  
  throw new Error(`Invalid US phone number: ${phoneNumber} (extracted digits: ${digits}, length: ${digits.length})`);
}

// Send SMS verification code via Twilio
async function sendPhoneVerificationCode(phoneNumber) {
  try {
    // Normalize phone number to E.164 format
    const normalized = normalizePhoneToE164(phoneNumber);
    
    // Validate E.164 format
    if (!/^\+1\d{10}$/.test(normalized)) {
      console.error(`❌ Invalid phone format: ${phoneNumber} -> ${normalized}`);
      return { success: false, message: "Invalid phone number format" };
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
  try {
    // Normalize phone number to E.164 format (must match format used when code was sent)
    const normalized = normalizePhoneToE164(phoneNumber);
    
    // Validate E.164 format
    if (!/^\+1\d{10}$/.test(normalized)) {
      console.error(`❌ [verifyPhoneCode] Invalid phone format: ${phoneNumber} -> ${normalized}`);
      return { success: false, message: "Invalid phone number format" };
    }
    
    const normalizedWithPlus = normalized;

    console.log(`🔍 [verifyPhoneCode] Looking up code for: ${normalizedWithPlus}`);
    console.log(`🔍 [verifyPhoneCode] Stored codes keys:`, Array.from(phoneVerificationCodes.keys()));

    const stored = phoneVerificationCodes.get(normalizedWithPlus);

    if (!stored) {
      console.warn(`⚠️ [verifyPhoneCode] No code found for: ${normalizedWithPlus}`);
      return { success: false, message: "No verification code found. Please request a new code." };
    }

    if (Date.now() > stored.expiresAt) {
      console.warn(`⚠️ [verifyPhoneCode] Code expired for: ${normalizedWithPlus}`);
      phoneVerificationCodes.delete(normalizedWithPlus);
      return { success: false, message: "Verification code expired. Please request a new code." };
    }

    if (stored.attempts >= 5) {
      console.warn(`⚠️ [verifyPhoneCode] Too many attempts for: ${normalizedWithPlus}`);
      phoneVerificationCodes.delete(normalizedWithPlus);
      return { success: false, message: "Too many attempts. Please request a new code." };
    }

    stored.attempts++;

    // Ensure both are strings for comparison
    const storedCode = String(stored.code);
    const providedCode = String(code).trim();

    console.log(`🔍 [verifyPhoneCode] Comparing codes - stored: ${storedCode}, provided: ${providedCode}`);

    if (storedCode !== providedCode) {
      console.warn(`⚠️ [verifyPhoneCode] Code mismatch for: ${normalizedWithPlus}`);
      return { success: false, message: "Invalid verification code." };
    }

    // Code is valid - remove it
    phoneVerificationCodes.delete(normalizedWithPlus);
    console.log(`✅ [verifyPhoneCode] Code verified successfully for: ${normalizedWithPlus}`);
    return { success: true, message: "Phone number verified" };
  } catch (error) {
    console.error("❌ [verifyPhoneCode] Error:", error);
    return { success: false, message: "Error verifying code: " + error.message };
  }
}

// Send email verification (using proper email service)
async function sendEmailVerification(uid, email) {
  try {
    // Ensure Firestore is available
    if (!db) {
      db = admin.firestore();
    }

    // Generate token
    const token = generateSecureToken();
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

    // Store token in Firestore for persistence across server restarts
    await db.collection("emailVerificationTokens").doc(token).set({
      uid,
      email,
      expiresAt,
      createdAt: Date.now(),
    });

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
  
  try {
    // Ensure Firestore is available
    if (!db) {
      db = admin.firestore();
    }

    // Get token from Firestore with timeout
    const tokenReadPromise = db.collection("emailVerificationTokens").doc(token).get();
    const tokenReadTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Firestore token read timeout")), 10000)
    );
    
    const tokenDoc = await Promise.race([tokenReadPromise, tokenReadTimeout]);

    if (!tokenDoc.exists) {
      console.warn(`⚠️ [verifyEmailToken] Token not found in Firestore`);
      return { success: false, message: "Invalid or expired verification token" };
    }

    const stored = tokenDoc.data();
    const now = Date.now();

    if (now > stored.expiresAt) {
      console.warn(`⚠️ [verifyEmailToken] Token expired. Expires: ${new Date(stored.expiresAt).toISOString()}, Now: ${new Date(now).toISOString()}`);
      // Delete expired token
      await db.collection("emailVerificationTokens").doc(token).delete();
      return { success: false, message: "Verification token expired" };
    }

    console.log(`✅ [verifyEmailToken] Token valid, verifying user: ${stored.uid}`);

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
    const firestorePromise = db.collection("users").doc(stored.uid).update({
      emailVerified: true,
    });
    
    const firestoreTimeout = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Firestore update timeout")), 10000)
    );
    
    await Promise.race([firestorePromise, firestoreTimeout]);
    console.log(`✅ [verifyEmailToken] Firestore updated`);

    // Remove token from Firestore
    await db.collection("emailVerificationTokens").doc(token).delete();
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
    // Ensure Firestore is available
    if (!db) {
      db = admin.firestore();
    }

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

    // Store token in Firestore for persistence across server restarts
    await db.collection("passwordResetTokens").doc(token).set({
      uid: user.uid,
      email,
      expiresAt,
      createdAt: Date.now(),
    });

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
async function verifyPasswordResetToken(token) {
  try {
    // Ensure Firestore is available
    if (!db) {
      db = admin.firestore();
    }

    // Get token from Firestore
    const tokenDoc = await db.collection("passwordResetTokens").doc(token).get();

    if (!tokenDoc.exists) {
      return { success: false, message: "Invalid or expired reset token" };
    }

    const stored = tokenDoc.data();
    const now = Date.now();

    if (now > stored.expiresAt) {
      // Delete expired token
      await db.collection("passwordResetTokens").doc(token).delete();
      return { success: false, message: "Reset token expired" };
    }

    return { success: true, uid: stored.uid, email: stored.email };
  } catch (error) {
    console.error("❌ Error verifying password reset token:", error);
    return { success: false, message: "Invalid or expired reset token" };
  }
}

// Reset password
async function resetPassword(token, newPassword) {
  const verification = await verifyPasswordResetToken(token);
  if (!verification.success) {
    return verification;
  }

  try {
    // Ensure Firestore is available
    if (!db) {
      db = admin.firestore();
    }

    // Update password in Firebase
    await admin.auth().updateUser(verification.uid, {
      password: newPassword,
    });

    // Remove token from Firestore
    await db.collection("passwordResetTokens").doc(token).delete();

    return { success: true, message: "Password reset successfully" };
  } catch (error) {
    console.error("❌ Error resetting password:", error);
    return { success: false, message: "Failed to reset password" };
  }
}

// Clean up expired tokens (run periodically)
async function cleanupExpiredTokens() {
  const now = Date.now();

  // Clean phone codes (still in memory)
  for (const [phone, data] of phoneVerificationCodes.entries()) {
    if (now > data.expiresAt) {
      phoneVerificationCodes.delete(phone);
    }
  }

  // Clean email verification tokens from Firestore
  try {
    if (!db) {
      db = admin.firestore();
    }

    const emailTokensSnapshot = await db.collection("emailVerificationTokens")
      .where("expiresAt", "<", now)
      .limit(100)
      .get();

    const emailBatch = db.batch();
    emailTokensSnapshot.forEach((doc) => {
      emailBatch.delete(doc.ref);
    });
    if (!emailTokensSnapshot.empty) {
      await emailBatch.commit();
      console.log(`🧹 Cleaned up ${emailTokensSnapshot.size} expired email verification tokens`);
    }
  } catch (error) {
    console.error("❌ Error cleaning up email tokens:", error);
  }

  // Clean password reset tokens from Firestore
  try {
    if (!db) {
      db = admin.firestore();
    }

    const passwordTokensSnapshot = await db.collection("passwordResetTokens")
      .where("expiresAt", "<", now)
      .limit(100)
      .get();

    const passwordBatch = db.batch();
    passwordTokensSnapshot.forEach((doc) => {
      passwordBatch.delete(doc.ref);
    });
    if (!passwordTokensSnapshot.empty) {
      await passwordBatch.commit();
      console.log(`🧹 Cleaned up ${passwordTokensSnapshot.size} expired password reset tokens`);
    }
  } catch (error) {
    console.error("❌ Error cleaning up password reset tokens:", error);
  }
}

// Run cleanup every hour
setInterval(() => {
  cleanupExpiredTokens().catch(err => {
    console.error("❌ Error in cleanup job:", err);
  });
}, 60 * 60 * 1000);

module.exports = {
  sendPhoneVerificationCode,
  verifyPhoneCode,
  sendEmailVerification,
  verifyEmailToken,
  sendPasswordResetEmail,
  verifyPasswordResetToken,
  resetPassword,
  normalizePhoneToE164,
};


