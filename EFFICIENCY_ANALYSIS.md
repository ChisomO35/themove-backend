# Efficiency Analysis & Optimization Opportunities

## 📱 Current Search Implementation

**SMS Search Uses:** `searchCore.js` → `searchPostersForSMS()`
- This is the active search file for phone number queries
- `search.js` appears to be for CLI/testing only

---

## 🔍 Search Flow Analysis

### Current Search Process (per query):
1. **Intent Detection** → LLM call (GPT-4o-mini)
2. **Date Extraction** → LLM call (if calendar date present)
3. **Query Embedding** → Embedding API call
4. **Pinecone Query** → Vector search
5. **Post-query Filtering** → Multiple sequential filters

**Total API Calls per Search:** 2-3 LLM calls + 1 embedding call

---

## ⚠️ INEFFICIENCIES FOUND

### 1. **Intent Detection - Unnecessary LLM Call**
**Current:**
- Every search calls `detectIntent()` using GPT-4o-mini
- Cost: ~$0.00015 per search
- Most queries are clearly "search" intent

**Problem:**
- "poker tonight?" → LLM call → returns "search"
- "free food?" → LLM call → returns "search"
- "what's happening?" → LLM call → returns "search"

**Optimization:**
- Use simple keyword matching for obvious cases
- Only use LLM for ambiguous queries
- **Savings:** ~80% of intent detection calls eliminated
- **Cost reduction:** ~$0.00012 per search (80% of searches)

**Implementation:**
```javascript
function quickIntentDetect(message) {
  const lower = message.toLowerCase();
  if (lower.includes("sign up") || lower.includes("signup") || lower.includes("register")) 
    return "signup";
  if (lower.includes("what is") || lower.includes("how does") || lower.includes("what's themove"))
    return "info";
  // Default to search for everything else
  return "search";
}
```

---

### 2. **Date Extraction - LLM Call for Simple Cases**
**Current:**
- Has deterministic logic for "tonight", "tomorrow", weekdays ✅
- But still uses LLM for calendar dates like "Nov 22", "11/25"

**Problem:**
- Most date queries are simple: "tonight", "tomorrow", "Friday"
- LLM only needed for complex dates like "November 22nd"

**Optimization:**
- Expand deterministic date parsing
- Add regex patterns for common date formats: "11/25", "Nov 22", "11-25"
- Only use LLM for truly ambiguous dates
- **Savings:** ~70% of date extraction LLM calls eliminated

**Implementation:**
```javascript
// Add regex patterns before LLM call:
const datePatterns = [
  /(\d{1,2})\/(\d{1,2})/,           // 11/25
  /(\d{1,2})-(\d{1,2})/,            // 11-25
  /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})/i, // Nov 22
];
```

---

### 3. **Query Expansion - Potentially Unnecessary**
**Current:**
```javascript
let expandedQuery = `
  Today's date is ${currentDate}.
  A ${school} student is looking for a campus event.
  Query: "${query}"
  Match using title, tags, description, date, time, location.
`.trim();
```

**Analysis:**
- The expansion adds context but might not significantly improve matching
- The poster embeddings already have rich context
- Could test with simpler query: just the user's query text

**Potential Optimization:**
- A/B test: simple query vs expanded query
- If accuracy is similar, use simple query (saves tokens)

---

### 4. **Pinecone Filtering - Could Use Metadata Filters**
**Current:**
```javascript
// Query Pinecone
const results = await index.query({...});

// Then filter in JavaScript
let filtered = results.matches.filter((m) => {
  m.metadata.type === "poster" &&
  m.metadata.school === school
});
```

**Optimization:**
- Use Pinecone metadata filters in the query
- Reduces results returned (faster, cheaper)
- **Implementation:**
```javascript
const results = await index.query({
  vector: queryEmbedding,
  topK: 20,
  filter: {
    type: "poster",
    school_normalized: schoolNormalized,
    date_normalized: { $gte: todayISO } // Filter past events
  }
});
```

---

### 5. **Sequential Filtering - Could Be Combined**
**Current:**
- Filter by school
- Filter by date
- Filter by time
- Filter past events
- Sort and slice

**Optimization:**
- Combine filters into single pass
- Use Pinecone metadata filters where possible
- Only do JavaScript filtering for complex logic

