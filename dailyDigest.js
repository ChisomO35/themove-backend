const fs = require("fs");
const dotenv = require("dotenv");
const admin = require("firebase-admin");
const { OpenAI } = require("openai");

dotenv.config();

// --- Set base URL for poster links ---
const BASE_URL = process.env.PUBLIC_APP_URL || "https://api.usethemove.com";


// --- Initialize Firebase ---
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(
    fs.readFileSync("./firebase-service-account.json", "utf-8")
  );
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const db = admin.firestore();
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// --- Helper: get all posters (no time filter) ---
async function getAllPosters() {
  const snapshot = await db.collection("posters").get();
  const posters = snapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
  console.log(`📋 Found ${posters.length} total posters`);
  return posters;
}

// --- Helper: create embedding ---
async function createEmbedding(text) {
  const openai = getOpenAI();
  const res = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return res.data[0].embedding;
}

// --- Main function ---
async function runDailyDigest() {
  console.log("🧠 Running Daily Digest...");

  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const posters = await getAllPosters();

  if (posters.length === 0) {
    console.log("😴 No posters found.");
    return;
  }

  for (const user of users) {
    // ✅ NEW — Skip users who did not opt in
    if (!user.dailyDigestOptIn) {
      console.log(`⏭️ Skipping ${user.name} — not opted in`);
      continue;
    }

    // ✅ Ensure user embedding exists or create one
    let userEmbedding = user.embedding;
    if (!userEmbedding) {
      const userProfile = `
        Name: ${user.name}. 
        School: ${user.school}. 
        Year: ${user.year}. 
        Interests: ${(user.interests || []).join(", ")}.
        Looking for campus events and opportunities.
      `.replace(/\s+/g, " ").trim();

      userEmbedding = await createEmbedding(userProfile);
      await db.collection("users").doc(user.id).update({ embedding: userEmbedding });
      console.log(`🧩 Created missing embedding for ${user.name}`);
    }

    console.log(`\n📬 Similarity results for ${user.name}:`);
    const similarities = [];

    // ✅ Skip posters already shown
    const seen = new Set(user.shown_posters || []);
    const unseenPosters = posters.filter((p) => !seen.has(p.id));

    if (unseenPosters.length === 0) {
      console.log(`😎 ${user.name} has already seen all posters.`);
      continue;
    }

    // ✅ Loop through unseen posters
    for (const poster of unseenPosters) {
      const posterText = `
        ${poster.poster_title || ""} 
        ${poster.organization_name || ""} 
        ${poster.event_name || ""} 
        ${poster.description || poster.summary_text || ""} 
        ${(poster.tags || []).join(", ")} 
        Audience: ${poster.audience || ""} 
        Cost: ${poster.cost || ""} 
        Frequency: ${poster.frequency || ""} 
        Date: ${poster.date_normalized || poster.date || ""} 
        Time: ${poster.time || ""} 
        Location: ${poster.location || ""} 
        Type: ${poster.poster_type || ""}
      `.replace(/\s+/g, " ").trim();

      const posterEmbedding = await createEmbedding(posterText);

      // ✅ Compute cosine similarity manually
      const dot = userEmbedding.reduce(
        (sum, val, i) => sum + val * posterEmbedding[i],
        0
      );
      const normA = Math.sqrt(
        userEmbedding.reduce((sum, val) => sum + val * val, 0)
      );
      const normB = Math.sqrt(
        posterEmbedding.reduce((sum, val) => sum + val * val, 0)
      );
      const similarity = dot / (normA * normB);

      similarities.push({
        id: poster.id,
        title: poster.poster_title || "Untitled",
        similarity,
        url: poster.poster_url || `${BASE_URL}/poster/${poster.id}`,
      });

      console.log(
        `   → ${poster.poster_title || "Untitled"} (${(similarity * 100).toFixed(
          1
        )}% similarity)`
      );
    }

    // ✅ Sort and take top 3
    const topMatches = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3);

    console.log(`\n🏆 Top 3 Matches for ${user.name}:`);
    topMatches.forEach((match, i) => {
      console.log(
        `   ${i + 1}. ${match.title} (${(match.similarity * 100).toFixed(
          1
        )}% similarity)\n      🔗 ${match.url}`
      );
    });

    // ✅ Record shown posters
    if (topMatches.length > 0) {
      await db.collection("users").doc(user.id).update({
        shown_posters: admin.firestore.FieldValue.arrayUnion(
          ...topMatches.map((m) => m.id)
        ),
      });
      console.log(`📝 Updated shown_posters for ${user.name}`);
    }
  }
}

// --- Run if file executed directly ---
if (require.main === module) {
  runDailyDigest().then(() => console.log("\n✅ Done."));
}
