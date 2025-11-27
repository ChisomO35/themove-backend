// searchCore.js
const dotenv = require("dotenv");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

dotenv.config();

// --- Helpers for correct local-timezone date handling ---
function getLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Convert local date to ISO string (YYYY-MM-DD) without timezone conversion
function localDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDateFromISO(iso) {
  const [yyyy, mm, dd] = iso.split("-");
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

// --- Init clients ---
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";
const BASE_URL = process.env.PUBLIC_APP_URL || "https://api.usethemove.com";

// ---------- embeddings ----------
async function createEmbedding(text) {
  try {
    const openai = getOpenAI();
    if (!openai) {
      throw new Error("OpenAI client not initialized - check OPENAI_API_KEY");
    }
    const embed = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: text,
    });
    if (!embed || !embed.data || !embed.data[0] || !embed.data[0].embedding) {
      throw new Error("Invalid embedding response from OpenAI");
    }
    return embed.data[0].embedding;
  } catch (err) {
    console.error("❌ createEmbedding error:", err);
    throw err;
  }
}

// ---------- intent classifier (full OpenAI-based) ----------
async function detectIntent(message) {
  const systemPrompt = `
You are an intent classifier for a college event discovery assistant called TheMove.
Given a text message, categorize it into ONE of these categories only:
- "search": The user expresses interest in doing something on campus or asks about events, clubs, or opportunities.
- "info": Asking what TheMove is or how it works.
- "signup": Asking how to sign up.
- "random": Jokes, greetings, gibberish, or anything that doesn't fit the above categories.

If the message implies an activity or interest, classify as "search".
Respond ONLY with: search, info, signup, or random.
  `.trim();

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ],
    temperature: 0.3, // Lower temperature for more consistent classification
  });

  const result = res.choices[0].message.content.trim().toLowerCase();
  
  // Validate result (fallback to search if invalid)
  const validIntents = ["search", "info", "signup", "random"];
  return validIntents.includes(result) ? result : "search";
}

// ---------- TIME extraction (enhanced with time of day ranges) ----------
function extractExactTime(query) {
  const q = query.toLowerCase();

  // Check for time of day ranges first
  if (q.includes("morning")) {
    return { operator: "range", start: "06:00", end: "12:00" };
  }
  if (q.includes("afternoon")) {
    return { operator: "range", start: "12:00", end: "17:00" };
  }
  if (q.includes("evening") || q.includes("night") || q.includes("late night")) {
    return { operator: "range", start: "17:00", end: "23:59" };
  }

  // Check for "right now" or "happening now"
  if (q.includes("right now") || q.includes("happening now")) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    // Return events happening now or very soon (within next hour)
    return { operator: "range", start: normalized, end: `${String((hour + 1) % 24).padStart(2, "0")}:${String(minute).padStart(2, "0")}` };
  }

  // Check for "later today"
  if (q.includes("later today")) {
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    // Return events later today (from now until end of day)
    return { operator: "range", start: normalized, end: "23:59" };
  }

  // Explicit time extraction (existing logic)
  const explicitTime = q.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!explicitTime) return null;

  let hour = parseInt(explicitTime[1], 10);
  let minute = explicitTime[2] ? parseInt(explicitTime[2], 10) : 0;
  const suffix = explicitTime[3];

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  if (q.includes("after")) return { operator: ">=", value: normalized };
  if (q.includes("before")) return { operator: "<=", value: normalized };

  return { operator: "=", value: normalized };
}