---

## 💰 Cost Analysis

### Current Search Costs (per search):
- Intent Detection: $0.00015 (GPT-4o-mini)
- Date Extraction: $0.00015 (if needed, ~30% of searches)
- Query Embedding: $0.00015 (text-embedding-3-small)
- **Total: ~$0.00030-0.00045 per search**

### Optimized Search Costs:
- Intent Detection: $0.00003 (only 20% use LLM)
- Date Extraction: $0.000045 (only 30% use LLM, 70% deterministic)
- Query Embedding: $0.00015 (still needed)
- **Total: ~$0.00022 per search**

**Savings: ~35% reduction per search**

---

## 🚀 Priority Optimizations

### Priority 1: Quick Intent Detection (HIGH IMPACT, LOW EFFORT)
- **Effort:** 30 minutes
- **Impact:** Eliminates 80% of intent detection LLM calls
- **Savings:** ~$0.00012 per search

### Priority 2: Enhanced Date Parsing (MEDIUM IMPACT, MEDIUM EFFORT)
- **Effort:** 1-2 hours
- **Impact:** Eliminates 70% of date extraction LLM calls
- **Savings:** ~$0.00010 per search

### Priority 3: Pinecone Metadata Filters (MEDIUM IMPACT, LOW EFFORT)
- **Effort:** 30 minutes
- **Impact:** Faster queries, reduced data transfer
- **Savings:** Minimal cost, but better performance

### Priority 4: Query Expansion Testing (LOW PRIORITY)
- **Effort:** Testing + implementation
- **Impact:** Unknown - needs A/B testing
- **Savings:** Potentially $0.00005 per search

---

## 📊 Estimated Total Savings

**Current:** ~$0.00035 per search
**Optimized:** ~$0.00022 per search
**Savings:** ~$0.00013 per search (37% reduction)

**At scale:**
- 1,000 searches/day = $0.13/day savings = ~$4/month
- 10,000 searches/day = $1.30/day savings = ~$39/month

---

## ✅ What's Already Efficient

1. **Pinecone Vector Search** - Using vector DB correctly ✅
2. **Embedding Model** - Using text-embedding-3-small (cheapest) ✅
3. **Deterministic Date Logic** - Already handles "tonight", "tomorrow" ✅
4. **Post-query Filtering** - Necessary for complex logic ✅

---

## 🎯 Recommended Implementation Order

1. **Quick Intent Detection** (30 min) - Biggest bang for buck
2. **Pinecone Metadata Filters** (30 min) - Easy win, better performance
3. **Enhanced Date Parsing** (1-2 hours) - Good savings
4. **Query Expansion Testing** (Future) - Needs validation

---

## 📝 Implementation Notes

### Quick Intent Detection:
- Keep LLM as fallback for ambiguous cases
- Use keyword matching for obvious intents
- Cache common patterns

### Enhanced Date Parsing:
- Add regex patterns for common formats
- Keep LLM for truly ambiguous dates
- Test edge cases thoroughly

### Pinecone Metadata Filters:
- Use `filter` parameter in query
- Filter by school, date, type at query time
- Only do JavaScript filtering for complex logic

---

## 🔄 Other Efficiency Opportunities

### 1. **Caching Common Queries**
- Cache embeddings for common queries like "free food", "poker", "tonight"
- TTL: 1 hour (date-sensitive queries change)
- **Savings:** Eliminates embedding calls for repeated queries

### 2. **Batch Processing for Daily Digest**
- Process multiple users in parallel
- Use Promise.all for concurrent Pinecone queries
- **Impact:** Faster daily digest execution

### 3. **Embedding Caching**
- Cache user embeddings (already done in Firestore) ✅
- Could cache common query embeddings
- **Savings:** Minimal (queries vary)

---

## 📈 Summary

**Current Search Efficiency:** 6/10
- Using vector search correctly ✅
- But making unnecessary LLM calls ⚠️

**After Optimizations:** 9/10
- Quick intent detection
- Enhanced date parsing
- Better Pinecone filtering
- ~37% cost reduction

**Biggest Wins:**
1. Quick intent detection (80% reduction in LLM calls)
2. Enhanced date parsing (70% reduction in LLM calls)
3. Pinecone metadata filters (better performance)

