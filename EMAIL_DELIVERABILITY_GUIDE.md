# Email Deliverability Guide

## Issues Fixed

1. **Page Hanging**: Added 10-second timeout and better error handling to verification page
2. **Email Format**: Added plain text version and reply-to header

## Remaining Steps to Fix Spam Issues

### 1. Verify Your Domain in Resend/SendGrid

**For Resend:**
1. Go to https://resend.com/domains
2. Add `usethemove.com` as a domain
3. Add the DNS records they provide (SPF, DKIM, DMARC)
4. Wait for verification (usually takes a few minutes)

**For SendGrid:**
1. Go to Settings > Sender Authentication
2. Authenticate your domain `usethemove.com`
3. Add the DNS records they provide
4. Wait for verification

### 2. Update Email Address

Instead of `noreply@usethemove.com`, consider using:
- `hello@usethemove.com` (more trustworthy)
- `support@usethemove.com` (if you have support)
- `verify@usethemove.com` (specific to verification)

Update in Railway environment variables:
- `FROM_EMAIL=hello@usethemove.com` (or your preferred address)
- `REPLY_TO_EMAIL=support@usethemove.com` (optional, for replies)

### 3. DNS Records (Critical for Deliverability)

After verifying your domain, add these DNS records:

**SPF Record** (prevents spoofing):
```
Type: TXT
Name: @ (or usethemove.com)
Value: v=spf1 include:_spf.resend.com ~all
```

**DKIM Record** (email authentication):
```
Type: TXT
Name: resend._domainkey (or similar from Resend)
Value: [provided by Resend]
```

**DMARC Record** (email policy):
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@usethemove.com
```

### 4. Test Email Deliverability

Use these tools to test:
- https://www.mail-tester.com/ (send test email, get spam score)
- https://mxtoolbox.com/ (check DNS records)
- https://www.dmarcanalyzer.com/ (check DMARC setup)

### 5. Additional Tips

1. **Warm up your domain**: Start with low volume, gradually increase
2. **Monitor bounce rates**: Keep bounce rate < 5%
3. **Avoid spam trigger words**: Already using good subject lines
4. **Use consistent sender name**: "TheMove" is good
5. **Include unsubscribe link**: Not needed for verification emails, but good for marketing

## Current Status

✅ Added plain text version to emails
✅ Added reply-to header
✅ Added timeout to verification page
✅ Improved error handling

⏳ **Action Required**: Verify domain in Resend/SendGrid and add DNS records

