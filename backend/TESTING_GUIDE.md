# Testing Guide

This guide explains how to test the search and daily digest functionality locally using generated test data.

## 🚀 Quick Start

### 1. Generate Test Data

First, generate fake posters and users to test with:

```bash
npm run generate-test-data
```

This will:
- Create ~24 fake event posters (spread across different dates)
- Create ~2 organization posters
- Create 5 test users with varied interests
- Save everything to Firestore and Pinecone

**Note:** This uses your actual Firestore and Pinecone instances, so be careful in production!

### 2. Test Search Queries

Test various search queries to see how results are ranked:

```bash
npm run test-searches
```

This will run 20+ different queries including:
- Time-based: "what's happening tonight", "free food this weekend"
- Activity-based: "study groups", "networking events", "free pizza"
- Combination: "free pizza this weekend", "poker right now"
- General: "what's happening", "free events"

### 3. Test Daily Digest

Test what daily digests would look like for all users:

```bash
npm run test-digest
```

This will:
- Find the top 3 matches for each user based on their interests
- Show what would be sent in their daily digest
- Display similarity scores

---

## 📊 Understanding Results

### Search Results

The enhanced ranking system:
- **Quality Threshold**: Only shows results with similarity score ≥ 0.5
- **Exact Match Boost**: +0.1 for exact tag matches
- **Recency Boost**: +0.05 for events in next 7 days
- **Adaptive Count**: Shows 1-5 results based on quality:
  - Score > 0.8: up to 5 results
  - Score > 0.7: up to 4 results
  - Score > 0.6: 3 results
  - Score > 0.5: 2 results
  - Otherwise: 1 result
- **Diversity**: Max 1 per organization if showing 3+ results

### Daily Digest Results

Each user gets:
- Top 3 upcoming events matching their interests
- Filtered to exclude past events
- Filtered to exclude already-seen events
- Sorted by similarity score

---

## 🧪 Custom Testing

### Test Specific Query

Edit `testSearches.js` and add your query to `TEST_QUERIES`:

```javascript
const TEST_QUERIES = [
  "your custom query here",
  // ... existing queries
];
```

### Test Specific User

Edit `testDailyDigest.js` to filter to specific users, or modify `generateTestData.js` to create users with specific interests.

### Add More Test Data

Edit `generateTestData.js`:
- Add more templates to `EVENT_TEMPLATES` or `ORG_TEMPLATES`
- Add more users to `USER_TEMPLATES`
- Modify date ranges, locations, etc.

---

## 🔍 What to Look For

### Search Quality
- ✅ Are results relevant to the query?
- ✅ Are exact matches ranked higher?
- ✅ Are recent events prioritized?
- ✅ Is there good variety (not all from same org)?
- ✅ Are low-quality results filtered out?

### Daily Digest Quality
- ✅ Do results match user interests?
- ✅ Are results diverse (different event types)?
- ✅ Are results upcoming (not past)?
- ✅ Are similarity scores reasonable (>0.5)?

### Edge Cases
- ✅ What happens with very specific queries?
- ✅ What happens with very general queries?
- ✅ What happens when no results match?
- ✅ What happens with date/time filters?

---

## 🐛 Troubleshooting

### "No results found"
- Check if test data was generated successfully
- Verify Firestore and Pinecone connections
- Check if filters are too strict

### "Low similarity scores"
- Verify embeddings were created correctly
- Check if user interests match poster tags
- Consider adjusting quality threshold (currently 0.5)

### "Too many/few results"
- Adjust adaptive count thresholds in `searchCore.js`
- Modify quality threshold
- Check diversity filter settings

---

## 📝 Notes

- Test data uses realistic UNC campus locations and event types
- All test data is marked with school "UNC-Chapel Hill"
- Test users have varied interests to test matching
- Test posters span multiple weeks to test date filtering
- Organizations don't have dates (to test mixed results)

---

## 🧹 Cleanup

To remove test data (if needed):

```javascript
// Run in Node.js console or create cleanup script
const admin = require("firebase-admin");
// ... initialize Firebase ...

// Delete test posters
const posters = await db.collection("posters").where("school", "==", "UNC-Chapel Hill").get();
posters.forEach(doc => doc.ref.delete());

// Delete test users
const users = await db.collection("users").where("email", "like", "%@unc.edu").get();
users.forEach(doc => doc.ref.delete());
```

**Note:** This will delete ALL UNC posters/users, not just test data. Be careful!

