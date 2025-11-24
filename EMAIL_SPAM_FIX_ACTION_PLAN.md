# Email Spam Fix - Action Plan

Based on Resend's best practices, here's what needs to be done to fix email deliverability.

## 🔴 CRITICAL (Do This First)

### 1. Verify Domain in Resend

**Steps:**
1. Go to https://resend.com/domains
2. Click "Add Domain"
3. Enter `usethemove.com`
4. Resend will provide DNS records to add
5. Add ALL the DNS records they provide to your domain's DNS settings
6. Wait for verification (can take a few minutes to 24 hours)

**Why this matters:** Without domain verification, Gmail sees you as unauthenticated and sends emails to spam.

### 2. Add DNS Records

After Resend provides the records, add them to your domain DNS:

**SPF Record** (Resend will provide exact value):
```
Type: TXT
Name: @ (or usethemove.com)
Value: [Provided by Resend - usually includes _spf.resend.com]
```

**DKIM Record** (Resend will provide exact value):
```
Type: TXT
Name: [Provided by Resend - usually something like resend._domainkey]
Value: [Provided by Resend]
```

**DMARC Record** (You create this):
```
Type: TXT
Name: _dmarc
Value: v=DMARC1; p=quarantine; rua=mailto:dmarc@usethemove.com
```

**Where to add:** Your domain registrar's DNS settings (e.g., Namecheap, GoDaddy, Cloudflare)

### 3. Update Email Address (Recommended)

Currently using `verify@usethemove.com` which is good! But make sure:

1. **Set in Railway environment variables:**
   ```
   FROM_EMAIL=verify@usethemove.com
   FROM_NAME=TheMove
   REPLY_TO_EMAIL=support@usethemove.com  (optional, but recommended)
   ```

2. **Create the email address** (if you have email hosting):
   - Create `verify@usethemove.com` in your email hosting
   - Create `support@usethemove.com` for replies
   - This helps legitimize your domain

## 🟡 IMPORTANT (Do After Critical Steps)

### 4. Simplify Email Content

Your current HTML is good, but we can make it simpler to improve deliverability:

**Current issues:**
- Complex HTML with gradients and styling
- Could be seen as "marketing" rather than "transactional"

**Recommendation:** Keep current format but ensure:
- Plain text version is always included ✅ (already done)
- Links point to your domain ✅ (already done - usethemove.com)
- No hidden content ✅ (already good)

### 5. Warm Up Your Domain

Since you're just starting:

1. **Start with low volume** - Only send to real signups (you're already doing this)
2. **Send person-to-person emails first** - Use your Gmail account to send a few emails from `verify@usethemove.com` to yourself
3. **Monitor engagement** - Track opens and clicks
4. **Gradually increase** - As engagement improves, you can send more

### 6. Monitor Your Reputation

**Set up Google Postmaster Tools:**
1. Go to https://postmaster.google.com/
2. Add your domain `usethemove.com`
3. Add the DNS record they provide
4. Monitor spam rates, reputation, etc.

**Check regularly:**
- Google Safe Browsing: https://transparencyreport.google.com/safe-browsing/search
- Spamhaus: https://www.spamhaus.org/lookup/ (check your domain)

## 🟢 GOOD PRACTICES (Ongoing)

### 7. Content Best Practices

✅ **Already doing:**
- Plain text version included
- Clear subject line ("Verify Your Email")
- Links match your domain
- No spam trigger words

✅ **Keep doing:**
- Keep content simple and transactional
- Don't use excessive emojis or special characters
- Make sure unsubscribe is easy (for future marketing emails)

### 8. Sending Patterns

✅ **Already good:**
- Only sending to people who sign up (opt-in)
- Transactional emails (verification, password reset)
- Low volume (just starting)

### 9. List Management

For future marketing emails:
- Remove bounced addresses immediately
- Remove unsubscribed users
- Monitor complaint rates (keep under 0.08%)
- Keep bounce rates low (under 4%)

## 📋 Checklist

- [ ] Verify `usethemove.com` in Resend dashboard
- [ ] Add SPF DNS record (from Resend)
- [ ] Add DKIM DNS record (from Resend)
- [ ] Add DMARC DNS record (create yourself)
- [ ] Wait for domain verification (check Resend dashboard)
- [ ] Set `FROM_EMAIL=verify@usethemove.com` in Railway
- [ ] Set `REPLY_TO_EMAIL=support@usethemove.com` in Railway (optional)
- [ ] Test email sending after verification
- [ ] Set up Google Postmaster Tools
- [ ] Monitor first few emails for spam placement
- [ ] Check Google Safe Browsing for your domain

## 🧪 Testing

After completing the critical steps:

1. **Send a test email** to yourself
2. **Check spam folder** - should go to inbox after verification
3. **Use mail-tester.com:**
   - Send test email to the address they provide
   - Get spam score (aim for 10/10)
   - Fix any issues they identify

## 🚨 If Still Going to Spam After Verification

1. **Check DNS records** - Use https://mxtoolbox.com/ to verify SPF, DKIM, DMARC
2. **Check domain reputation** - Google Safe Browsing, Spamhaus
3. **Simplify HTML further** - Remove gradients, use simpler styling
4. **Wait and warm up** - New domains need time to build reputation
5. **Contact Resend support** - They have deliverability experts

## 📊 Expected Timeline

- **DNS propagation:** 5 minutes to 24 hours
- **Domain verification:** Usually instant after DNS propagates
- **Reputation building:** 1-2 weeks of consistent sending
- **Full deliverability:** 2-4 weeks with good practices

## 💡 Quick Win

The fastest way to improve deliverability right now:
1. Verify domain in Resend (5 minutes)
2. Add DNS records (5 minutes)
3. Wait for verification (up to 24 hours)
4. This alone should move emails from spam to inbox for most providers

