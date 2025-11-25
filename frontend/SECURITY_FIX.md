# SECURITY FIX: Firebase API Key Removal

## What Happened
The Firebase API key was hardcoded in multiple HTML files and was accidentally committed to GitHub.

## What Was Fixed
1. ✅ Removed hardcoded API key from all HTML files (login.html, signup.html, setup.html, profile.html)
2. ✅ Created external config file approach using `firebase-config.js` (gitignored)
3. ✅ Removed API key from entire git history using `git filter-branch`
4. ✅ Force pushed to GitHub to remove key from remote repository

## IMPORTANT: Next Steps

### 1. ROTATE YOUR FIREBASE API KEY IMMEDIATELY
The exposed key `AIzaSyDuHcTFbqy9e0nov4eKHNTp89WVcQOrlTQ` has been publicly visible on GitHub. You MUST:

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Navigate to your project: themove-c75d3
3. Go to Project Settings > General
4. Under "Your apps", find your web app
5. **Regenerate the API key** or create a new web app with a new key
6. Update your domain restrictions to limit where the key can be used

### 2. Set Up Local Config File
1. Copy `firebase-config.example.js` to `firebase-config.js`
2. Add your NEW API key to `firebase-config.js`
3. The file is gitignored and will NOT be committed

### 3. For Production (Vercel)
Set up environment variables in Vercel dashboard and inject them at build time, or use Vercel's environment variable system to inject the config.

## Files Changed
- login.html
- signup.html  
- setup.html
- profile.html
- .gitignore (added firebase-config.js)
- firebase-config.example.js (created)

## Note
Firebase web API keys are actually meant to be public (they're restricted by domain in Firebase console), but it's still best practice to keep them in environment variables or external config files for better security and easier management.

