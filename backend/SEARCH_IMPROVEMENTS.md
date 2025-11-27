# Search Algorithm Improvements

## Current Gaps Identified

### 1. Single-Word Activity Queries
**Problem**: Queries like "basketball", "yoga", "poker" may have low semantic similarity scores even when events exist.

**Solution**: 
- Add stronger title matching boost for single-word queries
- Implement fuzzy matching for activity keywords in titles
- Lower quality threshold for single-word activity queries

### 2. Food-Related Queries
**Problem**: "free food" might not match "Free Pizza Friday" if semantic similarity is low.

**Solution**:
- Expand food synonyms more aggressively
- Add explicit food keyword matching
- Better cost filtering for free food queries

### 3. Location Extraction
**Problem**: Queries like "events at student union" don't filter by location.

**Solution**:
- Add location extraction function
- Filter by location when specified
- Match location names with building names

### 4. Implicit Free Events
**Problem**: Events with no cost specified might not be recognized as "free".

**Solution**:
- Treat empty cost as potentially free
- Add logic to infer free events from context

### 5. General/Broad Queries
**Problem**: "what's happening" might not return diverse enough results.

**Solution**:
- For general queries, ensure diversity in results
- Show mix of different event types
- Better handling of vague queries

### 6. Synonym Expansion
**Problem**: Current synonyms are limited.

**Solution**:
- Expand synonym dictionary
- Add more food-related synonyms
- Add more activity-related synonyms
- Add location synonyms

## Recommended Improvements

### Priority 1: Single-Word Query Handling
- Lower quality threshold to 0.35 for single-word queries
- Add explicit keyword matching in title/tags
- Boost events where query word appears in title

### Priority 2: Enhanced Synonym Expansion
- Add comprehensive food synonyms
- Add comprehensive activity synonyms
- Add location synonyms

### Priority 3: Location Extraction
- Implement `extractLocation()` function
- Filter by location when specified in query
- Match common location names

### Priority 4: Better Free Event Detection
- Treat empty cost as free for "free" queries
- Better cost parsing and matching

### Priority 5: Query Type Detection
- Detect if query is specific (activity/date) vs general
- Apply different ranking strategies accordingly

