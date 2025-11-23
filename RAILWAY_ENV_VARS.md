# Railway Environment Variables Setup

## ✅ Required Environment Variables for New Auth System

Add these to your Railway backend project:

### Email Service (Choose One)

**Option 1: Resend (Recommended)**
```
RESEND_API_KEY=re_xxxxxxxxxxxxx
FROM_EMAIL=noreply@usethemove.com
FROM_NAME=TheMove
```

**Option 2: SendGrid**
```
SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
FROM_EMAIL=noreply@usethemove.com
FROM_NAME=TheMove
```

### Already Have (Verify These Are Set)

```
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+14244478183
PUBLIC_APP_URL=https://usethemove.com
```

## 📝 How to Add in Railway

1. Go to your Railway project dashboard
2. Click on your backend service
3. Go to the "Variables" tab
4. Click "New Variable"
5. Add each variable above
6. Click "Deploy" to restart with new variables

## 🔍 Quick Check

After adding variables, check your Railway logs to ensure:
- ✅ No errors about missing RESEND_API_KEY or SENDGRID_API_KEY
- ✅ Email service initializes correctly
- ✅ Twilio client initializes correctly

## ⚠️ Important Notes

1. **Email Service**: You MUST install the package first:
   ```bash
   npm install resend
   # OR
   npm install @sendgrid/mail
   ```
   Then add the API key to Railway.

2. **FROM_EMAIL**: Must match a verified domain in your email service:
   - Resend: Verify domain in dashboard
   - SendGrid: Verify domain in dashboard

3. **Phone Verification**: Uses your existing Twilio setup, no changes needed there.

## 🧪 Testing

After deployment, test:
1. Sign up → Should receive email (check inbox, not spam)
2. Phone verification → Should receive SMS code
3. Password reset → Should receive reset email

