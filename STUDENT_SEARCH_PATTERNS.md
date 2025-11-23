# Student Search Patterns Analysis

## ✅ Currently Handled

### Time-Based Queries
- ✅ "tonight", "tomorrow", "today"
- ✅ "this weekend", "next week", "this week", "soon"
- ✅ Specific dates: "Nov 22", "11/25", "Friday"
- ✅ Time ranges: "after 5pm", "before 10am"

### Cost-Based Queries
- ✅ "free", "free food", "free events"
- ✅ "cheap", "affordable"

### General Discovery
- ✅ "what's happening", "what to do", "events"
- ✅ Interest-based: "poker", "music", "sports"

---

## ⚠️ MISSING: High-Priority Patterns

### 1. Location-Based Queries (HIGH PRIORITY)
**Examples:**
- "events in [building name]" (e.g., "events in Carmichael", "events at the Union")
- "events near me"
- "events in my dorm" (if user has dorm in profile)
- "events at [location]" (e.g., "events at the Pit", "events at Davis Library")

**Why Important:**
- Students often want events close to them
- Dorm-specific events are highly relevant
- Location is a key filter for busy students

**Implementation:**
- Extract building/location from query
- Match against `location_building` metadata
- Boost events in user's dorm if available
- Use UNC_BUILDINGS list for normalization

---

### 2. Activity Type Queries (HIGH PRIORITY)
**Examples:**
- "study groups"
- "networking events"
- "career fairs"
- "job opportunities"
- "internships"
- "research opportunities"
- "workshops"
- "lectures"
- "seminars"
- "tutoring"
- "clubs"
- "organizations"

**Why Important:**
- Very common student queries
- Academic and career-focused searches
- Should match tags and categories well

**Current Status:**
- Should work via semantic matching, but could be enhanced
- Consider adding explicit activity type extraction

---

### 3. Food-Specific Queries (MEDIUM PRIORITY)
**Examples:**
- "pizza" (beyond just "free food")
- "dinner events"
- "lunch events"
- "food trucks"
- "catered events"

**Why Important:**
- Food is a major draw for students
- More specific than just "free food"

**Implementation:**
- Enhance query expansion to emphasize food-related terms
- Could add food-specific tag matching

---

### 4. Social Event Queries (MEDIUM PRIORITY)
**Examples:**
- "parties"
- "social events"
- "meet people"
- "make friends"
- "hang out"
- "fun events"

**Why Important:**
- Social connection is important for students
- Common search intent

**Current Status:**
- Should work via semantic matching
- Could add explicit social event detection

---

### 5. Time-Specific Queries (MEDIUM PRIORITY)
**Examples:**
- "right now" / "happening now"
- "later today"
- "after [time]" (partially handled)
- "before [time]" (partially handled)
- "morning events"
- "afternoon events"
- "evening events"
- "late night"

**Why Important:**
- Students want immediate options
- Time of day is a key filter

**Current Status:**
- "after" and "before" are handled
- "right now" / "later today" not specifically handled
- Time of day ranges not handled

---

### 6. Audience-Specific Queries (LOW PRIORITY)
**Examples:**
- "events for freshmen"
- "graduate student events"
- "events for [major]"
- "events for [year]"

**Why Important:**
- Some events are audience-specific
- Students want relevant events

**Current Status:**
- Audience is extracted from posters
- Not explicitly filtered in search
- Could match against user profile (year, major if available)

---

### 7. Event Type Queries (LOW PRIORITY)
**Examples:**
- "concerts"
- "games" / "sports games"
- "tournaments"
- "competitions"
- "performances"
- "shows"

**Why Important:**
- Specific event types students search for
- Should match tags and categories

**Current Status:**
- Should work via semantic matching
- Could be enhanced with explicit type detection

---

### 8. Combination Queries (PARTIALLY HANDLED)
**Examples:**
- ✅ "free food this weekend" (handled)
- ✅ "poker tonight" (handled)
- ⚠️ "study groups this week" (should work)
- ⚠️ "networking events next week" (should work)
- ⚠️ "free food in my dorm" (location + cost, not handled)
- ⚠️ "events after 5pm this weekend" (time + range, partially handled)

**Why Important:**
- Students often combine multiple filters
- Need to handle multiple intents simultaneously

---

## 🎯 Recommended Enhancements

### Priority 1: Location-Based Search
**Impact:** HIGH - Very common student need
**Effort:** MEDIUM - Need to extract and match locations