// ==========================================================
// 🚀 ENHANCED DETERMINISTIC DATE EXTRACTOR (MINIMAL LLM USAGE)
// ==========================================================
async function extractExactDate(query) {
  const today = getLocalDate();
  const lower = query.toLowerCase();
  const localISO = localDateToISO(today);
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1; // 1-12

  // ---------------------------
  // 1. Special keywords and time ranges
  // ---------------------------
  if (lower.includes("tonight")) return today;
  if (lower.includes("tomorrow")) return addDays(today, 1);
  if (lower.includes("today")) return today;
  
  // Note: "this weekend", "next week", "this week", "soon" are handled by extractTimeRange()
  // Don't return single dates for these - let extractTimeRange handle them as ranges

  // in X days
  const inDays = lower.match(/in\s+(\d+)\s+days?/);
  if (inDays) return addDays(today, parseInt(inDays[1], 10));

  // ---------------------------
  // 2. Deterministic weekday logic
  // ---------------------------
  const weekdays = [
    "sunday","monday","tuesday","wednesday","thursday","friday","saturday"
  ];

  const foundIdx = weekdays.findIndex((d) => lower.includes(d));

  if (foundIdx !== -1) {
    const dow = today.getDay();
    let diff = (foundIdx - dow + 7) % 7;
    if (diff === 0) diff = 7;        // always NEXT occurrence
    return addDays(today, diff);
  }

  // ---------------------------
  // 3. Enhanced regex patterns for common date formats
  // ---------------------------
  const monthNames = ["january", "february", "march", "april", "may", "june",
                      "july", "august", "september", "october", "november", "december"];
  const monthAbbrevs = ["jan", "feb", "mar", "apr", "may", "jun",
                        "jul", "aug", "sep", "oct", "nov", "dec"];

  // Pattern 1: MM/DD or M/D (e.g., "11/25", "1/5")
  const slashDate = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (slashDate) {
    let month = parseInt(slashDate[1], 10);
    let day = parseInt(slashDate[2], 10);
    let year = slashDate[3] ? parseInt(slashDate[3], 10) : currentYear;
    
    // Handle 2-digit years
    if (year < 100) {
      year = year + 2000; // Assume 2000s
    }
    
    // Validate month and day
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      // If date is in the past and no year specified, assume next year
      if (!slashDate[3] && date < today) {
        date.setFullYear(currentYear + 1);
      }
      return date;
    }
  }

  // Pattern 2: Month name + day (e.g., "nov 22", "november 22", "november 22nd")
  for (let i = 0; i < monthNames.length; i++) {
    const monthPattern = new RegExp(`(${monthNames[i]}|${monthAbbrevs[i]})\\s+(\\d{1,2})(?:st|nd|rd|th)?`, "i");
    const match = lower.match(monthPattern);
    if (match) {
      const month = i + 1; // 1-12
      const day = parseInt(match[2], 10);
      if (day >= 1 && day <= 31) {
        const date = new Date(currentYear, month - 1, day);
        // If date is in the past, assume next year
        if (date < today) {
          date.setFullYear(currentYear + 1);
        }
        return date;
      }
    }
  }

  // Pattern 3: MM-DD or M-D (e.g., "11-25", "1-5")
  const dashDate = lower.match(/(\d{1,2})-(\d{1,2})(?:-(\d{2,4}))?/);
  if (dashDate) {
    let month = parseInt(dashDate[1], 10);
    let day = parseInt(dashDate[2], 10);
    let year = dashDate[3] ? parseInt(dashDate[3], 10) : currentYear;
    
    if (year < 100) {
      year = year + 2000;
    }
    
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const date = new Date(year, month - 1, day);
      if (!dashDate[3] && date < today) {
        date.setFullYear(currentYear + 1);
      }
      return date;
    }
  }

  // ---------------------------
  // 4. LLM fallback ONLY for truly ambiguous/complex dates
  // ---------------------------
  try {
    const systemPrompt = `
Today is ${localISO}.
If the user explicitly provides a calendar date that you can parse, convert it into an ISO date (YYYY-MM-DD).

If NO clear calendar date is present, respond ONLY with "none".
Never guess weekdays. Never infer context. Only parse explicit calendar dates.
    `.trim();

    const openai = getOpenAI();
    if (!openai) {
      console.warn("⚠️ OpenAI client not available for date extraction");
      return null;
    }

    // Add timeout for LLM call (5 seconds)
    const llmPromise = openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: query }
      ]
    });

    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("LLM date extraction timeout")), 5000)
    );

    const res = await Promise.race([llmPromise, timeoutPromise]);

    if (!res || !res.choices || !res.choices[0] || !res.choices[0].message) {
      console.warn("⚠️ Invalid LLM response for date extraction");
      return null;
    }

    const out = res.choices[0].message.content.trim();

    if (out === "none") return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) {
      return getLocalDateFromISO(out);
    }

    return null;
  } catch (err) {
    console.error("❌ Error in LLM date extraction:", err.message);
    // Return null on error - search will continue without date filter
    return null;
  }
}

// ==========================================================
// Extract cost intent from query
// ==========================================================
function extractCostIntent(query) {
  const lower = query.toLowerCase();
  if (lower.includes("free") || lower.includes("no cost") || 
      lower.includes("complimentary") || lower.includes("no charge")) {
    return "free";
  }
  if (lower.includes("cheap") || lower.includes("affordable") || 
      lower.includes("low cost") || lower.includes("inexpensive")) {
    return "cheap";
  }
  return null;
}

// ==========================================================
// Extract activity type from query
// ==========================================================
function extractActivityType(query) {
  const lower = query.toLowerCase();
  
  // Academic/Study activities
  if (lower.includes("study group") || lower.includes("study groups")) {
    return "study_groups";
  }
  if (lower.includes("tutoring") || lower.includes("tutor")) {
    return "tutoring";
  }
  if (lower.includes("workshop") || lower.includes("workshops")) {
    return "workshops";
  }
  if (lower.includes("lecture") || lower.includes("lectures")) {
    return "lectures";
  }
  if (lower.includes("seminar") || lower.includes("seminars")) {
    return "seminars";
  }
  
  // Career/Professional activities
  if (lower.includes("career fair") || lower.includes("career fairs")) {
    return "career_fairs";
  }
  if (lower.includes("networking") || lower.includes("network")) {
    return "networking";
  }
  if (lower.includes("job") && (lower.includes("opportunity") || lower.includes("opportunities"))) {
    return "job_opportunities";
  }
  if (lower.includes("internship") || lower.includes("internships")) {
    return "internships";
  }
  if (lower.includes("research") && (lower.includes("opportunity") || lower.includes("opportunities"))) {
    return "research_opportunities";
  }
  
  // Organizations/Clubs
  if (lower.includes("club") || lower.includes("clubs")) {
    return "clubs";
  }
  if (lower.includes("organization") || lower.includes("organizations") || lower.includes("org")) {
    return "organizations";
  }
  
  // Social activities
  if (lower.includes("party") || lower.includes("parties")) {
    return "parties";
  }
  if (lower.includes("social event") || lower.includes("social events")) {
    return "social_events";
  }
  if (lower.includes("meet people") || lower.includes("make friends") || lower.includes("hang out")) {
    return "social";
  }
  
  // Food activities
  if (lower.includes("pizza")) {
    return "pizza";
  }
  if (lower.includes("dinner") && !lower.includes("free")) {
    return "dinner";
  }
  if (lower.includes("lunch") && !lower.includes("free")) {
    return "lunch";
  }
  if (lower.includes("food truck") || lower.includes("food trucks")) {
    return "food_trucks";
  }
  if (lower.includes("catered")) {
    return "catered";
  }
  
  // Event types
  if (lower.includes("concert") || lower.includes("concerts")) {
    return "concerts";
  }
  if (lower.includes("game") || lower.includes("games")) {
    return "games";
  }
  if (lower.includes("tournament") || lower.includes("tournaments")) {
    return "tournaments";
  }
  if (lower.includes("competition") || lower.includes("competitions")) {
    return "competitions";
  }
  if (lower.includes("performance") || lower.includes("performances") || lower.includes("show") || lower.includes("shows")) {
    return "performances";
  }
  
  return null;
}

