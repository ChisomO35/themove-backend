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
// ✅ FIX: Ensure we get the Firestore instance from the same initialized Firebase app
// This ensures authHelpers uses the same Firestore project as server.js
let db;
function getDb() {
  if (!db) {
    // Ensure Firebase is initialized
    if (!admin.apps.length) {
      throw new Error("Firebase Admin not initialized. Make sure server.js initializes Firebase before using authHelpers.");
    }
    // Get Firestore instance from the default app (same one server.js uses)
    db = admin.firestore();
    db.settings({ ignoreUndefinedProperties: true });
    
    // Log to verify we're using the correct instance
    const app = admin.app();
    const projectId = app.options.projectId || app.options.credential?.projectId || "unknown";
    console.log(`✅ [authHelpers] Firestore instance initialized for project: ${projectId}`);
  }
  return db;
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

// Generate secure token using base64url (URL-safe, email-safe)
function generateSecureToken() {
  return crypto.randomBytes(32).toString("base64url");
}

// Normalize phone number to E.164 format
function normalizePhoneToE164(phone) {
  const digits = String(phone).replace(/\D/g, "");

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new Error("Invalid phone — must be 10 digits or +1XXXXXXXXXX");
}

// Send SMS verification code via Twilio
async function sendPhoneVerificationCode(phoneNumber) {
  try {
    console.log(`📱 [sendPhoneVerificationCode] Received phone: ${phoneNumber}`);
    const normalized = normalizePhoneToE164(phoneNumber);
    console.log(`📱 [sendPhoneVerificationCode] Normalized to: ${normalized}`);
    
    const code = generateVerificationCode();
    console.log(`📱 [sendPhoneVerificationCode] Generated code: ${code}`);
    const expiresAt = Date.now() + 10 * 60 * 1000;

    phoneVerificationCodes.set(normalized, {
      code,
      expiresAt,
      attempts: 0,
    });
    console.log(`📱 [sendPhoneVerificationCode] Code stored in memory`);

    const fromNumber = process.env.TWILIO_PHONE_NUMBER || "+14244478183";
    console.log(`📱 [sendPhoneVerificationCode] Sending SMS from: ${fromNumber} to: ${normalized}`);
    console.log(`📱 [sendPhoneVerificationCode] Twilio Account SID: ${process.env.TWILIO_ACCOUNT_SID ? process.env.TWILIO_ACCOUNT_SID.substring(0, 10) + '...' : 'MISSING'}`);
    console.log(`📱 [sendPhoneVerificationCode] Twilio Auth Token: ${process.env.TWILIO_AUTH_TOKEN ? 'PRESENT' : 'MISSING'}`);

    const message = await twilioClient.messages.create({
      body: `Your TheMove verification code is: ${code}. This code expires in 10 minutes.`,
      from: fromNumber,
      to: normalized,
    });

    console.log(`✅ [sendPhoneVerificationCode] SMS sent successfully! Message SID: ${message.sid}`);
    return { success: true, message: "Verification code sent" };
  } catch (error) {
    console.error("❌ [sendPhoneVerificationCode] Error sending phone verification:", error);
    console.error("❌ [sendPhoneVerificationCode] Error message:", error.message);
    console.error("❌ [sendPhoneVerificationCode] Error code:", error.code);
    console.error("❌ [sendPhoneVerificationCode] Error stack:", error.stack);
    return { success: false, message: `Failed to send verification code: ${error.message || 'Unknown error'}` };
  }
}

// Verify phone code
function verifyPhoneCode(phoneNumber, code) {
  try {
    const normalized = normalizePhoneToE164(phoneNumber);

    console.log(`🔍 [verifyPhoneCode] Looking up code for: ${normalized}`);
    console.log(`🔍 [verifyPhoneCode] Stored codes keys:`, Array.from(phoneVerificationCodes.keys()));

    const stored = phoneVerificationCodes.get(normalized);

  if (!stored) {
      console.warn(`⚠️ [verifyPhoneCode] No code found for: ${normalized}`);
    return { success: false, message: "No verification code found. Please request a new code." };
  }

  if (Date.now() > stored.expiresAt) {
      console.warn(`⚠️ [verifyPhoneCode] Code expired for: ${normalized}`);
      phoneVerificationCodes.delete(normalized);
    return { success: false, message: "Verification code expired. Please request a new code." };
  }

  if (stored.attempts >= 5) {
      console.warn(`⚠️ [verifyPhoneCode] Too many attempts for: ${normalized}`);
      phoneVerificationCodes.delete(normalized);
    return { success: false, message: "Too many attempts. Please request a new code." };
  }

  stored.attempts++;

    const storedCode = String(stored.code);
    const providedCode = String(code).trim();

    console.log(`🔍 [verifyPhoneCode] Comparing codes - stored: ${storedCode}, provided: ${providedCode}`);

    if (storedCode !== providedCode) {
      console.warn(`⚠️ [verifyPhoneCode] Code mismatch for: ${normalized}`);
    return { success: false, message: "Invalid verification code." };
  }

    phoneVerificationCodes.delete(normalized);
    console.log(`✅ [verifyPhoneCode] Code verified successfully for: ${normalized}`);
  return { success: true, message: "Phone number verified" };
  } catch (error) {
    console.error("❌ [verifyPhoneCode] Error:", error);
    return { success: false, message: "Error verifying code: " + error.message };
  }
}

// Send email verification (using proper email service)
async function sendEmailVerification(uid, email) {
  try {
    const db = getDb();

    // ✅ FIX: Delete any old tokens for this email to prevent stale tokens from previous signups
    try {
      const oldTokensSnapshot = await db
        .collection("emailVerificationTokens")
        .where("email", "==", email)
        .get();
      
      if (!oldTokensSnapshot.empty) {
        const batch = db.batch();
        oldTokensSnapshot.forEach((doc) => {
          batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`🧹 [sendEmailVerification] Deleted ${oldTokensSnapshot.size} old token(s) for ${email}`);
      }
    } catch (cleanupError) {
      console.warn("⚠️ [sendEmailVerification] Could not clean up old tokens:", cleanupError.message);
      // Continue anyway - not critical
    }

    const token = generateSecureToken();
    
    console.log(`🔍 [sendEmailVerification] Generated token length: ${token.length}`);
    console.log(`🔍 [sendEmailVerification] Generated token (first 50 chars): ${token.substring(0, 50)}`);

    await db.collection("emailVerificationTokens").doc(token).set({
      uid,
      email,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      createdAt: Date.now(),
    });
    
    console.log(`✅ [sendEmailVerification] Token stored in Firestore with doc ID: ${token.substring(0, 50)}...`);

    const verificationUrl = `${process.env.PUBLIC_APP_URL || "https://usethemove.com"}/verify-email?token=${token}`;
    console.log(`🔍 [sendEmailVerification] Verification URL (first 100 chars): ${verificationUrl.substring(0, 100)}...`);

    const { sendVerificationEmail } = require("./emailService");
    await sendVerificationEmail(email, verificationUrl);

    return { success: true, message: "Verification email sent" };
  } catch (error) {
    console.error("❌ Error sending email verification:", error);
    return { success: false, message: "Failed to send verification email" };
  }
}

// Verify email token (FIXED VERSION)
async function verifyEmailToken(token) {
  console.log(`🔍 [verifyEmailToken] Starting verification for token: ${token ? token.substring(0, 10) + "..." : "MISSING"}`);
  console.log(`🔍 [verifyEmailToken] Full token length: ${token ? token.length : 0}`);
  console.log(`🔍 [verifyEmailToken] Full token (first 50 chars): ${token ? token.substring(0, 50) : "MISSING"}`);

  try {
    const db = getDb();

    if (!token) return { success: false, message: "Token required" };

    // Try to decode URL encoding if present (some email clients/browsers encode URLs)
    let normalizedToken = token.trim();
    
    // ✅ FIX #1: Check verification log FIRST before doing anything else
    // This makes the endpoint idempotent - if token was recently verified, return success immediately
    try {
      const recentLog = await db.collection("emailVerificationLog").doc(normalizedToken).get();
      if (recentLog.exists) {
        const logData = recentLog.data();
        // Check if log is still valid (not expired)
        if (Date.now() < logData.expiresAt) {
          // Token was recently verified - check if email is still verified
          try {
            const user = await admin.auth().getUser(logData.uid);
            if (user && user.emailVerified) {
              console.log(`✅ [verifyEmailToken] Token found in verification log - email is already verified!`);
              return { success: true, message: "Email already verified" };
            }
          } catch (userError) {
            console.warn(`⚠️ [verifyEmailToken] Could not check user from log:`, userError.message);
            // Continue to normal flow
          }
        } else {
          // Log expired, clean it up
          await db.collection("emailVerificationLog").doc(normalizedToken).delete();
        }
      }
    } catch (logError) {
      console.warn(`⚠️ [verifyEmailToken] Error checking verification log:`, logError.message);
      // Continue to normal flow
    }
    try {
      // Try decoding - if it's already decoded, decodeURIComponent will throw or return same value
      const decoded = decodeURIComponent(normalizedToken);
      if (decoded !== normalizedToken) {
        console.log(`🔍 [verifyEmailToken] Token was URL-encoded, decoded it`);
        normalizedToken = decoded;
      }
    } catch (e) {
      // Not URL-encoded, continue with original
      console.log(`🔍 [verifyEmailToken] Token is not URL-encoded (or decode failed)`);
    }

    console.log(`🔍 [verifyEmailToken] Normalized token length: ${normalizedToken.length}`);
    console.log(`🔍 [verifyEmailToken] Normalized token (first 50 chars): ${normalizedToken.substring(0, 50)}`);

    // ✅ FIX — declare tokenDoc here so it's available after the try block
    let tokenDoc;

    try {
      // Try exact match first
      const tokenReadPromise = db.collection("emailVerificationTokens").doc(normalizedToken).get();
      const tokenReadTimeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Firestore token read timeout")), 10000)
      );

      // ❗ FIX — assign to outer-scoped tokenDoc
      tokenDoc = await Promise.race([tokenReadPromise, tokenReadTimeout]);

      console.log(`🔍 [verifyEmailToken] Token document exists (exact match): ${tokenDoc.exists}`);
      
      // If not found, try querying by token value to see what's actually stored
      if (!tokenDoc.exists) {
        console.log(`🔍 [verifyEmailToken] Token not found with exact match, checking all tokens for this pattern...`);
        const allTokensSnapshot = await db
          .collection("emailVerificationTokens")
          .where("email", "!=", "__dummy__") // Just to get a query
          .limit(5)
          .get();
        
        console.log(`🔍 [verifyEmailToken] Found ${allTokensSnapshot.size} token(s) in collection`);
        allTokensSnapshot.forEach((doc) => {
          const docId = doc.id;
          console.log(`🔍 [verifyEmailToken] Stored token ID (first 50 chars): ${docId.substring(0, 50)}, length: ${docId.length}`);
          const data = doc.data();
          console.log(`🔍 [verifyEmailToken] Stored token data:`, { uid: data.uid, email: data.email });
        });
      }
    } catch (readError) {
      console.error("❌ [verifyEmailToken] Firestore read error:", readError);
      throw readError;
    }

    // Handle missing token
    if (!tokenDoc.exists) {
      console.log(`⚠️ [verifyEmailToken] Token not found in storage. Looking for: ${normalizedToken.substring(0, 50)}...`);
      console.log(`⚠️ [verifyEmailToken] Attempting to find token by partial match or checking all recent tokens...`);
      
      // Try to find the token by querying all tokens and comparing
      // This handles cases where URL encoding/decoding might have changed the token slightly
      // Also check ALL tokens (not just non-expired) in case token was just deleted after verification
      try {
        // First try non-expired tokens
        let allTokensSnapshot = await db
          .collection("emailVerificationTokens")
          .where("expiresAt", ">", Date.now())
          .limit(100)
          .get();
        
        console.log(`🔍 [verifyEmailToken] Found ${allTokensSnapshot.size} non-expired token(s) in collection`);
        
        // If not found, also check recently created tokens (within last 24 hours) even if expired
        // This catches tokens that were just used and deleted
        if (allTokensSnapshot.empty) {
          const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
          allTokensSnapshot = await db
            .collection("emailVerificationTokens")
            .where("createdAt", ">", oneDayAgo)
            .limit(100)
            .get();
          console.log(`🔍 [verifyEmailToken] Found ${allTokensSnapshot.size} recently created token(s) (including expired)`);
        }
        
        // Try to find a token that matches (exact or close match)
        let foundToken = null;
        for (const doc of allTokensSnapshot.docs) {
          const docId = doc.id;
          // Check if tokens match exactly or if one is URL-encoded version of the other
          if (docId === normalizedToken || 
              decodeURIComponent(docId) === normalizedToken ||
              docId === encodeURIComponent(normalizedToken) ||
              decodeURIComponent(normalizedToken) === docId) {
            foundToken = doc;
            console.log(`✅ [verifyEmailToken] Found matching token using fallback matching!`);
            break;
          }
        }
        
        if (foundToken) {
          tokenDoc = foundToken;
          const storedData = foundToken.data();
          // If token was found but might be expired or already used, check if email is verified
          try {
            const user = await admin.auth().getUser(storedData.uid);
            if (user && user.emailVerified) {
              console.log(`✅ [verifyEmailToken] Token was used but email is already verified. Returning success.`);
              // Delete the token if it still exists
              try {
                await db.collection("emailVerificationTokens").doc(foundToken.id).delete();
              } catch (e) {
                // Token might already be deleted, that's fine
              }
              return { success: true, message: "Email already verified" };
            }
          } catch (userError) {
            console.warn(`⚠️ [verifyEmailToken] Could not check user status:`, userError.message);
          }
        } else {
          // Token not found - verification log was already checked at the start
          // If we get here, the token truly doesn't exist and wasn't recently verified
          console.log(`❌ [verifyEmailToken] Token not found even with fallback matching`);
          console.log(`⚠️ [verifyEmailToken] Token not found in storage or verification log. Returning error.`);
          return { success: false, message: "Invalid or expired verification token. If you already verified your email, try logging in. Otherwise, please request a new verification email." };
        }
      } catch (queryError) {
        console.error("❌ [verifyEmailToken] Error querying tokens:", queryError);
        return { success: false, message: "Invalid or expired verification token. Please request a new verification email." };
      }
    }

    const stored = tokenDoc.data();
    // Use the actual document ID (might be different from normalizedToken if found via fallback)
    const actualTokenId = tokenDoc.id;
    const now = Date.now();

    if (now > stored.expiresAt) {
      await db.collection("emailVerificationTokens").doc(actualTokenId).delete();
      return { success: false, message: "Verification token expired" };
    }

    // ✅ FIX #3: Check if user exists and if email is already verified BEFORE doing anything else
    // This makes the endpoint idempotent
    let user;
    try {
      user = await admin.auth().getUser(stored.uid);
      
      // ✅ FIX #3: If email is already verified, return success immediately (idempotent)
      if (user.emailVerified) {
        console.log(`✅ [verifyEmailToken] Email already verified for user ${stored.uid}`);
        // Store in verification log before deleting token
        try {
          await db.collection("emailVerificationLog").doc(actualTokenId).set({
            uid: stored.uid,
            email: stored.email,
            verifiedAt: Date.now(),
            expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour
          });
        } catch (logError) {
          console.warn("⚠️ [verifyEmailToken] Could not create verification log:", logError.message);
        }
        await db.collection("emailVerificationTokens").doc(actualTokenId).delete();
        return { success: true, message: "Email already verified" };
      }
    } catch (userError) {
      // User doesn't exist (was deleted) - delete the stale token
      console.warn(`⚠️ [verifyEmailToken] User ${stored.uid} does not exist (likely deleted). Deleting stale token.`);
      await db.collection("emailVerificationTokens").doc(actualTokenId).delete();
      return { success: false, message: "Invalid or expired verification token. Please request a new verification email." };
    }

    // Verify the email
    await admin.auth().updateUser(stored.uid, { emailVerified: true });
    await db.collection("users").doc(stored.uid).update({ emailVerified: true });

    // ✅ FIX: Store verification log before deleting token (for duplicate request handling)
    // Keep this for 1 hour so duplicate requests can check it
    try {
      await db.collection("emailVerificationLog").doc(actualTokenId).set({
        uid: stored.uid,
        email: stored.email,
        verifiedAt: Date.now(),
        expiresAt: Date.now() + (60 * 60 * 1000), // 1 hour
      });
    } catch (logError) {
      console.warn("⚠️ [verifyEmailToken] Could not create verification log:", logError.message);
      // Continue anyway - not critical
    }

    await db.collection("emailVerificationTokens").doc(actualTokenId).delete();

    return { success: true, message: "Email verified successfully" };
  } catch (error) {
    console.error("❌ [verifyEmailToken] Error:", error);
    return { success: false, message: "Failed to verify email." };
  }
}

// Password reset functions unchanged...
async function sendPasswordResetEmail(email) {
  try {
    const db = getDb();

    let user;
    try {
      user = await admin.auth().getUserByEmail(email);
    } catch {
      return { success: true, message: "If an account exists, a password reset email has been sent" };
    }

    const token = generateSecureToken();
    const expiresAt = Date.now() + 60 * 60 * 1000;

    await db.collection("passwordResetTokens").doc(token).set({
      uid: user.uid,
      email,
      expiresAt,
      createdAt: Date.now(),
    });

    const resetUrl = `${process.env.PUBLIC_APP_URL || "https://usethemove.com"}/reset-password?token=${token}`;

    const { sendPasswordResetEmail } = require("./emailService");
    await sendPasswordResetEmail(email, resetUrl);

    return { success: true, message: "If an account exists, a password reset email has been sent" };
  } catch (error) {
    console.error("❌ Error sending password reset:", error);
    return { success: false, message: "Failed to send password reset email" };
  }
}

async function verifyPasswordResetToken(token) {
  try {
    const db = getDb();

    const tokenDoc = await db.collection("passwordResetTokens").doc(token).get();

    if (!tokenDoc.exists) {
    return { success: false, message: "Invalid or expired reset token" };
  }

    const stored = tokenDoc.data();
  if (Date.now() > stored.expiresAt) {
      await db.collection("passwordResetTokens").doc(token).delete();
    return { success: false, message: "Reset token expired" };
  }

  return { success: true, uid: stored.uid, email: stored.email };
  } catch (error) {
    console.error("❌ Error verifying reset token:", error);
    return { success: false, message: "Invalid or expired reset token" };
  }
}

async function resetPassword(token, newPassword) {
  const verification = await verifyPasswordResetToken(token);
  if (!verification.success) return verification;

  try {
    const db = getDb();

    await admin.auth().updateUser(verification.uid, { password: newPassword });
    await db.collection("passwordResetTokens").doc(token).delete();

    return { success: true, message: "Password reset successfully" };
  } catch (error) {
    console.error("❌ Error resetting password:", error);
    return { success: false, message: "Failed to reset password" };
  }
}

// Cleanup expired tokens (unchanged)
async function cleanupExpiredTokens() {
  const now = Date.now();

  for (const [phone, data] of phoneVerificationCodes.entries()) {
    if (now > data.expiresAt) {
      phoneVerificationCodes.delete(phone);
    }
  }

  try {
    const db = getDb();

    const emailTokensSnapshot = await db
      .collection("emailVerificationTokens")
      .where("expiresAt", "<", now)
      .limit(100)
      .get();

    const emailBatch = db.batch();
    emailTokensSnapshot.forEach((doc) => emailBatch.delete(doc.ref));
    if (!emailTokensSnapshot.empty) await emailBatch.commit();
  } catch {}

  try {
    const db = getDb();

    const passwordTokensSnapshot = await db
      .collection("passwordResetTokens")
      .where("expiresAt", "<", now)
      .limit(100)
      .get();

    const passwordBatch = db.batch();
    passwordTokensSnapshot.forEach((doc) => passwordBatch.delete(doc.ref));
    if (!passwordTokensSnapshot.empty) await passwordBatch.commit();
  } catch {}
}

setInterval(() => cleanupExpiredTokens().catch(console.error), 60 * 60 * 1000);

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