**Implementation:**
```javascript
function extractLocationIntent(query, userDorm) {
  const lower = query.toLowerCase();
  const UNC_BUILDINGS = [...]; // From server.js
  
  // Check for building names
  for (const building of UNC_BUILDINGS) {
    if (lower.includes(building.toLowerCase())) {
      return { type: "building", value: building };
    }
  }
  
  // Check for "near me" or "in my dorm"
  if (lower.includes("near me") || lower.includes("close to me")) {
    return { type: "near_me", value: null };
  }
  
  if (lower.includes("my dorm") && userDorm) {
    return { type: "dorm", value: userDorm };
  }
  
  // Check for common locations
  const commonLocations = ["union", "pit", "library", "dining hall", "gym"];
  for (const loc of commonLocations) {
    if (lower.includes(loc)) {
      return { type: "location", value: loc };
    }
  }
  
  return null;
}
```

---

### Priority 2: Activity Type Detection
**Impact:** HIGH - Very common queries
**Effort:** LOW - Enhance query expansion

**Implementation:**
- Add activity type keywords to query expansion
- Emphasize matching tags for these activities
- Could add explicit activity type extraction

---

### Priority 3: Time-Specific Enhancements
**Impact:** MEDIUM - Useful for immediate needs
**Effort:** LOW - Add a few patterns

**Implementation:**
```javascript
// Add to extractExactDate or new function
if (lower.includes("right now") || lower.includes("happening now")) {
  return { type: "now", value: today };
}

if (lower.includes("later today")) {
  return { type: "today_after_now", value: today };
}

// Time of day ranges
if (lower.includes("morning")) {
  return { timeRange: { start: "06:00", end: "12:00" } };
}
if (lower.includes("afternoon")) {
  return { timeRange: { start: "12:00", end: "17:00" } };
}
if (lower.includes("evening") || lower.includes("night")) {
  return { timeRange: { start: "17:00", end: "23:59" } };
}
```

---

### Priority 4: Enhanced Query Expansion
**Impact:** MEDIUM - Better semantic matching
**Effort:** LOW - Update prompt

**Current:**
```
Match using title, tags, description, date, time, location, cost, and categories.
```

**Enhanced:**
```
Match using title, tags, description, date, time, location, cost, and categories.
If the query mentions specific activities like "study groups", "networking", "career fairs", 
"workshops", "tutoring", "clubs", prioritize events with matching tags or descriptions.
If the query mentions food like "pizza", "dinner", "lunch", prioritize events with food.
If the query mentions social activities like "parties", "meet people", prioritize social events.
```

---

## 📊 Query Frequency Estimates

Based on typical student behavior:

1. **Time-based:** 40% of queries
   - "tonight", "this weekend", "next week" ✅
   - "right now", "later today" ⚠️

2. **Activity-based:** 30% of queries
   - "study groups", "networking", "career fairs" ⚠️
   - "poker", "music", "sports" ✅

3. **Cost-based:** 15% of queries
   - "free food", "free events" ✅

4. **Location-based:** 10% of queries
   - "events in [building]", "near me" ⚠️

5. **General discovery:** 5% of queries
   - "what's happening", "events" ✅

---

## 🚀 Quick Wins

### 1. Add "right now" / "later today" (5 min)
- Simple date extraction enhancement
- High impact for immediate queries

### 2. Enhance query expansion for activities (10 min)
- Update prompt to emphasize activity types
- Better matching for study groups, networking, etc.

### 3. Add location extraction (30 min)
- Extract building names from query
- Match against location_building metadata
- Boost results in user's dorm

### 4. Add time of day ranges (15 min)
- "morning", "afternoon", "evening"
- Filter by time_normalized_start

---

## 💡 Future Considerations

1. **User Context Integration:**
   - Use user's dorm to boost nearby events
   - Use user's year to filter audience-specific events
   - Use user's interests to improve ranking

2. **Query History:**
   - Learn from past searches
   - Suggest similar events

3. **Natural Language Variations:**
   - "what's going on" = "what's happening"
   - "anything fun" = "fun events"
   - "where can I" = location-based search

4. **Multi-Intent Handling:**
   - Better combination of filters
   - "free food in my dorm this weekend"

---

## ✅ Summary

**High Priority Additions:**
1. Location-based search (buildings, dorms, "near me")
2. Activity type emphasis (study groups, networking, etc.)
3. "Right now" / "later today" time handling

**Medium Priority:**
4. Food-specific queries beyond "free"
5. Social event detection
6. Time of day ranges

**Low Priority:**
7. Audience-specific filtering
8. Event type detection
9. User context integration