// ==========================================================
// Extract time range from query
// ==========================================================
function extractTimeRange(query) {
  const lower = query.toLowerCase();
  const today = getLocalDate();
  
  if (lower.includes("this weekend") || lower.includes("weekend")) {
    const dow = today.getDay();
    const daysUntilSaturday = (6 - dow + 7) % 7;
    const startDate = daysUntilSaturday === 0 ? addDays(today, 7) : addDays(today, daysUntilSaturday);
    const endDate = addDays(startDate, 1); // Saturday to Sunday
    return { start: startDate, end: endDate };
  }
  
  if (lower.includes("next week")) {
    return { start: addDays(today, 7), end: addDays(today, 13) };
  }
  
  if (lower.includes("this week")) {
    const dow = today.getDay();
    const daysUntilSunday = (7 - dow) % 7;
    return { start: today, end: addDays(today, daysUntilSunday || 7) };
  }
  
  if (lower.includes("soon")) {
    return { start: today, end: addDays(today, 3) };
  }

  return null;
}

// ==========================================================
// Core search for SMS
// ==========================================================
async function searchPostersForSMS(query, school) {
  // ✅ VERSION CHECK: If you see this log, the new emoji-free code is running
  console.log(`🚀 [searchPostersForSMS] CODE VERSION: v2.0 - NO EMOJIS (GSM-7 optimized) - Deployed: ${new Date().toISOString()}`);
  console.log(`🔍 [searchPostersForSMS] Starting search for: "${query}" in ${school}`);
  try {
    const today = getLocalDate();

  const currentDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

    console.log(`🔍 [searchPostersForSMS] Extracting query parameters...`);
    let targetDate, targetTime, costIntent, timeRange, activityType;
    try {
      // Add timeout for extractExactDate (it can call LLM)
      const extractStartTime = Date.now();
      targetDate = await Promise.race([
        extractExactDate(query),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("extractExactDate timeout")), 8000)
        )
      ]);
      console.log(`✅ [searchPostersForSMS] extractExactDate completed in ${Date.now() - extractStartTime}ms`);
      
      targetTime = extractExactTime(query);
      costIntent = extractCostIntent(query);
      timeRange = extractTimeRange(query);
      activityType = extractActivityType(query);
      console.log(`✅ [searchPostersForSMS] All parameters extracted`);
    } catch (extractErr) {
      console.error("❌ [searchPostersForSMS] Error extracting query parameters:", extractErr.message);
      // Continue with null values - search will still work
      targetDate = null;
      targetTime = null;
      costIntent = null;
      timeRange = null;
      activityType = null;
    }

  // ✅ Hyper-accurate query expansion with synonyms and context
  // Build synonym-enhanced query
  const queryLower = query.toLowerCase();
  let synonymExpanded = query;
  
  // Add synonyms for common terms - EXPANDED for better matching
  const synonyms = {
    "free": ["free", "no cost", "complimentary", "no charge", "gratis", "zero cost"],
    "pizza": ["pizza", "food", "free food", "meal", "snacks", "refreshments", "catered"],
    "food": ["food", "pizza", "tacos", "brunch", "lunch", "dinner", "snacks", "refreshments", "meal", "catered", "festival"],
    "study": ["study", "studying", "academic", "homework", "learning", "review", "exam prep"],
    "networking": ["networking", "professional", "career", "connections", "meet people", "industry", "employers"],
    "concert": ["concert", "music", "performance", "show", "live music", "musical", "gig"],
    "music": ["music", "concert", "performance", "show", "live music", "musical", "gig", "open mic", "jam session"],
    "poker": ["poker", "card games", "games", "gaming", "tournament", "cards", "casino night"],
    "yoga": ["yoga", "fitness", "wellness", "exercise", "mindfulness", "meditation", "stretching"],
    "basketball": ["basketball", "sports", "athletics", "game", "tournament", "hoops", "b-ball"],
    "sports": ["sports", "athletics", "fitness", "competition", "tournament", "game", "games"],
    "volunteer": ["volunteer", "volunteering", "community service", "service", "help", "outreach", "charity"],
    "career": ["career", "job", "employment", "professional", "work", "internship", "hiring"],
    "workshop": ["workshop", "class", "training", "tutorial", "session", "seminar"],
    "cultural": ["cultural", "diversity", "international", "heritage", "tradition"],
    "social": ["social", "meetup", "gathering", "hangout", "community", "friends"],
  };
  
  // Expand query with synonyms
  Object.keys(synonyms).forEach(key => {
    if (queryLower.includes(key)) {
      const relatedTerms = synonyms[key].filter(s => s !== key);
      if (relatedTerms.length > 0) {
        synonymExpanded += ` ${relatedTerms.join(" ")}`;
      }
    }
  });

  let expandedQuery = `
    Today's date is ${currentDate}.
    A ${school} student is searching for: "${query}".
    Search terms: "${synonymExpanded}".
    Find campus events matching these keywords and concepts.
  `.replace(/\s+/g, " ").trim();

  // Add context based on query type
  if (costIntent === "free") {
    expandedQuery += ` The student specifically wants FREE events with no cost, no admission fee, or complimentary access. Prioritize events marked as free.`;
  }
  
  // Add activity type context
  if (activityType) {
    const activityContext = {
      study_groups: "The student wants study groups or study sessions. Prioritize events about studying, group study, or academic collaboration.",
      tutoring: "The student wants tutoring or academic help. Prioritize events about tutoring, academic support, or learning assistance.",
      workshops: "The student wants workshops. Prioritize events that are workshops, hands-on learning, or skill-building sessions.",
      lectures: "The student wants lectures or talks. Prioritize events that are lectures, talks, or presentations.",
      seminars: "The student wants seminars. Prioritize events that are seminars or academic discussions.",
      career_fairs: "The student wants career fairs. Prioritize events about careers, job fairs, or employer networking.",
      networking: "The student wants networking events. Prioritize events about networking, professional connections, or meeting professionals.",
      job_opportunities: "The student wants job opportunities. Prioritize events about jobs, employment, or hiring.",
      internships: "The student wants internships. Prioritize events about internships or internship opportunities.",
      research_opportunities: "The student wants research opportunities. Prioritize events about research, labs, or academic research positions.",
      clubs: "The student wants clubs or club events. Prioritize events about student clubs or organizations.",
      organizations: "The student wants organizations or org events. Prioritize events about student organizations.",
      parties: "The student wants parties or social gatherings. Prioritize events that are parties or social events.",
      social_events: "The student wants social events. Prioritize events that are social, fun, or community-building.",
      social: "The student wants to meet people or socialize. Prioritize events that are social, community-oriented, or for making friends.",
      pizza: "The student wants pizza events. Prioritize events that mention pizza or have pizza.",
      dinner: "The student wants dinner events. Prioritize events that mention dinner or evening meals.",
      lunch: "The student wants lunch events. Prioritize events that mention lunch or midday meals.",
      food_trucks: "The student wants food truck events. Prioritize events with food trucks.",
      catered: "The student wants catered events. Prioritize events that mention catering or catered food.",
      concerts: "The student wants concerts. Prioritize events that are concerts or live music performances.",
      games: "The student wants games or game events. Prioritize events about games, gaming, or game tournaments.",
      tournaments: "The student wants tournaments. Prioritize events that are tournaments or competitions.",
      competitions: "The student wants competitions. Prioritize events that are competitions or contests.",
      performances: "The student wants performances or shows. Prioritize events that are performances, shows, or entertainment.",
    };
    
    if (activityContext[activityType]) {
      expandedQuery += ` ${activityContext[activityType]}`;
    }
  }
  
  if (timeRange) {
    expandedQuery += ` The student wants events happening between ${timeRange.start.toDateString()} and ${timeRange.end.toDateString()}.`;
  } else if (targetDate) {
    expandedQuery += ` Only include events happening on ${targetDate.toDateString()}.`;
  } else {
    expandedQuery += ` Match upcoming events happening soon.`;
  }
  
  // Add matching guidance
  expandedQuery += ` Match using title, tags, description, date, time, location, cost, and categories. Prioritize events that match the specific activities, interests, and requirements mentioned in the query.`;

  console.log(`🔍 Starting search for: "${query}"`);

  const queryEmbedding = await createEmbedding(expandedQuery);
  console.log(`✅ Embedding created, length: ${queryEmbedding.length}`);

  // ✅ Use Pinecone metadata filters for better performance
  const schoolNormalized = school.toLowerCase().replace(/[\s-]+/g, "");
  const todayISO = localDateToISO(today);
  
  // Build filter object
  const filter = {
    type: "poster",
    school_normalized: schoolNormalized,
  };

  // Add date filter if we have a target date
  if (targetDate) {
    // Use localDateToISO to avoid timezone conversion issues
    const targetISO = localDateToISO(targetDate);
    filter.date_normalized = targetISO;
    console.log(`📅 Filtering by date: ${targetISO} (today is ${localDateToISO(today)})`);
  } else {
    // Filter out past events at query time (but allow events without dates)
    // Note: Pinecone doesn't support OR filters easily, so we'll filter past events in JS
    // But we can still filter by type and school at query time
  }

  console.log(`🔎 Querying Pinecone with filter:`, filter);
  let results;
  try {
    results = await index.namespace(PINECONE_NAMESPACE).query({
      vector: queryEmbedding,
      topK: 20,
      includeMetadata: true,
      filter: filter,
    });
    console.log(`📊 Pinecone returned ${results.matches?.length || 0} matches`);
  } catch (pineconeErr) {
    console.error("❌ Pinecone query error:", pineconeErr);
    throw new Error(`Pinecone query failed: ${pineconeErr.message}`);
  }
  
  if (!results || !results.matches) {
    console.error("❌ Invalid Pinecone response:", results);
    throw new Error("Invalid response from Pinecone");
  }

  // ✅ Post-query filtering for complex logic (time, past events, edge cases)
  let filtered = results.matches.filter((m) => {
    // Double-check type and school (safety check)
    if (m.metadata.type !== "poster") return false;
    
    const matchSchool = m.metadata.school_normalized || "";
    if (matchSchool !== schoolNormalized) return false;
    
    return true;
  });

  // --- date filter (if target date or time range specified) ---
  if (timeRange) {
    // Filter by date range
    filtered = filtered.filter((m) => {
      const eventDate = m.metadata.date_normalized;
      if (!eventDate) return false; // Exclude events without dates when filtering by range
      
      const d = getLocalDateFromISO(eventDate);
      if (!d) return false;
      
      return d >= timeRange.start && d <= timeRange.end;
    });
  } else if (targetDate) {
    const targetISO = localDateToISO(targetDate);
    console.log(`🔍 [Date Filter] Filtering ${filtered.length} results for date: ${targetISO}`);
    filtered = filtered.filter((m) => {
      const eventDate = m.metadata.date_normalized;
      if (!eventDate) {
        console.log(`   ⚠️  Event "${m.metadata.title}" has no date_normalized`);
        return false; // Exclude events without dates when filtering by date
      }
      // Compare ISO strings directly (they're already in YYYY-MM-DD format)
      const matches = eventDate === targetISO;
      if (!matches) {
        console.log(`   ⚠️  Event "${m.metadata.title}" date mismatch: ${eventDate} !== ${targetISO}`);
      } else {
        console.log(`   ✅ Event "${m.metadata.title}" matches date: ${eventDate}`);
      }
      return matches;
    });
    console.log(`✅ [Date Filter] After filtering: ${filtered.length} results remain`);
  }

  // --- cost filter (if "free" mentioned) ---
  if (costIntent === "free") {
    filtered = filtered.filter((m) => {
      const cost = (m.metadata.cost || "").toLowerCase().trim();
      // Match free events: cost is empty (implicitly free), "free", "no cost", "$0", etc.
      // Treat empty cost as potentially free for "free" queries
      return !cost || 
             cost === "" ||
             cost.includes("free") || 
             cost.includes("no cost") || 
             cost.includes("complimentary") ||
             cost.includes("gratis") ||
             cost === "$0" ||
             cost === "0" ||
             cost === "free";
    });
    
    // If no free events found, still return results but note they may not all be free
    if (filtered.length === 0) {
      // Fall back to showing any events, but we'll note in the response
      filtered = results.matches.filter((m) => {
        if (m.metadata.type !== "poster") return false;
        const matchSchool = m.metadata.school_normalized || "";
        if (matchSchool !== schoolNormalized) return false;
        return true;
      });
    }
  }

  // --- time filter (enhanced with time ranges) ---
  if (targetTime) {
    filtered = filtered.filter((m) => {
      const t = m.metadata.time_normalized_start;
      if (!t) return false;

      // Handle time ranges (morning, afternoon, evening, right now, later today)
      if (targetTime.operator === "range") {
        return t >= targetTime.start && t <= targetTime.end;
      }
      
      // Handle exact time
      if (targetTime.operator === "=") return t === targetTime.value;
      
      // Handle after/before
      if (targetTime.operator === ">=") return t >= targetTime.value;
      if (targetTime.operator === "<=") return t <= targetTime.value;
      
      return true;
    });
  }

  // --- remove past events (if no target date specified) ---
  if (!targetDate) {
  filtered = filtered.filter((m) => {
      const eventDate = m.metadata.date_normalized;
      if (!eventDate) return true; // Keep events without dates (organizations)
      
      const d = getLocalDateFromISO(eventDate);
      if (!d) return false;
      
    return d >= today;
    });
  }

  // ✅ For date-specific queries, skip ALL semantic ranking - just show all events on that date
  // For general queries, apply hyper-accurate ranking with multiple signals
  let sorted;
  
  // Check if there's an activity filter (needed for both date and non-date queries)
  // Remove common query words to find actual activity keywords
  const commonWords = new Set(["what", "whats", "happening", "events", "event", "today", "tomorrow", 
    "tonight", "this", "week", "weekend", "related", "to", "about", "for", "on", "at", "the", "a", "an",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did"]);
  const queryWordsForActivity = queryLower.split(/\s+/)
    .filter(w => w.length > 2 && !commonWords.has(w.toLowerCase()));
  
  // Has activity filter if: explicit activity type, cost intent, or meaningful keywords beyond date/time words
  // Also check for "related to X" or "about X" patterns
  const hasRelatedToPattern = /related\s+to\s+\w+|about\s+\w+|for\s+\w+/.test(queryLower);
  const hasActivityFilter = activityType || costIntent || queryWordsForActivity.length > 0 || hasRelatedToPattern;
  
  if (targetDate) {
    // Date-specific query: Check if there's also an activity filter
    
    if (hasActivityFilter) {
      // Date + activity query: Apply semantic ranking but filter by date first
      // Extract activity keywords from query (including "related to X" patterns)
      let activityKeywords = [...queryWordsForActivity];
      const relatedToMatch = queryLower.match(/related\s+to\s+(\w+)/);
      if (relatedToMatch) activityKeywords.push(relatedToMatch[1]);
      const aboutMatch = queryLower.match(/about\s+(\w+)/);
      if (aboutMatch) activityKeywords.push(aboutMatch[1]);
      
      console.log(`📅 [Date + Activity Query] Filtering by date AND applying semantic ranking for: "${activityKeywords.join(', ')}"`);
      const queryWords = activityKeywords;
      
      const enhancedResults = filtered.map((match) => {
        let enhancedScore = match.score;
        let boostReasons = [];
        
        // Apply same ranking logic as general queries
        const titleLower = (match.metadata.title || "").toLowerCase();
        const titleWords = titleLower.split(/\s+/);
        const titleMatchCount = queryWords.filter(qw => 
          titleWords.some(tw => tw.includes(qw) || qw.includes(tw))
        ).length;
        if (titleMatchCount > 0) {
          const titleBoost = Math.min(0.15, titleMatchCount * 0.05);
          enhancedScore = Math.min(1.0, enhancedScore + titleBoost);
          if (titleBoost > 0.05) boostReasons.push("title");
        }
        
        // Tag match boost
        if (match.metadata.tags) {
          const tags = match.metadata.tags.toLowerCase().split(", ").map(t => t.trim());
          const tagMatchCount = queryWords.filter(qw => 
            tags.some(tag => tag.includes(qw) || qw.includes(tag) || tag === qw)
          ).length;
          if (tagMatchCount > 0) {
            const tagBoost = Math.min(0.12, tagMatchCount * 0.04);
            enhancedScore = Math.min(1.0, enhancedScore + tagBoost);
            if (tagBoost > 0.04) boostReasons.push("tag");
          }
          
          if (activityType) {
            const activityLower = activityType.toLowerCase();
            const hasExactMatch = tags.some(tag => {
              return tag === activityLower || 
                     tag.includes(activityLower) || 
                     activityLower.includes(tag);
            });
            if (hasExactMatch) {
              enhancedScore = Math.min(1.0, enhancedScore + 0.1);
              boostReasons.push("activity");
            }
          }
        }
        
        // Category match boost
        if (match.metadata.categories) {
          const categories = match.metadata.categories.toLowerCase().split(", ").map(c => c.trim());
          const categoryMatchCount = queryWords.filter(qw => 
            categories.some(cat => cat.includes(qw) || qw.includes(cat))
          ).length;
          if (categoryMatchCount > 0) {
            const catBoost = Math.min(0.08, categoryMatchCount * 0.03);
            enhancedScore = Math.min(1.0, enhancedScore + catBoost);
            if (catBoost > 0.03) boostReasons.push("category");
          }
        }
        
        // Free event boost
        if (costIntent === "free") {
          const cost = (match.metadata.cost || "").toLowerCase();
          if (cost.includes("free") || cost.includes("no cost") || cost === "" || cost === "$0") {
            enhancedScore = Math.min(1.0, enhancedScore + 0.06);
            boostReasons.push("free");
          }
        }
        
        return {
          ...match,
          enhancedScore: enhancedScore,
          boostReasons: boostReasons
        };
      });
      
      // Filter by quality threshold (lower for date+activity queries)
      const qualityFiltered = enhancedResults.filter(m => m.enhancedScore >= 0.4);
      console.log(`🔍 [Date + Activity] Quality filter: ${enhancedResults.length} before, ${qualityFiltered.length} after`);
      
      // Sort by score, then by time
      sorted = qualityFiltered.sort((a, b) => {
        if (b.enhancedScore !== a.enhancedScore) {
          return b.enhancedScore - a.enhancedScore;
        }
        // If scores are equal, sort by time
        const timeA = a.metadata.time_normalized_start || "99:99";
        const timeB = b.metadata.time_normalized_start || "99:99";
        return timeA.localeCompare(timeB);
      });
    } else {
      // Pure date query: show ALL events on that date, sorted by time (earliest first)
      console.log(`📅 [Date Query] No activity filter - showing ALL events on date`);
      sorted = filtered.map((match) => {
        // Use time for sorting if available, otherwise use title
        const time = match.metadata.time_normalized_start || "99:99"; // Put events without time at end
        return {
          ...match,
          enhancedScore: 1.0, // All events on the requested date are equally relevant
          sortKey: time + (match.metadata.title || "").toLowerCase() // Sort by time, then title
        };
      }).sort((a, b) => {
        // Sort by time (earliest first), then by title
        if (a.sortKey < b.sortKey) return -1;
        if (a.sortKey > b.sortKey) return 1;
        return 0;
      });
    }
  } else {
    // General query: apply semantic ranking
    // Detect if this is a single-word activity query (e.g., "basketball", "yoga", "poker")
    const isSingleWordActivityQuery = !targetTime && !timeRange && 
      queryLower.trim().split(/\s+/).length === 1 && 
      queryLower.length > 3 && // Not "free" or "what"
      !queryLower.includes("free") && // Not "free"
      !queryLower.includes("what"); // Not "what"
    
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    
    const enhancedResults = filtered.map((match) => {
      let enhancedScore = match.score;
      let boostReasons = [];
      
      // 1. Title match boost (strongest signal)
      // For single-word queries, give much stronger boost if word appears in title
      const titleLower = (match.metadata.title || "").toLowerCase();
      const titleWords = titleLower.split(/\s+/);
      
      if (isSingleWordActivityQuery) {
        // For single-word queries, check if query word appears in title (exact or partial)
        const queryWord = queryLower.trim();
        if (titleLower.includes(queryWord)) {
          // Strong boost for single-word title matches
          enhancedScore = Math.min(1.0, enhancedScore + 0.25);
          boostReasons.push("single-word-title-match");
        }
      }
      
      const titleMatchCount = queryWords.filter(tw => 
        queryWords.some(qw => tw.includes(qw) || qw.includes(tw))
      ).length;
      if (titleMatchCount > 0) {
        const titleBoost = Math.min(0.15, titleMatchCount * 0.05);
        enhancedScore = Math.min(1.0, enhancedScore + titleBoost);
        if (titleBoost > 0.05) boostReasons.push("title");
      }
    
    // 2. Tag match boost (very strong)
    if (match.metadata.tags) {
      const tags = match.metadata.tags.toLowerCase().split(", ").map(t => t.trim());
      const tagMatchCount = queryWords.filter(qw => 
        tags.some(tag => tag.includes(qw) || qw.includes(tag) || tag === qw)
      ).length;
      if (tagMatchCount > 0) {
        const tagBoost = Math.min(0.12, tagMatchCount * 0.04);
        enhancedScore = Math.min(1.0, enhancedScore + tagBoost);
        if (tagBoost > 0.04) boostReasons.push("tag");
      }
      
      // Activity type exact match (if specified)
      if (activityType) {
        const activityLower = activityType.toLowerCase();
        const hasExactMatch = tags.some(tag => {
          return tag === activityLower || 
                 tag.includes(activityLower) || 
                 activityLower.includes(tag);
        });
        if (hasExactMatch) {
          enhancedScore = Math.min(1.0, enhancedScore + 0.1);
          boostReasons.push("activity");
        }
      }
    }
    
    // 3. Category match boost
    if (match.metadata.categories) {
      const categories = match.metadata.categories.toLowerCase().split(", ").map(c => c.trim());
      const categoryMatchCount = queryWords.filter(qw => 
        categories.some(cat => cat.includes(qw) || qw.includes(cat))
      ).length;
      if (categoryMatchCount > 0) {
        const catBoost = Math.min(0.08, categoryMatchCount * 0.03);
        enhancedScore = Math.min(1.0, enhancedScore + catBoost);
        if (catBoost > 0.03) boostReasons.push("category");
      }
    }
    
    // 4. Keyword match in description (weaker but still useful)
    // Note: We don't have description in metadata, but title often contains keywords
    
    // 5. Recency boost (events happening soon)
    if (match.metadata.date_normalized) {
      const eventDate = getLocalDateFromISO(match.metadata.date_normalized);
      if (eventDate) {
        const daysUntil = Math.floor((eventDate - today) / (1000 * 60 * 60 * 24));
        if (daysUntil >= 0 && daysUntil <= 7) {
          // Stronger boost for events happening today/tomorrow
          if (daysUntil <= 1) {
            enhancedScore = Math.min(1.0, enhancedScore + 0.08);
            boostReasons.push("immediate");
          } else if (daysUntil <= 3) {
            enhancedScore = Math.min(1.0, enhancedScore + 0.05);
            boostReasons.push("soon");
          } else {
            enhancedScore = Math.min(1.0, enhancedScore + 0.03);
            boostReasons.push("upcoming");
          }
        }
      }
    }
    
    // 6. Free event boost (if query mentions free)
    if (costIntent === "free") {
      const cost = (match.metadata.cost || "").toLowerCase();
      if (cost.includes("free") || cost.includes("no cost") || cost === "" || cost === "$0") {
        enhancedScore = Math.min(1.0, enhancedScore + 0.06);
        boostReasons.push("free");
      }
    }
    
    return {
      ...match,
      enhancedScore: enhancedScore,
      boostReasons: boostReasons
    };
    });
    
    // Filter by minimum quality threshold
    // Lower threshold for single-word activity queries (they may have lower semantic similarity)
    const minThreshold = isSingleWordActivityQuery ? 0.35 : 0.5;
    const qualityFiltered = enhancedResults.filter(m => m.enhancedScore >= minThreshold);
    console.log(`🔍 [Quality Filter] Using threshold: ${minThreshold}${isSingleWordActivityQuery ? ' (single-word query)' : ''}, ${enhancedResults.length} results before, ${qualityFiltered.length} after`);
    
    // Sort by enhanced score
    sorted = qualityFiltered.sort((a, b) => b.enhancedScore - a.enhancedScore);
  }
  
  // ✅ Adaptive result count based on quality
  // For date-specific queries, limit to fit in 2 segments max (320 chars)
  let resultCount;
  if (targetDate && !hasActivityFilter) {
    // Pure date query: Limit to 3 events max (fits in ~300 chars, under 2 segments)
    resultCount = Math.min(3, sorted.length);
    console.log(`📅 [Date Query] Limiting to ${resultCount} events to stay under 2 segments (320 chars max)`);
  } else if (targetDate) {
    // Date + activity query: limit to 5 events
    resultCount = Math.min(5, sorted.length);
    console.log(`📅 [Date + Activity Query] Showing ${resultCount} events`);
  } else {
    resultCount = 3; // Default for general queries
    if (sorted.length > 0) {
      const topScore = sorted[0].enhancedScore;
      if (topScore > 0.8 && sorted.length >= 5) {
        resultCount = 5; // Show up to 5 if excellent matches
      } else if (topScore > 0.7 && sorted.length >= 4) {
        resultCount = 4; // Show up to 4 if very good matches
      } else if (topScore > 0.6 && sorted.length >= 3) {
        resultCount = 3; // Show 3 if good matches
      } else if (topScore > 0.5 && sorted.length >= 2) {
        resultCount = 2; // Show 2 if decent matches
      } else {
        resultCount = Math.min(1, sorted.length); // Show 1 if weak matches
      }
    }
  }
  
  // ✅ Apply deduplication and diversity: max 1 per organization if we have many results
  // First, deduplicate by event ID (same event should never appear twice)
  const seenIds = new Set();
  const deduplicated = sorted.filter(result => {
    if (seenIds.has(result.id)) {
      console.log(`⚠️  [Deduplication] Skipping duplicate event: ${result.metadata.title} (ID: ${result.id})`);
      return false;
    }
    seenIds.add(result.id);
    return true;
  });
  
  let finalResults = [];
  if (targetDate && !hasActivityFilter) {
    // Pure date query: Limit to resultCount (already set to max 3 above)
    finalResults = deduplicated.slice(0, resultCount);
    const totalFound = deduplicated.length;
    if (totalFound > resultCount) {
      console.log(`📅 [Date Query] Found ${totalFound} events, limiting to top ${resultCount} to stay under 2 segments`);
    } else {
      console.log(`📅 [Date Query] Showing ${finalResults.length} unique events on requested date`);
    }
  } else if (resultCount >= 3 && deduplicated.length > 3) {
    const orgsSeen = new Set();
    for (const result of deduplicated) {
      if (finalResults.length >= resultCount) break;
      
      const org = result.metadata.organization_name || "";
      if (!org || !orgsSeen.has(org) || finalResults.length < 2) {
        finalResults.push(result);
        if (org) orgsSeen.add(org);
      }
    }
    // If we don't have enough after diversity filter, fill with remaining
    while (finalResults.length < resultCount && finalResults.length < deduplicated.length) {
      const remaining = deduplicated.find(r => !finalResults.some(fr => fr.id === r.id));
      if (remaining) finalResults.push(remaining);
      else break;
    }
  } else {
    finalResults = deduplicated.slice(0, resultCount);
  }
  
  const topResults = finalResults;
  console.log(`✅ Final results count: ${topResults.length}`);
  if (topResults.length === 0 && filtered.length > 0) {
    console.log(`⚠️  [WARNING] Filtered results exist (${filtered.length}) but finalResults is empty!`);
    console.log(`   This suggests similarity score threshold or ranking logic filtered them out.`);
    if (filtered.length > 0) {
      console.log(`   Top filtered result: "${filtered[0].metadata.title}" (score: ${filtered[0].score})`);
    }
  }

  if (topResults.length === 0) {
    let suggestion = "Try asking in a different way or for another day!";
    if (costIntent === "free" && activityType) {
      suggestion = "Try searching without 'free' or the specific activity, or check back later!";
    } else if (costIntent === "free") {
      suggestion = "Try searching without 'free' or check back later for free events!";
    } else if (activityType) {
      suggestion = "Try a different activity or check what's happening this week!";
    } else if (timeRange || targetTime) {
      suggestion = "Try a different time or check what's happening this week!";
    }
    return `I couldn't find any upcoming events that match. ${suggestion}`;
  }

  // ✅ ULTRA-OPTIMIZED SMS formatting - NO EMOJIS, <160 chars per message to fit in 1 segment
  // Format: "1) Title – Date Time @ Location: shorturl"
  const shortUrl = BASE_URL.replace(/^https?:\/\//, '').replace(/^www\./, '');
  
  // Helper to format date compactly: "Sun 11/30" instead of "Sun, Nov 30"
  function formatCompactDate(date) {
    const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
    const month = date.getMonth() + 1;
    const day = date.getDate();
    return `${weekday} ${month}/${day}`;
  }
  
  // Helper to format time compactly: "11:30a" instead of "11:30 AM"
  function formatCompactTime(timeStr) {
    if (!timeStr) return '';
    // Remove spaces and convert AM/PM to lowercase a/p
    return timeStr.replace(/\s+/g, '').replace(/AM/gi, 'a').replace(/PM/gi, 'p');
  }
  
  // Helper to shorten poster ID (use first 4 chars)
  function shortenPosterId(id) {
    return id.substring(0, 4);
  }
  
  let msg = '';
  const MAX_CHARS_2_SEGMENTS = 300; // Leave 20 chars buffer for safety (320 max = 2 segments)
  let totalChars = 0;
  let eventsAdded = 0;
  const totalFound = targetDate && !hasActivityFilter ? filtered.length : topResults.length;
  
  topResults.forEach((match, i) => {
    // Build compact event line: "1) Title – Date Time @ Location: url"
    let eventLine = `${i + 1}) `;
    
    // Title (truncate if too long)
    const title = match.metadata.title;
    const maxTitleLength = 25; // Leave room for rest of line
    const shortTitle = title.length > maxTitleLength 
      ? title.substring(0, maxTitleLength - 3) + '...' 
      : title;
    eventLine += shortTitle;
    
    // Date and time - compact format
    const dateTimeParts = [];
    if (match.metadata.date_normalized) {
      const eventDate = getLocalDateFromISO(match.metadata.date_normalized);
      if (eventDate) {
        dateTimeParts.push(formatCompactDate(eventDate));
      }
    }
    if (match.metadata.time) {
      dateTimeParts.push(formatCompactTime(match.metadata.time));
    }
    
    // Location - keep full name (no abbreviations)
    const location = match.metadata.location || '';
    
    // Build the compact line
    if (dateTimeParts.length > 0) {
      eventLine += ` – ${dateTimeParts.join(' ')}`;
    }
    if (location) {
      eventLine += ` @ ${location}`;
    }
    
    // Use full poster ID in URL (more reliable than short prefix lookup)
    // Full URL is still compact: usethemove.com/poster/FullID
    eventLine += `: ${shortUrl}/poster/${match.id}`;
    
    // Check if adding this event would exceed 2-segment limit (for pure date queries)
    const spacing = eventsAdded > 0 ? '\n\n' : '';
    const testLength = totalChars + spacing.length + eventLine.length;
    
    if (targetDate && !hasActivityFilter && testLength > MAX_CHARS_2_SEGMENTS) {
      console.log(`📅 [Date Query] Stopping at ${eventsAdded} events (would be ${testLength} chars, limit: ${MAX_CHARS_2_SEGMENTS})`);
      return; // Stop adding events to stay under 2 segments
    }
    
    msg += spacing + eventLine;
    totalChars = msg.length;
    eventsAdded++;
  });
  
  // Add note if results were limited for pure date queries
  if (targetDate && !hasActivityFilter && totalFound > eventsAdded) {
    const note = `\n\n(Showing ${eventsAdded} of ${totalFound}. Be more specific!)`;
    // Check if note would push us over limit
    if (totalChars + note.length <= MAX_CHARS_2_SEGMENTS) {
      msg += note;
    }
  }
  
  // Remove the "Found X events:" header to save characters - just show the events
  // The message is now just the event list, which should be <160 chars for 1-2 events

    const finalMsg = msg.trim();
    console.log(`✅ [searchPostersForSMS] Returning message, length: ${finalMsg.length}`);
    console.log(`✅ [searchPostersForSMS] Message preview (first 200 chars): ${finalMsg.substring(0, 200)}`);
    // Verify no emojis in message
    const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu;
    if (emojiRegex.test(finalMsg)) {
      console.error(`❌ [searchPostersForSMS] WARNING: Message contains emojis! This will cause UCS-2 encoding.`);
    }
    return finalMsg;
  } catch (err) {
    console.error("❌ [searchPostersForSMS] Error:", err);
    console.error("❌ [searchPostersForSMS] Error stack:", err.stack);
    console.error("❌ [searchPostersForSMS] Query that failed:", query);
    console.error("❌ [searchPostersForSMS] School:", school);
    
    // Always return a user-friendly error message
    const errorMsg = "Sorry, I'm having trouble searching right now. Please try again in a moment!";
    console.log(`✅ [searchPostersForSMS] Returning error message`);
    return errorMsg;
  }
}

module.exports = {
  detectIntent,
  searchPostersForSMS,
  extractExactDate,
  extractExactTime
};

