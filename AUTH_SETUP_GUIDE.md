# Auth Setup Guide - Fixing Email & Phone Verification

This guide will help you replace Firebase's basic auth with proper email and phone verification.

## 🎯 Problems Fixed

1. **Email Verification** - No longer goes to spam (uses Resend/SendGrid)
2. **Phone Verification** - Works with real numbers (uses Twilio directly)
3. **Password Reset** - Proper email delivery (uses Resend/SendGrid)

## 📦 Step 1: Install Dependencies

Choose one email service:

### Option A: Resend (Recommended - Better deliverability)
```bash
npm install resend
```

### Option B: SendGrid
```bash
npm install @sendgrid/mail
```

## 🔧 Step 2: Configure Environment Variables

Add to your `.env`:

```bash
# Twilio (you already have this)
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+14244478183

# Email Service (choose one)
# For Resend:
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=noreply@usethemove.com
FROM_NAME=TheMove

# OR For SendGrid:
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
FROM_EMAIL=noreply@usethemove.com
FROM_NAME=TheMove
```

## 📧 Step 3: Set Up Email Service

### Resend Setup (Recommended)
1. Go to https://resend.com
2. Sign up for free account (100 emails/day free)
3. Verify your domain (or use their test domain)
4. Get your API key
5. Update `emailService.js` - set `useResend = true`

### SendGrid Setup
1. Go to https://sendgrid.com
2. Sign up for free account (100 emails/day free)
3. Verify your domain
4. Get your API key
5. Update `emailService.js` - set `useResend = false`

## 📱 Step 4: Update Frontend

The frontend needs to be updated to use the new endpoints. See the updated files:
- `signup.html` - Use `/auth/send-verification-email`
- `setup.html` - Use `/auth/send-phone-code` and `/auth/verify-phone-code`
- `login.html` - Use `/auth/forgot-password`
- New: `verify-email.html` - For email verification
- New: `reset-password.html` - For password reset

## 🚀 Step 5: Test

1. **Test Email Verification:**
   - Sign up with a real email
   - Check inbox (should arrive quickly, not in spam)
   - Click verification link

2. **Test Phone Verification:**
   - Go to setup page
   - Enter phone number
   - Receive SMS code via Twilio
   - Enter code to verify

3. **Test Password Reset:**
   - Click "Forgot password" on login page
   - Enter email
   - Check inbox for reset link
   - Reset password

## 📝 New Backend Routes

- `POST /auth/send-phone-code` - Send SMS verification code
- `POST /auth/verify-phone-code` - Verify SMS code
- `POST /auth/send-verification-email` - Send email verification
- `GET /auth/verify-email?token=xxx` - Verify email token
- `POST /auth/forgot-password` - Send password reset email
- `POST /auth/reset-password` - Reset password with token

## 🔒 Security Features

- Verification codes expire in 10 minutes
- Email tokens expire in 24 hours
- Password reset tokens expire in 1 hour
- Max 5 attempts per phone code
- Tokens are cryptographically secure
- Automatic cleanup of expired tokens

## 💡 Notes

- Phone verification uses Twilio (you already have this set up)
- Email verification uses Resend/SendGrid (better deliverability than Firebase)
- All tokens are stored in memory (for production, consider Redis)
- Email templates are HTML with proper styling

## 🐛 Troubleshooting

### Emails not sending
- Check API key is correct
- Verify domain is verified in email service
- Check FROM_EMAIL matches verified domain
- Check spam folder (shouldn't go there with proper service)

### Phone codes not sending
- Verify Twilio credentials
- Check phone number format (+1XXXXXXXXXX)
- Check Twilio account has credits
- Verify phone number is valid

### Tokens not working
- Check token hasn't expired
- Verify URL includes token parameter
- Check server logs for errors

## 📊 Cost Estimates

- **Resend**: Free tier = 100 emails/day, then $20/month for 50k
- **SendGrid**: Free tier = 100 emails/day, then $15/month for 40k
- **Twilio SMS**: ~$0.0075 per SMS (very cheap)

For your use case, free tiers should be sufficient initially.

