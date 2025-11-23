# TheMove System Analysis & Optimization Recommendations

## 🔴 CRITICAL ISSUES (Fix Immediately)

### 1. Daily Digest Cost Explosion
**Current Implementation:**
- Creates embeddings for EVERY poster for EVERY user on EVERY run
- Example: 100 posters × 50 users = 5,000 embedding API calls per day
- Cost: ~$0.30/day = ~$9/month (scales linearly with users/posters)

**Root Cause:**
- `dailyDigest.js` line 109: `const posterEmbedding = await createEmbedding(posterText);`
- Posters already have embeddings stored in Pinecone, but code ignores them

**Fix:**
- Use Pinecone query with user embedding instead of creating poster embeddings
- Reduces cost by ~99% (from 5,000 calls to ~50 calls for 50 users)
- **Estimated savings: $8.70/month per 50 users**

### 2. User Embedding Not Persisted
**Current Implementation:**
- User embeddings created on-the-fly in daily digest if missing
- Not stored in Firestore when user is created/updated
- Recreated every time if missing

**Root Cause:**
- `server.js` line 278: Creates embedding but doesn't store in Firestore
- `dailyDigest.js` line 65-78: Creates embedding if missing but only stores once

**Fix:**
- Store user embedding in Firestore when user is created/updated
- Update `createUser` and `updateUser` to save embedding to Firestore
- **Eliminates redundant API calls**

---

## ⚠️ MAJOR ISSUES (Fix Soon)

### 3. Interest/Category Mismatch
**Current Implementation:**
- **User Interests:** Granular tags (e.g., "Hip Hop / Rap", "Basketball", "Theatre")
- **Poster Categories:** Broad categories (e.g., "Music", "Sports & Fitness", "Arts & Culture")
- **Mismatch:** User selects "Hip Hop / Rap" but poster categorized as "Music"

**Impact:**
- Embeddings may not align well
- Semantic similarity might miss matches
- Users interested in specific genres might miss relevant events

**Recommendations:**
1. **Option A:** Map user interests to poster categories
   - Create mapping: "Hip Hop / Rap" → "Music"
   - Include both in user embedding text
   
2. **Option B:** Use both granular interests AND categories in matching
   - Include user interests in embedding text
   - Use Pinecone metadata filtering for category matching
   
3. **Option C:** Make poster categories more granular
   - Extract specific tags from posters (already done)
   - Match user interests directly to poster tags

**Best Approach:** Option C - Use tags for matching
- Posters already have `tags` array extracted by AI
- User interests are already granular
- Match interests directly to tags in embedding text

### 4. Inefficient Poster Embedding Text
**Current Implementation:**
- Poster embedding includes: title, org, description, date, time, location, audience, cost, frequency, tags, categories, type
- User embedding includes: name, dorm, interests

**Issue:**
- Poster embedding doesn't emphasize tags/interests enough
- User embedding doesn't include context about what they're looking for

**Recommendations:**
- **Poster embedding:** Prioritize tags and categories in the text
- **User embedding:** Include "looking for events related to [interests]"

---

## ✅ WHAT'S WORKING WELL

1. **Poster Extraction:**
   - Using GPT-4o-mini (cost-effective)
   - Good structured extraction
   - Tags and categories extracted

2. **Search Implementation:**
   - Uses Pinecone query (efficient)
   - Date/time filtering works well
   - Returns top 3 results

3. **Data Structure:**
   - Normalized dates, times, locations
   - Good metadata in Pinecone
   - School filtering in place

---

## 📊 COST ANALYSIS

### Current Costs (per day, 100 posters, 50 users):
- **Poster Upload:** 100 × $0.00015 = $0.015/day
- **Daily Digest:** 5,000 × $0.00015 = $0.75/day ⚠️
- **Search (SMS):** ~50 × $0.00015 = $0.0075/day
- **Total:** ~$0.77/day = ~$23/month

