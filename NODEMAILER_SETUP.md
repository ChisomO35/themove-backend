# Nodemailer Setup with Office365

## ✅ Changes Made

- Replaced Resend/SendGrid with Nodemailer
- Using Office365 SMTP server
- Maintained all existing email features (HTML templates, plain text, headers)

## 📋 Required Environment Variables

Add these to your Railway backend project:

```
FROM_EMAIL=support@usethemove.com
EMAIL_PASSWORD=YOUR_OUTLOOK_PASSWORD
FROM_NAME=TheMove (optional, defaults to "TheMove")
REPLY_TO_EMAIL=support@usethemove.com (optional, defaults to FROM_EMAIL)
```

## 🔑 Getting Your Office365 Password

### Option 1: Use Your Regular Password
- If you have a Microsoft 365 account for `support@usethemove.com`
- Use the password for that account

### Option 2: Use an App Password (Recommended for Security)
1. Go to https://account.microsoft.com/security
2. Sign in with `support@usethemove.com`
3. Go to "Security" → "Advanced security options"
4. Under "App passwords", create a new app password
5. Use that app password in `EMAIL_PASSWORD` (not your regular password)

### Option 3: If Using GoDaddy Email
- GoDaddy email uses Office365 backend
- Use your GoDaddy email password
- Make sure SMTP is enabled in your GoDaddy email settings

## ⚙️ Railway Setup

1. Go to your Railway project dashboard
2. Click on your backend service
3. Go to the "Variables" tab
4. Add/Update these variables:
   - `FROM_EMAIL=support@usethemove.com`
   - `EMAIL_PASSWORD=your_password_here`
   - `FROM_NAME=TheMove` (optional)
   - `REPLY_TO_EMAIL=support@usethemove.com` (optional)
5. **Remove** these old variables (no longer needed):
   - `RESEND_API_KEY` (if you had it)
   - `SENDGRID_API_KEY` (if you had it)
6. Click "Deploy" to restart with new variables

## 🧪 Testing

After deployment, check Railway logs for:
- ✅ `Email transporter is ready to send emails` (on startup)
- ✅ `Verification email sent to [email]` (when sending)
- ❌ Any SMTP authentication errors

## 🔒 Security Notes

1. **App Passwords**: Highly recommended for production
   - More secure than using your main password
   - Can be revoked independently
   - Doesn't expose your main account password

2. **Environment Variables**: Never commit passwords to git
   - All passwords should be in Railway environment variables only
   - `.env` files should be in `.gitignore`

## 🐛 Troubleshooting

### "Invalid login" error
- Check that `EMAIL_PASSWORD` is correct
- Try using an app password instead of regular password
- Verify the email account exists and is active

### "Connection timeout" error
- Check that port 587 is not blocked
- Verify Office365 SMTP is accessible from Railway
- Some networks block SMTP ports

### "Authentication failed" error
- Make sure you're using the full email address in `FROM_EMAIL`
- Verify the password is correct (no extra spaces)
- Try creating a new app password

### Emails not arriving
- Check spam folder
- Verify the recipient email is correct
- Check Railway logs for any errors
- Test with a different email provider (Gmail, Outlook, etc.)

## 📊 Benefits of Nodemailer

1. **Direct SMTP**: No third-party service needed
2. **Full Control**: Direct connection to Office365
3. **Cost**: No per-email charges (uses your existing email account)
4. **Reliability**: Office365 has excellent uptime
5. **Deliverability**: Emails come from your verified domain

## ⚠️ Important Notes

- **Rate Limits**: Office365 has sending limits (typically 10,000 emails/day for business accounts)
- **Domain Verification**: Make sure `support@usethemove.com` is a valid email account
- **SPF/DKIM**: Still recommended to set up DNS records for better deliverability
- **Monitoring**: Monitor bounce rates and spam complaints

