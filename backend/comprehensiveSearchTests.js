// comprehensiveSearchTests.js
// Comprehensive test suite for search algorithm with diverse posters and student queries

const { searchPostersForSMS } = require("./searchCore");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const { Pinecone } = require("@pinecone-database/pinecone");

dotenv.config();

// Initialize Firebase
if (!admin.apps.length) {
  let serviceAccount;
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "firebase-service-account.json");
    if (fs.existsSync(filePath)) {
      serviceAccount = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      throw new Error("Firebase service account not found");
    }
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";

// Helper functions
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function createEmbedding(text) {
  const openai = getOpenAI();
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

function getLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function localDateToISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeStartTime(timeStr) {
  if (!timeStr) return "";
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return "";
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "PM" && hour !== 12) hour += 12;
  if (period === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// ==========================================================
// DIVERSE POSTER TEMPLATES
// ==========================================================

const DIVERSE_POSTERS = [
  // Free food events
  {
    title: "Free Pizza Friday",
    organization: "Student Activities Board",
    type: "event",
    tags: ["Free Food", "Social", "Pizza"],
    categories: ["Food & Dining", "Social"],
    description: "Free pizza for all students! First come first served.",
    cost: "Free",
    audience: "All students",
    location: "Student Union",
    dateOffset: 1, // Tomorrow
    time: "4:30 PM"
  },
  {
    title: "Taco Tuesday",
    organization: "Latino Student Association",
    type: "event",
    tags: ["Free Food", "Cultural", "Tacos"],
    categories: ["Food & Dining", "Cultural"],
    description: "Free tacos and cultural celebration",
    cost: "Free",
    audience: "All students",
    location: "The Pit",
    dateOffset: 3,
    time: "12:00 PM"
  },
  
  // Academic events
  {
    title: "Study Group Session",
    organization: "Academic Support",
    type: "event",
    tags: ["Study", "Academic", "Learning"],
    categories: ["Academic", "Study"],
    description: "Join us for a collaborative study session",
    cost: "Free",
    audience: "All students",
    location: "Davis Library",
    dateOffset: 0, // Today
    time: "4:00 PM"
  },
  {
    title: "Career Fair 2025",
    organization: "Career Services",
    type: "event",
    tags: ["Career", "Networking", "Jobs", "Internships"],
    categories: ["Career", "Professional Development"],
    description: "Meet employers and find internships",
    cost: "Free",
    audience: "All students",
    location: "Memorial Hall",
    dateOffset: 7,
    time: "10:00 AM"
  },
  
  // Social/Entertainment
  {
    title: "Open Mic Night",
    organization: "UNC Music Club",
    type: "event",
    tags: ["Music", "Performance", "Entertainment", "Social"],
    categories: ["Music", "Arts & Culture"],
    description: "Showcase your talent! All performers welcome.",
    cost: "Free",
    audience: "All students",
    location: "Memorial Hall",
    dateOffset: 2,
    time: "7:00 PM"
  },
  {
    title: "Poker Night",
    organization: "Gaming Club",
    type: "event",
    tags: ["Games", "Poker", "Social", "Entertainment"],
    categories: ["Hobbies", "Social"],
    description: "Weekly poker tournament. Prizes for top 3.",
    cost: "Free",
    audience: "All students",
    location: "Student Union",
    dateOffset: 4,
    time: "8:00 PM"
  },
  
  // Sports/Fitness
  {
    title: "Basketball Tournament",
    organization: "Intramural Sports",
    type: "event",
    tags: ["Sports", "Basketball", "Competition", "Fitness"],
    categories: ["Sports", "Fitness"],
    description: "3v3 basketball tournament. Sign up required.",
    cost: "$5",
    audience: "All students",
    location: "Carmichael Gym",
    dateOffset: 5,
    time: "2:00 PM"
  },
  {
    title: "Yoga in the Park",
    organization: "Wellness Center",
    type: "event",
    tags: ["Yoga", "Fitness", "Wellness", "Mindfulness"],
    categories: ["Fitness", "Wellness"],
    description: "Free outdoor yoga session",
    cost: "Free",
    audience: "All students",
    location: "The Pit",
    dateOffset: 1,
    time: "9:00 AM"
  },
  
  // Cultural/Diversity
  {
    title: "Hip Hop Concert",
    organization: "Black Student Movement",
    type: "event",
    tags: ["Music", "Hip Hop", "Concert", "Cultural"],
    categories: ["Music", "Cultural"],
    description: "Live hip hop performance featuring local artists",
    cost: "$10",
    audience: "All students",
    location: "Memorial Hall",
    dateOffset: 6,
    time: "8:00 PM"
  },
  {
    title: "International Food Festival",
    organization: "International Student Association",
    type: "event",
    tags: ["Food", "Cultural", "International", "Festival"],
    categories: ["Food & Dining", "Cultural"],
    description: "Taste foods from around the world",
    cost: "$5",
    audience: "All students",
    location: "Student Union",
    dateOffset: 10,
    time: "5:00 PM"
  },
  
  // Volunteer/Service
  {
    title: "Community Service Day",
    organization: "Volunteer Center",
    type: "event",
    tags: ["Volunteer", "Service", "Community", "Outreach"],
    categories: ["Service", "Volunteer"],
    description: "Help out in the local community",
    cost: "Free",
    audience: "All students",
    location: "Off Campus",
    dateOffset: 8,
    time: "10:00 AM"
  },
  
  // Professional/Networking
  {
    title: "Startup Pitch Night",
    organization: "Entrepreneurship Club",
    type: "event",
    tags: ["Business", "Entrepreneurship", "Networking", "Startups"],
    categories: ["Business", "Professional Development"],
    description: "Watch student startups pitch their ideas",
    cost: "Free",
    audience: "All students",
    location: "Kenan",
    dateOffset: 1,
    time: "2:30 PM"
  },
  
  // Study/Workshop
  {
    title: "Python Workshop",
    organization: "Computer Science Club",
    type: "event",
    tags: ["Workshop", "Programming", "Python", "Tech", "Learning"],
    categories: ["Academic", "Technology"],
    description: "Learn Python basics. No experience required.",
    cost: "Free",
    audience: "All students",
    location: "Sitterson Hall",
    dateOffset: 3,
    time: "3:00 PM"
  },
  
  // Late night events
  {
    title: "Midnight Study Session",
    organization: "Student Government",
    type: "event",
    tags: ["Study", "Late Night", "Academic"],
    categories: ["Academic", "Study"],
    description: "Extended library hours with free coffee",
    cost: "Free",
    audience: "All students",
    location: "Davis Library",
    dateOffset: 0,
    time: "11:00 PM"
  },
  
  // Weekend events
  {
    title: "Saturday Brunch",
    organization: "Culinary Club",
    type: "event",
    tags: ["Food", "Brunch", "Social", "Weekend"],
    categories: ["Food & Dining", "Social"],
    description: "All-you-can-eat brunch buffet",
    cost: "$12",
    audience: "All students",
    location: "Student Union",
    dateOffset: 5, // Saturday
    time: "11:00 AM"
  },
  
  // Events with no cost specified
  {
    title: "Movie Night",
    organization: "Film Society",
    type: "event",
    tags: ["Movies", "Entertainment", "Social"],
    categories: ["Entertainment", "Social"],
    description: "Screening of popular films",
    cost: "",
    audience: "All students",
    location: "Memorial Hall",
    dateOffset: 2,
    time: "7:30 PM"
  },
];

// ==========================================================
// STUDENT SEARCH QUERIES
// ==========================================================

const STUDENT_QUERIES = [
  // Date-specific queries
  { query: "What's happening tomorrow", expected: ["Free Pizza Friday", "Yoga in the Park", "Startup Pitch Night"] },
  { query: "events today", expected: ["Study Group Session", "Midnight Study Session"] },
  { query: "what's happening this weekend", expected: ["Saturday Brunch", "Basketball Tournament"] },
  { query: "free events this week", expected: ["Free Pizza Friday", "Yoga in the Park", "Open Mic Night", "Poker Night"] },
  
  // Free food queries
  { query: "free pizza", expected: ["Free Pizza Friday"] },
  { query: "free food", expected: ["Free Pizza Friday", "Taco Tuesday"] },
  { query: "where can I get free food", expected: ["Free Pizza Friday", "Taco Tuesday"] },
  { query: "free food today", expected: [] }, // No free food today
  { query: "free food tomorrow", expected: ["Free Pizza Friday"] },
  
  // Activity-based queries
  { query: "basketball", expected: ["Basketball Tournament"] },
  { query: "yoga", expected: ["Yoga in the Park"] },
  { query: "poker", expected: ["Poker Night"] },
  { query: "study groups", expected: ["Study Group Session"] },
  { query: "music events", expected: ["Open Mic Night", "Hip Hop Concert"] },
  { query: "concerts", expected: ["Hip Hop Concert"] },
  { query: "workshops", expected: ["Python Workshop"] },
  
  // Time-based queries
  { query: "what's happening tonight", expected: ["Midnight Study Session"] },
  { query: "events this afternoon", expected: ["Study Group Session", "Startup Pitch Night"] },
  { query: "morning events", expected: ["Yoga in the Park"] },
  { query: "late night events", expected: ["Midnight Study Session"] },
  
  // Career/Professional
  { query: "career fair", expected: ["Career Fair 2025"] },
  { query: "networking events", expected: ["Career Fair 2025", "Startup Pitch Night"] },
  { query: "internships", expected: ["Career Fair 2025"] },
  { query: "business events", expected: ["Startup Pitch Night"] },
  
  // Cultural/Diversity
  { query: "cultural events", expected: ["Taco Tuesday", "Hip Hop Concert", "International Food Festival"] },
  { query: "international events", expected: ["International Food Festival"] },
  
  // Volunteer/Service
  { query: "volunteer opportunities", expected: ["Community Service Day"] },
  { query: "community service", expected: ["Community Service Day"] },
  
  // Academic
  { query: "study sessions", expected: ["Study Group Session", "Midnight Study Session"] },
  { query: "academic events", expected: ["Study Group Session", "Python Workshop", "Midnight Study Session"] },
  { query: "programming workshop", expected: ["Python Workshop"] },
  
  // General/broad queries
  { query: "what's happening", expected: ["Study Group Session", "Midnight Study Session"] }, // Today
  { query: "events", expected: ["Study Group Session", "Midnight Study Session"] },
  { query: "what to do", expected: ["Study Group Session", "Midnight Study Session"] },
  { query: "things to do this week", expected: ["Free Pizza Friday", "Yoga in the Park", "Open Mic Night", "Poker Night"] },
  
  // Cost-specific
  { query: "free events", expected: ["Free Pizza Friday", "Yoga in the Park", "Open Mic Night", "Poker Night"] },
  { query: "cheap events", expected: ["Basketball Tournament", "International Food Festival"] },
  
  // Location-based (if we add location extraction)
  { query: "events at student union", expected: ["Free Pizza Friday", "Poker Night", "Saturday Brunch"] },
  { query: "library events", expected: ["Study Group Session", "Midnight Study Session"] },
  
  // Combination queries
  { query: "free food tomorrow", expected: ["Free Pizza Friday"] },
  { query: "music events this week", expected: ["Open Mic Night", "Hip Hop Concert"] },
  { query: "free social events", expected: ["Free Pizza Friday", "Open Mic Night", "Poker Night"] },
];

// ==========================================================
// CREATE POSTERS IN FIRESTORE AND PINECONE
// ==========================================================

async function createPoster(posterTemplate) {
  const today = getLocalDate();
  const eventDate = addDays(today, posterTemplate.dateOffset);
  const dateISO = localDateToISO(eventDate);
  
  // Build embedding text (matching server.js format)
  const tags = posterTemplate.tags || [];
  const categories = posterTemplate.categories || [];
  const title = posterTemplate.title;
  const orgName = posterTemplate.organization;
  const description = posterTemplate.description || "";
  
  const keywordPhrases = [];
  tags.forEach(tag => keywordPhrases.push(tag));
  categories.forEach(cat => keywordPhrases.push(cat));
  
  const titleWords = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  titleWords.forEach(word => {
    if (!keywordPhrases.some(kp => kp.toLowerCase().includes(word))) {
      keywordPhrases.push(word);
    }
  });
  
  const keywordsText = keywordPhrases.length > 0 
    ? `Keywords: ${keywordPhrases.join(", ")}. Tags: ${tags.join(", ")}. Categories: ${categories.join(", ")}.`
    : "";
  
  const textToEmbed = `
    ${keywordsText}
    Event Title: ${title}.
    ${orgName ? `Organization: ${orgName}.` : ""}
    ${description ? `Description: ${description}` : ""}
    Type: Campus event.
    ${dateISO ? `Date: ${eventDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
    ${posterTemplate.time ? `Time: ${posterTemplate.time}` : ""}
    ${posterTemplate.location ? `Location: ${posterTemplate.location}` : ""}
    ${posterTemplate.audience ? `For: ${posterTemplate.audience}` : ""}
    ${posterTemplate.cost ? `Cost: ${posterTemplate.cost}` : ""}
    ${tags.length > 0 ? `Searchable terms: ${tags.join(", ")}` : ""}
  `.replace(/\s+/g, " ").trim();
  
  const embedding = await createEmbedding(textToEmbed);
  
  // Save to Firestore
  const posterData = {
    poster_title: title,
    organization_name: orgName,
    poster_type: posterTemplate.type,
    date_normalized: dateISO,
    time: posterTemplate.time || "",
    time_normalized_start: normalizeStartTime(posterTemplate.time || ""),
    location: posterTemplate.location || "",
    cost: posterTemplate.cost || "",
    audience: posterTemplate.audience || "",
    tags: tags,
    categories: categories,
    description: description,
    school: "UNC-Chapel Hill",
    school_normalized: "uncchapelhill",
    timestamp: new Date().toISOString(),
    embedded_text: textToEmbed,
    embedding_model: "text-embedding-3-small",
    embedding_version: "v1",
  };
  
  const docRef = await db.collection("posters").add(posterData);
  
  // Save to Pinecone
  await index.namespace(PINECONE_NAMESPACE).upsert([
    {
      id: docRef.id,
      values: embedding,
      metadata: {
        type: "poster",
        title: title,
        poster_type: posterTemplate.type,
        organization_name: orgName,
        date_normalized: dateISO,
        time: posterTemplate.time || "",
        time_normalized_start: normalizeStartTime(posterTemplate.time || ""),
        location: posterTemplate.location || "",
        location_building: "",
        audience: posterTemplate.audience || "",
        cost: posterTemplate.cost || "",
        frequency: "",
        categories: categories.join(", "),
        tags: tags.join(", "),
        school: "UNC-Chapel Hill",
        school_normalized: "uncchapelhill",
      },
    },
  ]);
  
  return { id: docRef.id, title, dateISO };
}

// ==========================================================
// RUN TESTS
// ==========================================================

async function runTests() {
  console.log("🧪 COMPREHENSIVE SEARCH TEST SUITE\n");
  console.log("=".repeat(80));
  
  // Step 1: Create all posters
  console.log("\n📝 Step 1: Creating test posters...");
  const createdPosters = [];
  for (const template of DIVERSE_POSTERS) {
    try {
      const poster = await createPoster(template);
      createdPosters.push(poster);
      console.log(`   ✅ Created: ${poster.title} (${poster.dateISO})`);
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limiting
    } catch (error) {
      console.error(`   ❌ Failed to create ${template.title}:`, error.message);
    }
  }
  
  console.log(`\n✅ Created ${createdPosters.length} posters`);
  
  // Wait a bit for Pinecone to index
  console.log("\n⏳ Waiting 5 seconds for Pinecone indexing...");
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Step 2: Run search tests
  console.log("\n🔍 Step 2: Running search tests...");
  console.log("=".repeat(80));
  
  const results = [];
  const school = "UNC-Chapel Hill";
  
  for (const test of STUDENT_QUERIES) {
    console.log(`\n📋 Test: "${test.query}"`);
    console.log(`   Expected: ${test.expected.join(", ") || "None"}`);
    
    try {
      const result = await searchPostersForSMS(test.query, school);
      
      // Extract event titles from result (simple parsing)
      const foundTitles = [];
      const lines = result.split("\n");
      for (const line of lines) {
        const match = line.match(/^\d+\)\s+(.+?)\s+–/);
        if (match) {
          foundTitles.push(match[1].trim());
        }
      }
      
      // Check if expected events were found
      const expectedFound = test.expected.filter(exp => 
        foundTitles.some(found => found.includes(exp) || exp.includes(found))
      );
      const unexpectedFound = foundTitles.filter(found => 
        !test.expected.some(exp => found.includes(exp) || exp.includes(found))
      );
      
      const passed = expectedFound.length === test.expected.length && unexpectedFound.length === 0;
      
      console.log(`   Found: ${foundTitles.join(", ") || "None"}`);
      if (passed) {
        console.log(`   ✅ PASS`);
      } else {
        console.log(`   ❌ FAIL`);
        if (expectedFound.length < test.expected.length) {
          const missing = test.expected.filter(exp => !expectedFound.includes(exp));
          console.log(`   ⚠️  Missing: ${missing.join(", ")}`);
        }
        if (unexpectedFound.length > 0) {
          console.log(`   ⚠️  Unexpected: ${unexpectedFound.join(", ")}`);
        }
      }
      
      results.push({
        query: test.query,
        expected: test.expected,
        found: foundTitles,
        passed,
        resultText: result
      });
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Rate limiting
    } catch (error) {
      console.error(`   ❌ ERROR: ${error.message}`);
      results.push({
        query: test.query,
        expected: test.expected,
        found: [],
        passed: false,
        error: error.message
      });
    }
  }
  
  // Step 3: Analysis
  console.log("\n\n📊 Step 3: Test Results Analysis");
  console.log("=".repeat(80));
  
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  
  console.log(`\n✅ Passed: ${passed}/${total} (${Math.round(passed/total*100)}%)`);
  console.log(`❌ Failed: ${failed}/${total} (${Math.round(failed/total*100)}%)`);
  
  if (failed > 0) {
    console.log("\n❌ Failed Tests:");
    results.filter(r => !r.passed).forEach(r => {
      console.log(`\n   Query: "${r.query}"`);
      console.log(`   Expected: ${r.expected.join(", ") || "None"}`);
      console.log(`   Found: ${r.found.join(", ") || "None"}`);
      if (r.error) console.log(`   Error: ${r.error}`);
    });
  }
  
  // Step 4: Identify patterns and gaps
  console.log("\n\n🔍 Step 4: Algorithm Analysis & Recommendations");
  console.log("=".repeat(80));
  
  analyzeResults(results, createdPosters);
  
  return results;
}

function analyzeResults(results, posters) {
  // Analyze failure patterns
  const failures = results.filter(r => !r.passed);
  
  console.log("\n📈 Failure Patterns:");
  
  // Pattern 1: Date-specific queries
  const dateQueryFailures = failures.filter(r => 
    r.query.toLowerCase().includes("tomorrow") || 
    r.query.toLowerCase().includes("today") ||
    r.query.toLowerCase().includes("weekend") ||
    r.query.toLowerCase().includes("this week")
  );
  if (dateQueryFailures.length > 0) {
    console.log(`\n   1. Date-specific queries: ${dateQueryFailures.length} failures`);
    console.log(`      Issues: May not be finding all events on requested dates`);
  }
  
  // Pattern 2: Activity-based queries
  const activityFailures = failures.filter(r => 
    !r.query.toLowerCase().includes("free") &&
    !r.query.toLowerCase().includes("tomorrow") &&
    !r.query.toLowerCase().includes("today") &&
    r.query.split(" ").length <= 3
  );
  if (activityFailures.length > 0) {
    console.log(`\n   2. Activity-based queries: ${activityFailures.length} failures`);
    console.log(`      Issues: Semantic similarity may be too strict for single-word queries`);
  }
  
  // Pattern 3: Free food queries
  const freeFoodFailures = failures.filter(r => 
    r.query.toLowerCase().includes("free") && 
    (r.query.toLowerCase().includes("food") || r.query.toLowerCase().includes("pizza"))
  );
  if (freeFoodFailures.length > 0) {
    console.log(`\n   3. Free food queries: ${freeFoodFailures.length} failures`);
    console.log(`      Issues: May need better cost filtering or keyword matching`);
  }
  
  // Pattern 4: General/broad queries
  const generalFailures = failures.filter(r => 
    r.query.toLowerCase().includes("what's happening") ||
    r.query.toLowerCase().includes("events") ||
    r.query.toLowerCase().includes("what to do")
  );
  if (generalFailures.length > 0) {
    console.log(`\n   4. General queries: ${generalFailures.length} failures`);
    console.log(`      Issues: May need better handling of vague queries`);
  }
  
  console.log("\n\n💡 Recommendations:");
  console.log("\n   1. Improve semantic similarity for single-word queries");
  console.log("      - Add synonym matching (e.g., 'basketball' → 'sports', 'tournament')");
  console.log("      - Boost title matches even more for activity queries");
  
  console.log("\n   2. Enhance date filtering");
  console.log("      - Ensure all date-specific queries show ALL events on that date");
  console.log("      - Better handling of 'this week', 'this weekend' ranges");
  
  console.log("\n   3. Improve cost filtering");
  console.log("      - Better detection of 'free' in various contexts");
  console.log("      - Handle implicit free events (no cost specified)");
  
  console.log("\n   4. Better query expansion");
  console.log("      - Expand 'music' to include 'concerts', 'performances', 'open mic'");
  console.log("      - Expand 'food' to include 'pizza', 'tacos', 'brunch', 'festival'");
  
  console.log("\n   5. Location extraction");
  console.log("      - Extract location from queries like 'events at student union'");
  console.log("      - Filter by location when specified");
}

// Run if executed directly
if (require.main === module) {
  runTests()
    .then(() => {
      console.log("\n✅ Test suite complete!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

module.exports = { runTests, DIVERSE_POSTERS, STUDENT_QUERIES };

