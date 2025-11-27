const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");
const { Pinecone } = require("@pinecone-database/pinecone");
const twilio = require("twilio");

dotenv.config();

// --- Set base URL for poster links ---
const BASE_URL = process.env.PUBLIC_APP_URL || "https://api.usethemove.com";

// --- Initialize Twilio ---
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// --- Initialize Firebase ---
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

// --- Initialize Pinecone ---
const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- Helper: create embedding (only for users, not posters) ---
async function createEmbedding(text) {
  const openai = getOpenAI();
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

// --- Helper: get local date (no time) ---
function getLocalDate() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

// --- Helper: convert ISO date string to local date ---
function getLocalDateFromISO(iso) {
  if (!iso) return null;
  const [yyyy, mm, dd] = iso.split("-");
  return new Date(parseInt(yyyy), parseInt(mm) - 1, parseInt(dd));
}

// --- Helper: format compact date (same as searchCore.js) ---
function formatCompactDate(date) {
  const weekday = date.toLocaleDateString("en-US", { weekday: "short" });
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${weekday} ${month}/${day}`;
}

// --- Helper: format compact time (same as searchCore.js) ---
function formatCompactTime(timeStr) {
  if (!timeStr) return '';
  return timeStr.replace(/\s+/g, '').replace(/AM/gi, 'a').replace(/PM/gi, 'p');
}

// --- Format events for SMS (same format as searchCore.js) ---
function formatEventsForSMS(matches, baseUrl) {
  const shortUrl = baseUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
  let msg = 'TheMove Daily Digest:\n\n'; // Header
  const MAX_CHARS_2_SEGMENTS = 300; // 2 segments max
  let totalChars = msg.length;
  let eventsAdded = 0;
  
  matches.forEach((match, i) => {
    let eventLine = `${i + 1}) `;
    
    // Title (truncate if too long)
    const title = match.title || "Untitled";
    const maxTitleLength = 25;
    const shortTitle = title.length > maxTitleLength 
      ? title.substring(0, maxTitleLength - 3) + '...' 
      : title;
    eventLine += shortTitle;
    
    // Date and time - compact format
    const dateTimeParts = [];
    if (match.date_normalized) {
      const eventDate = getLocalDateFromISO(match.date_normalized);
      if (eventDate) {
        dateTimeParts.push(formatCompactDate(eventDate));
      }
    }
    if (match.time) {
      dateTimeParts.push(formatCompactTime(match.time));
    }
    
    // Location
    const location = match.location || '';
    
    // Build the compact line
    if (dateTimeParts.length > 0) {
      eventLine += ` - ${dateTimeParts.join(' ')}`;
    }
    if (location) {
      eventLine += ` @ ${location}`;
    }
    
    // URL
    eventLine += `: ${shortUrl}/poster/${match.id}`;
    
    // Check if adding this event would exceed 2-segment limit
    const spacing = eventsAdded > 0 ? '\n\n' : '';
    const testLength = totalChars + spacing.length + eventLine.length;
    
    if (testLength > MAX_CHARS_2_SEGMENTS) {
      console.log(`📏 [Daily Digest] Stopping at ${eventsAdded} events (would be ${testLength} chars)`);
      return; // Stop adding events
    }
    
    msg += spacing + eventLine;
    totalChars = msg.length;
    eventsAdded++;
  });
  
  return msg.trim();
}

// --- Main function ---
async function runDailyDigest() {
  console.log("🧠 Running Daily Digest (Optimized with Pinecone)...");

  const today = getLocalDate();
  const todayISO = today.toISOString().slice(0, 10);

  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  if (users.length === 0) {
    console.log("😴 No users found.");
    return;
  }

  for (const user of users) {
    // ✅ Skip users who did not opt in
    if (!user.dailyDigestOptIn) {
      console.log(`⏭️ Skipping ${user.name || user.email} — not opted in`);
      continue;
    }

    // ✅ Skip users without phone numbers
    if (!user.phone) {
      console.log(`⏭️ Skipping ${user.name || user.email} — no phone number`);
      continue;
    }

    // ✅ Ensure user embedding exists or create one (using enhanced format)
    let userEmbedding = user.embedding;
    if (!userEmbedding) {
      const interestsList = (user.interests || []).join(", ");
      const userProfile = `
        I'm a ${user.school || "UNC"} student. My interests: ${interestsList}.
        I want to find campus events about: ${interestsList}.
        I'm interested in activities related to: ${interestsList}.
        Looking for opportunities in: ${interestsList}.
        ${user.dorm ? `I live in ${user.dorm} dormitory.` : ""}
        I search for events matching these topics: ${interestsList}.
      `.replace(/\s+/g, " ").trim();

      userEmbedding = await createEmbedding(userProfile);
      await db.collection("users").doc(user.id).update({ 
        embedding: userEmbedding,
        embedding_model: "text-embedding-3-small",
        embedding_version: "v1"
      });
      console.log(`🧩 Created and stored embedding for ${user.name || user.email}`);
    }

    // ✅ Get seen posters
    const seen = new Set(user.shown_posters || []);

    // ✅ Query Pinecone with user embedding
    console.log(`\n📬 Finding matches for ${user.name || user.email}...`);
    
    const schoolFilter = user.school || "UNC-Chapel Hill";
    const schoolNormalized = schoolFilter.toLowerCase().replace(/[\s-]+/g, "");

    try {
      // Query Pinecone for similar posters
      const queryResults = await index.namespace(PINECONE_NAMESPACE).query({
        vector: userEmbedding,
        topK: 50, // Get more results to filter
        includeMetadata: true,
        filter: {
          type: "poster",
          school_normalized: schoolNormalized,
        },
      });

      // ✅ Hyper-accurate filtering and ranking for daily digest
      const userInterests = (user.interests || []).map(i => i.toLowerCase());
      
      const filtered = queryResults.matches
        .filter((match) => {
          // Only posters
          if (match.metadata.type !== "poster") return false;

          // Filter by school
          const matchSchool = match.metadata.school_normalized || "";
          if (matchSchool !== schoolNormalized) return false;

          // Filter out seen posters
          if (seen.has(match.id)) return false;

          // Filter for upcoming events only
          const eventDate = match.metadata.date_normalized;
          if (!eventDate) return true; // Keep events without dates (organizations)

          const eventDateObj = getLocalDateFromISO(eventDate);
          if (!eventDateObj) return false;

          // Keep events today or in the future
          return eventDateObj >= today;
        })
        .map((match) => {
          // ✅ Enhanced scoring with explicit tag/category matching
          let enhancedScore = match.score;
          
          // Check tag matches
          if (match.metadata.tags && userInterests.length > 0) {
            const posterTags = match.metadata.tags.toLowerCase().split(", ").map(t => t.trim());
            const tagMatches = userInterests.filter(interest => 
              posterTags.some(tag => 
                tag.includes(interest) || 
                interest.includes(tag) || 
                tag === interest
              )
            ).length;
            
            if (tagMatches > 0) {
              // Strong boost for tag matches (up to 0.15)
              const tagBoost = Math.min(0.15, tagMatches * 0.05);
              enhancedScore = Math.min(1.0, enhancedScore + tagBoost);
            }
          }
          
          // Check category matches
          if (match.metadata.categories && userInterests.length > 0) {
            const posterCategories = match.metadata.categories.toLowerCase().split(", ").map(c => c.trim());
            const categoryMatches = userInterests.filter(interest => 
              posterCategories.some(cat => 
                cat.includes(interest) || 
                interest.includes(cat)
              )
            ).length;
            
            if (categoryMatches > 0) {
              // Moderate boost for category matches (up to 0.1)
              const catBoost = Math.min(0.1, categoryMatches * 0.03);
              enhancedScore = Math.min(1.0, enhancedScore + catBoost);
            }
          }
          
          // Boost for events happening soon (next 3 days)
          if (match.metadata.date_normalized) {
            const eventDateObj = getLocalDateFromISO(match.metadata.date_normalized);
            if (eventDateObj) {
              const daysUntil = Math.floor((eventDateObj - today) / (1000 * 60 * 60 * 24));
              if (daysUntil >= 0 && daysUntil <= 3) {
                enhancedScore = Math.min(1.0, enhancedScore + 0.05);
              }
            }
          }
          
          return {
            ...match,
            enhancedScore: enhancedScore
          };
        })
        .filter(m => m.enhancedScore >= 0.45) // Quality threshold (slightly lower for digest)
        .sort((a, b) => b.enhancedScore - a.enhancedScore) // Sort by enhanced score
        .slice(0, 3); // Take top 3

      if (filtered.length === 0) {
        console.log(`😎 ${user.name || user.email} — no new matches found.`);
        continue;
      }

      // ✅ Format results for SMS (same format as searchCore.js)
      const topMatches = filtered.map((match) => ({
        id: match.id,
        title: match.metadata.title || "Untitled",
        date_normalized: match.metadata.date_normalized,
        time: match.metadata.time,
        location: match.metadata.location,
        score: match.enhancedScore || match.score,
      }));

      console.log(`\n🏆 Top ${topMatches.length} Matches for ${user.name || user.email}:`);
      topMatches.forEach((match, i) => {
        console.log(
          `   ${i + 1}. ${match.title} (${(match.score * 100).toFixed(1)}% similarity)`
        );
      });

      // ✅ Send SMS
      try {
        const smsMessage = formatEventsForSMS(topMatches, BASE_URL);
        
        if (smsMessage) {
          await twilioClient.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER || "+14244478183",
            to: user.phone,
          });
          
          console.log(`📱 [Daily Digest] SMS sent to ${user.phone} (${smsMessage.length} chars)`);
        }
      } catch (smsError) {
        console.error(`❌ [Daily Digest] Error sending SMS to ${user.phone}:`, smsError);
        // Continue processing other users even if SMS fails
      }

      // ✅ Record shown posters
      if (topMatches.length > 0) {
        await db.collection("users").doc(user.id).update({
          shown_posters: admin.firestore.FieldValue.arrayUnion(
            ...topMatches.map((m) => m.id)
          ),
        });
        console.log(`📝 Updated shown_posters for ${user.name || user.email}`);
      }
    } catch (error) {
      console.error(`❌ Error processing ${user.name || user.email}:`, error);
      continue;
    }
  }

  console.log("\n✅ Daily Digest complete!");
}

// Export for testing
module.exports = { runDailyDigest };

// --- Run if file executed directly ---
if (require.main === module) {
  runDailyDigest().then(() => console.log("\n✅ Done."));
}