### Optimized Costs (after fixes):
- **Poster Upload:** 100 × $0.00015 = $0.015/day
- **Daily Digest:** 50 × $0.00015 = $0.0075/day ✅
- **Search (SMS):** ~50 × $0.00015 = $0.0075/day
- **Total:** ~$0.03/day = ~$0.90/month

**Savings: ~96% reduction in daily digest costs**

---

## 🎯 PRIORITY FIXES

### Priority 1: Fix Daily Digest (CRITICAL)
- Replace manual embedding creation with Pinecone query
- Use user embedding to query Pinecone for similar posters
- Filter by school, date, and unseen posters

### Priority 2: Store User Embeddings
- Update `createUser` to store embedding in Firestore
- Update `updateUser` to store embedding in Firestore
- Remove embedding creation from daily digest

### Priority 3: Improve Interest Matching
- Enhance user embedding text to include "looking for events about [interests]"
- Enhance poster embedding text to emphasize tags
- Consider adding category-to-interest mapping

### Priority 4: Optimize Embedding Text
- Make poster embedding text more focused on searchable content
- Make user embedding text more focused on what they want

---

## 💡 ADDITIONAL OPTIMIZATIONS

1. **Caching:**
   - Cache user embeddings (already done in Firestore)
   - Cache poster metadata queries

2. **Batch Processing:**
   - Process multiple users in parallel
   - Use Promise.all for parallel Pinecone queries

3. **Metadata Filtering:**
   - Use Pinecone metadata filters for date/school filtering
   - Reduces query results before similarity calculation

4. **Interest Weighting:**
   - Allow users to mark "favorite" interests
   - Weight favorite interests higher in matching

---

## 📝 IMPLEMENTATION NOTES

### Daily Digest Fix:
```javascript
// Instead of:
for (const poster of unseenPosters) {
  const posterEmbedding = await createEmbedding(posterText);
  // compute similarity...
}

// Do:
const queryEmbedding = userEmbedding; // already have it
const results = await index.query({
  vector: queryEmbedding,
  topK: 20,
  filter: {
    type: "poster",
    school: user.school,
    date_normalized: { $gte: today }
  }
});
// Filter out seen posters, take top 3
```

### User Embedding Storage:
```javascript
// In createUser/updateUser:
const userData = {
  // ... existing fields
  embedding: embedding, // ADD THIS
  embedding_model: "text-embedding-3-small",
  embedding_version: "v1"
};
```

---

## 🎓 ACCURACY IMPROVEMENTS

1. **Better User Embedding Text:**
   - Current: "I'm a UNC student living in {dorm} who enjoys {interests}."
   - Better: "I'm a UNC student interested in {interests}. I'm looking for campus events related to {interests}."

2. **Better Poster Embedding Text:**
   - Emphasize tags and categories
   - Include audience, cost, frequency prominently
   - Make searchable keywords more prominent

3. **Hybrid Matching:**
   - Use semantic similarity (embeddings) for general matching
   - Use exact tag matching for specific interests
   - Combine both scores

---

## 📈 SCALABILITY CONSIDERATIONS

- **Current:** O(users × posters) embedding calls
- **Optimized:** O(users) Pinecone queries
- **At scale:** 1,000 users, 1,000 posters
  - Current: 1,000,000 embedding calls/day = $150/day
  - Optimized: 1,000 Pinecone queries/day = $0.15/day

---

## ✅ SUMMARY

**Critical Fixes Needed:**
1. Replace daily digest embedding creation with Pinecone queries
2. Store user embeddings in Firestore
3. Improve interest/category alignment

**Expected Impact:**
- 96% cost reduction in daily digest
- Faster processing (no embedding creation)
- Better matching accuracy
- Scales to thousands of users

**Estimated Time to Fix:**
- Priority 1: 2-3 hours
- Priority 2: 1 hour
- Priority 3: 2-3 hours
- Total: ~6 hours of development

