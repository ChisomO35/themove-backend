// generateTestData.js
// Script to generate fake posters and users for local testing

const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const { Pinecone } = require("@pinecone-database/pinecone");
const sharp = require("sharp");
const fs = require("fs");
const path = require("path");

dotenv.config();

// Initialize Firebase
if (!admin.apps.length) {
  let serviceAccount;
  
  // Try environment variable first, then fall back to file
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } else if (fs.existsSync(path.join(__dirname, "firebase-service-account.json"))) {
    serviceAccount = JSON.parse(fs.readFileSync(path.join(__dirname, "firebase-service-account.json"), "utf8"));
  } else {
    throw new Error("Firebase service account not found. Set FIREBASE_SERVICE_ACCOUNT_JSON env var or provide firebase-service-account.json file.");
  }
  
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();

// Initialize Pinecone
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";
const BASE_URL = process.env.PUBLIC_APP_URL || "https://api.usethemove.com";

// Initialize OpenAI
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// Helper: Create embedding
async function createEmbedding(text) {
  const openai = getOpenAI();
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

// Helper: Get date in future
function getFutureDate(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  return date.toISOString().slice(0, 10);
}

// Helper: Get random time
function getRandomTime() {
  const hours = Math.floor(Math.random() * 12) + 10; // 10 AM - 9 PM
  const minutes = Math.random() < 0.5 ? 0 : 30;
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  return `${displayHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

// UNC Buildings
const UNC_BUILDINGS = [
  "Alderman", "Alexander", "Avery", "Carmichael", "Cobb", "Connor",
  "Craige", "Craige North", "Ehringhaus", "Everett", "Graham", "Grimes",
  "Hardin", "Hinton James", "Horton", "Joyner", "Kenan", "Koury",
  "Lewis", "Mangum", "Manly", "McClinton", "McIver", "Morrison",
  "Old East", "Old West", "Parker", "Ram Village", "Ruffin Jr.",
  "Spencer", "Stacy", "Taylor", "Teague", "Student Union", "Memorial Hall",
  "Davis Library", "The Pit"
];

// Sample event data
const EVENT_TEMPLATES = [
  {
    title: "Open Mic Night",
    organization: "UNC Music Club",
    type: "event",
    tags: ["Music Performance", "Social", "Entertainment"],
    categories: ["Music", "Arts & Culture"],
    description: "Come showcase your talent! All performers welcome. Sign up at the door.",
    cost: "Free",
    audience: "All students",
    locations: ["Student Union", "Memorial Hall"],
  },
  {
    title: "Poker Night",
    organization: "Gaming Club",
    type: "event",
    tags: ["Games", "Social", "Entertainment"],
    categories: ["Hobbies"],
    description: "Weekly poker tournament. Prizes for top 3. No entry fee.",
    cost: "Free",
    audience: "All students",
    locations: ["Student Union", "Carmichael"],
  },
  {
    title: "Career Fair 2025",
    organization: "Career Services",
    type: "event",
    tags: ["Career Development", "Networking", "Job Opportunities"],
    categories: ["Business & Innovation"],
    description: "Meet with 50+ employers. Bring your resume!",
    cost: "Free",
    audience: "All students",
    locations: ["Memorial Hall", "Student Union"],
  },
  {
    title: "Study Group Session",
    organization: "Academic Support",
    type: "event",
    tags: ["Study Groups", "Academic"],
    categories: ["General"],
    description: "Weekly study group for all subjects. Bring your books!",
    cost: "Free",
    audience: "All students",
    locations: ["Davis Library", "Student Union"],
  },
  {
    title: "Free Pizza Friday",
    organization: "Student Activities",
    type: "event",
    tags: ["Free Food", "Social", "Pizza"],
    categories: ["Community"],
    description: "Free pizza every Friday! First come, first served.",
    cost: "Free",
    audience: "All students",
    locations: ["The Pit", "Student Union"],
  },
  {
    title: "Basketball Tournament",
    organization: "Intramural Sports",
    type: "event",
    tags: ["Basketball", "Sports & Fitness", "Tournaments"],
    categories: ["Sports & Fitness"],
    description: "3v3 basketball tournament. Sign up as a team or individual.",
    cost: "Free",
    audience: "All students",
    locations: ["Carmichael", "Student Union"],
  },
  {
    title: "Networking Mixer",
    organization: "Business School",
    type: "event",
    tags: ["Networking", "Career Development", "Business"],
    categories: ["Business & Innovation"],
    description: "Network with alumni and professionals. Light refreshments provided.",
    cost: "Free",
    audience: "Business students",
    locations: ["Kenan", "Memorial Hall"],
  },
  {
    title: "Yoga in the Park",
    organization: "Wellness Center",
    type: "event",
    tags: ["Yoga", "Wellness & Health", "Fitness"],
    categories: ["Wellness & Health", "Sports & Fitness"],
    description: "Free outdoor yoga session. Bring your mat!",
    cost: "Free",
    audience: "All students",
    locations: ["The Pit", "Campus"],
  },
  {
    title: "Volunteer Fair",
    organization: "Community Service",
    type: "event",
    tags: ["Volunteer", "Community Service", "Charity & Causes"],
    categories: ["Charity & Causes"],
    description: "Find volunteer opportunities with local organizations.",
    cost: "Free",
    audience: "All students",
    locations: ["Student Union"],
  },
  {
    title: "Hip Hop Concert",
    organization: "Campus Entertainment",
    type: "event",
    tags: ["Hip Hop / Rap", "Music", "Concert"],
    categories: ["Music"],
    description: "Live hip hop performance featuring local artists.",
    cost: "$10",
    audience: "All students",
    locations: ["Memorial Hall"],
  },
  {
    title: "Theatre Production: Hamlet",
    organization: "Drama Department",
    type: "event",
    tags: ["Theatre", "Arts & Culture", "Performance"],
    categories: ["Arts & Culture"],
    description: "Student production of Shakespeare's Hamlet.",
    cost: "$5",
    audience: "All students",
    locations: ["Memorial Hall"],
  },
  {
    title: "Startup Pitch Night",
    organization: "Entrepreneurship Club",
    type: "event",
    tags: ["Startups & Entrepreneurship", "Business", "Innovation"],
    categories: ["Business & Innovation"],
    description: "Watch student startups pitch their ideas. Free food!",
    cost: "Free",
    audience: "All students",
    locations: ["Kenan"],
  },
];

// Sample organization data
const ORG_TEMPLATES = [
  {
    title: "Chess Club",
    organization: "Chess Club",
    type: "organization",
    tags: ["Games", "Clubs", "Chess"],
    categories: ["Hobbies"],
    description: "Weekly chess meetings. All skill levels welcome.",
    cost: "",
    audience: "All students",
    locations: [],
  },
  {
    title: "Photography Society",
    organization: "Photography Society",
    type: "organization",
    tags: ["Photography", "Arts & Culture", "Clubs"],
    categories: ["Arts & Culture"],
    description: "Join us for photo walks and workshops.",
    cost: "",
    audience: "All students",
    locations: [],
  },
];

// Sample user data
const USER_TEMPLATES = [
  {
    name: "Alex Johnson",
    email: "alex.johnson@unc.edu",
    school: "UNC-Chapel Hill",
    year: "Sophomore",
    dorm: "Ehringhaus",
    interests: ["Hip Hop / Rap", "Basketball", "Free Food"],
    phone: "+12345678901",
  },
  {
    name: "Maya Chen",
    email: "maya.chen@unc.edu",
    school: "UNC-Chapel Hill",
    year: "Junior",
    dorm: "Carmichael",
    interests: ["Study Groups", "Networking", "Career Development"],
    phone: "+12345678902",
  },
  {
    name: "Jordan Smith",
    email: "jordan.smith@unc.edu",
    school: "UNC-Chapel Hill",
    year: "Freshman",
    dorm: "Hinton James",
    interests: ["Poker", "Games", "Social Events"],
    phone: "+12345678903",
  },
  {
    name: "Sam Taylor",
    email: "sam.taylor@unc.edu",
    school: "UNC-Chapel Hill",
    year: "Senior",
    dorm: "Off-Campus",
    interests: ["Yoga", "Wellness & Health", "Mental Health"],
    phone: "+12345678904",
  },
  {
    name: "Casey Williams",
    email: "casey.williams@unc.edu",
    school: "UNC-Chapel Hill",
    year: "Sophomore",
    dorm: "Ram Village",
    interests: ["Theatre", "Music Performance", "Arts & Culture"],
    phone: "+12345678905",
  },
];

// Generate fake poster
async function generatePoster(template, daysFromNow = null) {
  const isEvent = template.type === "event";
  const date = daysFromNow !== null ? getFutureDate(daysFromNow) : (isEvent ? getFutureDate(Math.floor(Math.random() * 30)) : null);
  const time = isEvent ? getRandomTime() : "";
  const location = template.locations.length > 0 
    ? template.locations[Math.floor(Math.random() * template.locations.length)]
    : "";

  // Normalize time
  const normalizeStartTime = (timeStr) => {
    if (!timeStr) return "";
    const lower = timeStr.toLowerCase().trim();
    const match = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return "";
    let hour = parseInt(match[1], 10);
    let minutes = match[2] ? parseInt(match[2], 10) : 0;
    const suffix = match[3] ? match[3].toLowerCase() : null;
    if (suffix === "pm" && hour < 12) hour += 12;
    else if (suffix === "am" && hour === 12) hour = 0;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    return `${hh}:${mm}`;
  };

  const location_building = location ? UNC_BUILDINGS.find(b => location.includes(b)) || "" : "";

  const posterData = {
    poster_title: template.title,
    poster_type: template.type,
    organization_name: template.organization,
    description: template.description,
    tags: template.tags,
    categories: template.categories,
    date_normalized: date || "",
    time: time,
    time_normalized_start: normalizeStartTime(time),
    location: location,
    location_building: location_building,
    audience: template.audience,
    cost: template.cost,
    frequency: isEvent ? "" : "Weekly",
    school: "UNC-Chapel Hill",
    school_normalized: "uncchapelhill",
    poster_image_url: "https://via.placeholder.com/800x600/4F46E5/FFFFFF?text=" + encodeURIComponent(template.title),
    timestamp: new Date().toISOString(),
  };

  // ✅ Enhanced embedding text - optimized for hyper-accurate matching
  const tags = template.tags || [];
  const categories = template.categories || [];
  
  // Build keyword-rich text with repetition for emphasis
  const keywordPhrases = [];
  tags.forEach(tag => keywordPhrases.push(tag));
  categories.forEach(cat => keywordPhrases.push(cat));
  
  // Extract key terms from title for additional keywords
  const titleWords = template.title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  titleWords.forEach(word => {
    if (!keywordPhrases.some(kp => kp.toLowerCase().includes(word))) {
      keywordPhrases.push(word);
    }
  });
  
  const keywordsText = keywordPhrases.length > 0 
    ? `Keywords: ${keywordPhrases.join(", ")}. Tags: ${tags.join(", ")}. Categories: ${categories.join(", ")}.` 
    : "";
  
  // Enhanced structured text
  const textToEmbed = `
    ${keywordsText}
    Event Title: ${template.title}. 
    ${template.organization ? `Organization: ${template.organization}.` : ""}
    ${template.description ? `Description: ${template.description}` : ""}
    ${isEvent ? "Type: Campus event." : "Type: Student organization."}
    ${date ? `Date: ${new Date(date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}` : ""}
    ${time ? `Time: ${time}` : ""}
    ${location ? `Location: ${location}` : ""}
    ${template.audience ? `For: ${template.audience}` : ""}
    ${template.cost ? `Cost: ${template.cost}` : ""}
    ${!isEvent ? `Frequency: Weekly` : ""}
    ${tags.length > 0 ? `Searchable terms: ${tags.join(", ")}` : ""}
  `.replace(/\s+/g, " ").trim();

  const embedding = await createEmbedding(textToEmbed);

  // Save to Firestore
  const docRef = await db.collection("posters").add({
    ...posterData,
    embedded_text: textToEmbed,
    embedding_model: "text-embedding-3-small",
    embedding_version: "v1",
  });

  const posterUrl = `${BASE_URL}/poster/${docRef.id}`;
  await db.collection("posters").doc(docRef.id).update({ poster_url: posterUrl });

  // Save to Pinecone
  await index.namespace(PINECONE_NAMESPACE).upsert([
    {
      id: docRef.id,
      values: embedding,
      metadata: {
        type: "poster",
        title: template.title,
        poster_type: template.type,
        organization_name: template.organization,
        date_normalized: date || "",
        time: time,
        time_normalized_start: normalizeStartTime(time),
        location: location,
        location_building: location_building,
        audience: template.audience,
        cost: template.cost,
        frequency: !isEvent ? "Weekly" : "",
        categories: template.categories.join(", "),
        tags: template.tags.join(", "),
        school: "UNC-Chapel Hill",
        school_normalized: "uncchapelhill",
      },
    },
  ]);

  return { id: docRef.id, ...posterData };
}

// Generate fake user
async function generateUser(template) {
  const interestsList = template.interests.join(", ");
  const userText = `
    I'm a ${template.school} student. My interests: ${interestsList}.
    I want to find campus events about: ${interestsList}.
    I'm interested in activities related to: ${interestsList}.
    Looking for opportunities in: ${interestsList}.
    ${template.dorm ? `I live in ${template.dorm} dormitory.` : ""}
    I search for events matching these topics: ${interestsList}.
  `.replace(/\s+/g, " ").trim();

  const embedding = await createEmbedding(userText);

  const userData = {
    uid: `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    name: template.name,
    email: template.email,
    school: template.school,
    year: template.year,
    dorm: template.dorm,
    interests: template.interests,
    phone: template.phone,
    embedding: embedding,
    embedding_model: "text-embedding-3-small",
    embedding_version: "v1",
    dailyDigestOptIn: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Save to Firestore
  await db.collection("users").doc(userData.uid).set(userData);

  // Save to Pinecone
  await index.namespace(PINECONE_NAMESPACE).upsert([
    {
      id: userData.uid,
      values: embedding,
      metadata: {
        type: "user",
        name: template.name,
        email: template.email,
        school: template.school,
        year: template.year,
        phone: template.phone,
        interests: template.interests.join(", "),
        dorm: template.dorm,
      },
    },
  ]);

  return userData;
}

// Main function
async function generateTestData() {
  console.log("🚀 Generating test data...\n");

  // Generate posters
  console.log("📋 Generating posters...");
  const posters = [];
  
  // Generate events with various dates
  for (let i = 0; i < EVENT_TEMPLATES.length; i++) {
    const template = EVENT_TEMPLATES[i];
    // Create multiple instances with different dates
    for (let j = 0; j < 2; j++) {
      const daysFromNow = j * 7 + (i % 7); // Spread across weeks
      const poster = await generatePoster(template, daysFromNow);
      posters.push(poster);
      console.log(`   ✅ Created: ${poster.poster_title} (${poster.date_normalized || "org"})`);
    }
  }

  // Generate organizations
  for (const template of ORG_TEMPLATES) {
    const poster = await generatePoster(template, null);
    posters.push(poster);
    console.log(`   ✅ Created: ${poster.poster_title} (organization)`);
  }

  console.log(`\n📊 Generated ${posters.length} posters\n`);

  // Generate users
  console.log("👥 Generating users...");
  const users = [];
  for (const template of USER_TEMPLATES) {
    const user = await generateUser(template);
    users.push(user);
    console.log(`   ✅ Created: ${user.name} (${user.interests.length} interests)`);
  }

  console.log(`\n📊 Generated ${users.length} users\n`);

  console.log("✅ Test data generation complete!");
  console.log(`\n📝 Summary:`);
  console.log(`   - ${posters.length} posters created`);
  console.log(`   - ${users.length} users created`);
  console.log(`   - All data saved to Firestore and Pinecone`);
  console.log(`\n🧪 You can now test searches and daily digest!`);
}

// Run if executed directly
if (require.main === module) {
  generateTestData()
    .then(() => {
      console.log("\n✅ Done!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

module.exports = { generatePoster, generateUser };

