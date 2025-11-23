const express = require("express");
const multer = require("multer");
const cors = require("cors");
const dotenv = require("dotenv");
const { OpenAI } = require("openai");
const sharp = require("sharp");
const cloudinary = require("cloudinary").v2;
const admin = require("firebase-admin");
const { Pinecone } = require("@pinecone-database/pinecone");

console.log("🚀 OPENAI KEY?:", process.env.OPENAI_API_KEY ? "YES" : "NO");

const fs = require("fs");
if (fs.existsSync(".env")) {
  require("dotenv").config();
}

const app = express();
app.use(cors());
app.use(express.static("."));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));   // ⭐️ REQUIRED FOR TWILIO

const upload = multer({ dest: "uploads/" });

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ⭐️ NEW — Twilio
const twilio = require("twilio");
const MessagingResponse = twilio.twiml.MessagingResponse;

// ⭐️ NEW — import your SMS-specific search logic
const { detectIntent, searchPostersForSMS } = require("./searchCore");

// -------------------------
// Cloudinary
// -------------------------

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// -------------------------
// Firebase
// -------------------------

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// -------------------------
// Pinecone
// -------------------------

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";

// -------------------------
// Auth + Guards
// -------------------------

async function cleanupExpiredPosters() {
  const today = new Date();
  const todayString = today.toISOString().split("T")[0];

  console.log("🔍 Checking for expired posters before", todayString);

  const snapshot = await db.collection("posters")
    .where("date_normalized", "<", todayString)
    .get();

  if (snapshot.empty) {
    console.log("✨ No expired posters found.");
    return { deletedCount: 0, pineconeCount: 0 };
  }

  let deletedCount = 0;
  const batch = db.batch();
  const pineconeOps = [];

  snapshot.forEach((doc) => {
    const poster = doc.data();

    if (poster.poster_type !== "event") return; // skip orgs

    console.log(`🗑️ Expired: ${doc.id} (${poster.poster_title})`);

    batch.delete(doc.ref);
    deletedCount++;
    pineconeOps.push(doc.id);
  });

  if (deletedCount > 0) await batch.commit();
  if (pineconeOps.length > 0) {
    await index.namespace(PINECONE_NAMESPACE).deleteMany(pineconeOps);
  }

  console.log(`🔥 Deleted ${deletedCount} posters | Pinecone removed ${pineconeOps.length}`);

  return { deletedCount, pineconeCount: pineconeOps.length };
}


async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
      return res
        .status(401)
        .json({ success: false, message: "Missing or invalid Authorization header" });
    }

    const idToken = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.user = decoded;
    return next();
  } catch (err) {
    console.error("❌ ID token verification failed:", err);
    return res.status(401).json({ success: false, message: "Invalid or expired ID token" });
  }
}

async function ensureUncEmail(req, res, next) {
  try {
    const u = req.user;
    if (!u) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    let email = u.email;
    let emailVerified = u.email_verified;

    if (email === undefined || emailVerified === undefined) {
      const record = await admin.auth().getUser(u.uid);
      email = record.email;
      emailVerified = record.emailVerified;
    }

    if (!email) {
      return res
        .status(400)
        .json({ success: false, message: "No email on account. Please add an email." });
    }

    if (!email.toLowerCase().endsWith("@unc.edu")) {
      return res
        .status(403)
        .json({ success: false, message: "Email must be a @unc.edu address" });
    }

    if (!emailVerified) {
      return res
        .status(403)
        .json({ success: false, message: "Email must be verified" });
    }

    return next();
  } catch (err) {
    console.error("❌ UNC email check failed:", err);
    return res.status(500).json({ success: false, message: "Email check failed" });
  }
}

// -------------------------
// Helper — Embeddings
// -------------------------

async function createEmbedding(text) {
  const openai = getOpenAI();
  const embed = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return embed.data[0].embedding;
}

// -------------------------
// Normalize Poster Data
// -------------------------

function normalizePosterData(data) {
  const mapping = {
    type: "poster_type",
    title: "poster_title",
    org: "organization_name",
    join: "how_to_join",
    meetings: "meeting_times",
    contact: "contact_info",
  };

  for (const key in mapping) {
    if (data[key] !== undefined && data[mapping[key]] === undefined) {
      data[mapping[key]] = data[key];
      delete data[key];
    }
  }

  return data;
}

// -------------------------
// Poster Categorization Map
// -------------------------

function detectPosterCategories(data = {}) {
  const map = {
    Music: ["music", "band", "concert", "song", "choir", "dj"],
    "Business & Innovation": ["startup", "entrepreneur", "business", "finance", "marketing"],
    "Sports & Fitness": ["sport", "game", "fitness", "yoga", "soccer", "basketball", "volleyball", "tournament"],
    "Wellness & Health": ["mental", "wellness", "self-care", "health", "nutrition", "mindfulness"],
    Community: ["community", "heritage", "language", "culture", "campus staff"],
    "Charity & Causes": ["volunteer", "fundraiser", "charity", "service", "cause", "nonprofit", "giving back"],
    Government: ["policy", "government", "politics", "democrat", "republican", "civic"],
    Spirituality: ["faith", "worship", "religion", "spiritual", "church", "meditation"],
    Hobbies: ["art", "painting", "gaming", "travel", "fashion", "writing", "photography", "craft"],
  };

  const combinedText = [
    data.poster_title,
    data.organization_name,
    data.description,
    data.summary_text,
    data.event?.activities?.join(" "),
    (data.tags || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();

  const matched = [];
  for (const [category, keywords] of Object.entries(map)) {
    if (keywords.some((k) => combinedText.includes(k))) matched.push(category);
  }

  return matched.length ? matched : ["General"];
}

// -------------------------
// 🔐 Protected routes
// -------------------------

// ✅ Create user with simplified schema
app.post("/createUser", verifyFirebaseToken, async (req, res) => {
  try {
    const { uid, name, school, year, phone, dorm, interests = [] } = req.body;

    const tokenUid = req.user.uid;
    if (uid && uid !== tokenUid) {
      return res.status(403).json({ success: false, message: "UID mismatch with authenticated user" });
    }
    const finalUid = tokenUid;

    const email = req.user.email || "";
    const verifiedStatus = req.user.email_verified || false;

    const userText = `
      My name is ${name || "a UNC student"}.
      I live in ${dorm || "a dorm"}.
      My interests include ${(interests || []).join(", ")}.
    `.replace(/\s+/g, " ").trim();

    const embedding = await createEmbedding(userText);

    await index.upsert(
      [
        {
          id: finalUid,
          values: embedding,
          metadata: {
            type: "user",
            name: name || "",
            school: school || "UNC-Chapel Hill",
            year: String(year || ""),
            phone: phone || "",
            email: email || "",
            interests: (interests || []).join(", "),
            dorm: dorm || ""
          }
        }
      ],
      { namespace: PINECONE_NAMESPACE }
    );

    const userData = {
      uid: finalUid,
      name,
      school: school || "UNC-Chapel Hill",
      year,
      phone,
      email,
      dorm,
      interests,
      embedding_model: "text-embedding-3-small",
      embedding_version: "v1",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      emailVerified: verifiedStatus
    };

    await db.collection("users").doc(finalUid).set(userData);

    console.log(`👤 Created user: ${name} (${email})`);
    res.json({ success: true, message: "User created successfully." });
  } catch (err) {
    console.error("❌ Error creating user:", err);
    res.status(500).json({ success: false, message: "Error creating user" });
  }
});


// ✅ Update user with category-aware embeddings
// ✅ Simplified updateUser to match current fields
app.post("/updateUser", verifyFirebaseToken, ensureUncEmail, async (req, res) => {
  try {
    const { uid, phone, dorm, interests = [], dailyDigestOptIn } = req.body;
    const tokenUid = req.user.uid;

    if (uid && uid !== tokenUid) {
      return res.status(403).json({ success: false, message: "UID mismatch with authenticated user" });
    }
    const finalUid = tokenUid;

    const email = req.user.email || "";
    const verifiedStatus = req.user.email_verified || false;

    // Optional: skip creating embeddings every save if unnecessary
    const userText = `I'm a UNC student living in ${dorm || "a dorm"} who enjoys ${(interests || []).join(", ")}.`;
    const embedding = await createEmbedding(userText);

    const userData = {
      uid: finalUid,
      email,
      phone,
      dorm,
      interests,
      embedding_model: "text-embedding-3-small",
      embedding_version: "v1",
      emailVerified: verifiedStatus,
      dailyDigestOptIn: !!dailyDigestOptIn,
      updated_at: new Date().toISOString()
    };

    await db.collection("users").doc(finalUid).set(userData, { merge: true });

    await index.upsert([
      {
        id: finalUid,
        values: embedding,
        metadata: {
          type: "user",
          email,
          phone,
          dorm,
          interests: (interests || []).join(", ")
        }
      }
    ], { namespace: PINECONE_NAMESPACE });

    console.log(`🧩 Updated ${email} — profile saved`);
    res.json({ success: true, message: "Profile updated successfully" });
  } catch (err) {
    console.error("❌ Error updating user:", err);
    res.status(500).json({ success: false, message: "Error updating user" });
  }
});


// -------------------------
// 🌐 Public routes
// -------------------------

app.post("/extract", upload.single("poster"), async (req, res) => {
  try {
    const { school } = req.body; // ✅ Capture school from the upload form

    const filePath = req.file.path;
    const compressedPath = `${filePath}-small.jpg`;

    await sharp(filePath)
      .resize({ width: 800 })
      .jpeg({ quality: 70 })
      .toFile(compressedPath);

    const base64 = fs.readFileSync(compressedPath, { encoding: "base64" });
    const imageData = `data:image/jpeg;base64,${base64}`;

    // ✅ Include current date context for accurate year inference
    const today = new Date();
    const currentDate = today.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // ---------- NEW DATE-YEAR HELPER ----------
    function inferDateYear(rawDate) {
      if (!rawDate) return null;

      // Parse the AI-returned date
      const extracted = new Date(rawDate + "T12:00:00");
      if (isNaN(extracted.getTime())) return null;

      const now = new Date();

      // Detect if AI already included an explicit year
      const explicitYear = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);

      // If poster explicitly includes a year → ALWAYS respect it
      if (explicitYear) return extracted;

      // No explicit year: infer relative to the academic year
      const thisYear = now.getFullYear();
      const candidate = new Date(thisYear, extracted.getMonth(), extracted.getDate());

      // If upcoming → use this year
      if (candidate >= now) return candidate;

      // If passed but only by < 30 days → still this year
      const diffDays = (now - candidate) / (1000 * 60 * 60 * 24);
      if (diffDays < 30) return candidate;

      // Otherwise treat it as stale
      return null;
    }
    // ----------------------------------------------------------

    // ✅ UNC residence buildings list for location_building
    const UNC_BUILDINGS = [
      "Alderman",
      "Alexander",
      "Avery",
      "Carmichael",
      "Cobb",
      "Connor",
      "Craige",
      "Craige North",
      "Ehringhaus",
      "Everett",
      "Graham",
      "Grimes",
      "Hardin",
      "Hinton James",
      "Horton",
      "Joyner",
      "Kenan",
      "Koury",
      "Lewis",
      "Mangum",
      "Manly",
      "McClinton",
      "McIver",
      "Morrison",
      "Old East",
      "Old West",
      "Parker",
      "Ram Village",
      "Ruffin Jr.",
      "Spencer",
      "Stacy",
      "Taylor",
      "Teague",
    ];

    // ✅ Helper: normalize start time to 24h "HH:MM"
    const normalizeStartTime = (timeStr) => {
      if (!timeStr || typeof timeStr !== "string") return "";

      const lower = timeStr.toLowerCase().trim();
      const firstPart = lower.split(/-|–|—/)[0].trim();

      const match = firstPart.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (!match) return "";

      let hour = parseInt(match[1], 10);
      let minutes = match[2] ? parseInt(match[2], 10) : 0;
      const suffix = match[3] ? match[3].toLowerCase() : null;

      if (suffix === "pm" && hour < 12) hour += 12;
      else if (suffix === "am" && hour === 12) hour = 0;
      else if (!suffix && (hour < 0 || hour > 23)) return "";

      const hh = String(hour).padStart(2, "0");
      const mm = String(minutes).padStart(2, "0");
      return `${hh}:${mm}`;
    };

    // ✅ Use AI for full structured extraction — event/org + tags + categories
    const prompt = `
Today’s date is ${currentDate}.
This poster was likely created for events happening around the current semester or year.

Analyze this college poster and return structured JSON only — no explanations.

Determine if it represents an **event** or an **organization**:
- If it lists a date, time, or location → "poster_type": "event"
- Otherwise → "poster_type": "organization"

Always include:
- "poster_title"
- "poster_type"
- "organization_name"
- "description" or "summary_text"
- "date", "time", "location" (for events)
- "how_to_join", "meeting_times", "contact_info" (for organizations)
- "tags": 3–7 short keywords summarizing the main ideas, themes, or vibes
- "categories": 1–3 from defined list
- "audience"
- "cost"
- "frequency"

Return only valid JSON.
If a date is present, keep ISO format (YYYY-MM-DD).
    `.trim();
    const openai = getOpenAI();
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "Extract structured data from college posters and return clean JSON only.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageData } },
          ],
        },
      ],
      temperature: 0.2,
    });

    if (response.usage) {
      const { prompt_tokens, completion_tokens, total_tokens } = response.usage;
      const estimatedCost =
        (prompt_tokens / 1_000_000) * 0.00015 +
        (completion_tokens / 1_000_000) * 0.0006;
      console.log(`💰 Usage — Prompt: ${prompt_tokens}, Completion: ${completion_tokens}, Total: ${total_tokens}`);
      console.log(`💵 Estimated GPT-4o-mini cost: ~$${estimatedCost.toFixed(6)} per poster`);
    }

    const text = response.choices?.[0]?.message?.content ?? "{}";
    let clean = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let data;
    try {
      data = JSON.parse(clean);
    } catch {
      console.error("❌ Failed to parse JSON:", clean);
      data = { error: "Could not parse JSON" };
    }

    data = normalizePosterData(data);

    // ✅ Add school info manually (from dropdown)
    data.school = school || "UNC-Chapel Hill";
    data.school_normalized = data.school.toLowerCase().replace(/[\s-]+/g, "");

    // ---------- NEW DATE NORMALIZATION ----------
    if (data.date) {
      const inferred = inferDateYear(data.date);
      if (inferred) {
        const year = inferred.getFullYear();
        const month = String(inferred.getMonth() + 1).padStart(2, "0");
        const day = String(inferred.getDate()).padStart(2, "0");
        data.date_normalized = `${year}-${month}-${day}`;
      }
    }
    delete data.date;
    // ------------------------------------------------

    // ✅ Normalize time start (HH:MM 24h)
    data.time_normalized_start = data.time ? normalizeStartTime(data.time) : "";

    // ✅ Normalize location building (from list)
    if (data.location) {
      const locLower = data.location.toLowerCase();
      const foundBuilding = UNC_BUILDINGS.find((b) =>
        locLower.includes(b.toLowerCase())
      ) || "";
      data.location_building = foundBuilding;
    } else {
      data.location_building = "";
    }

    // ✅ Upload image to Cloudinary
    const uploadResult = await cloudinary.uploader.upload(compressedPath, {
      folder: "posters",
      resource_type: "image",
    });

    data.poster_image_url = uploadResult.secure_url;
    data.timestamp = new Date().toISOString();

    // ✅ Save to Firestore
    const docRef = await db.collection("posters").add(data);
    const posterUrl = `https://api.usethemove.com/${docRef.id}`;
    await docRef.update({ poster_url: posterUrl });
    data.poster_url = posterUrl;

    // ✅ Create embedding text
    const textToEmbed = `
      ${data.poster_title ?? ""} 
      ${data.organization_name ?? ""} 
      ${data.description ?? data.summary_text ?? ""} 
      Event Date: ${
        data.date_normalized
          ? new Date(data.date_normalized + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : ""
      }
      Event Time: ${data.time || ""}
      Location: ${data.location || ""}
      Audience: ${data.audience || ""}
      Cost: ${data.cost || ""}
      Frequency: ${data.frequency || ""}
      Keywords: ${(data.tags ?? []).join(", ")}.
      Categories: ${(data.categories ?? []).join(", ")}.
      Type: ${data.poster_type ?? "general"}.
    `
      .replace(/\s+/g, " ")
      .trim();

    const embedding = await createEmbedding(textToEmbed);

    // ✅ Update Firestore + Pinecone
    await db.collection("posters").doc(docRef.id).update({
      embedded_text: textToEmbed,
      embedding_model: "text-embedding-3-small",
      embedding_version: "v1",
      categories: data.categories || [],
      date_normalized: data.date_normalized || "",
      school_normalized: data.school_normalized,
      time_normalized_start: data.time_normalized_start || "",
      location_building: data.location_building || "",
    });

    await index.upsert(
      [
        {
          id: docRef.id,
          values: embedding,
          metadata: {
            type: "poster",
            title: data.poster_title || "Untitled",
            poster_type: data.poster_type || "unknown",
            organization_name: data.organization_name || "",
            date_normalized: data.date_normalized || "",
            time: data.time || "",
            time_normalized_start: data.time_normalized_start || "",
            location: data.location || "",
            location_building: data.location_building || "",
            audience: data.audience || "",
            cost: data.cost || "",
            frequency: data.frequency || "",
            categories: (data.categories || []).join(", "),
            tags: (data.tags || []).join(", "),
            school: data.school,
            school_normalized: data.school_normalized,
          },
        },
      ],
      { namespace: PINECONE_NAMESPACE }
    );

    fs.unlinkSync(filePath);
    fs.unlinkSync(compressedPath);

    console.log(`🧠 Poster embedded → Pinecone | ID: ${docRef.id}`);
    res.json({ ...data, firestore_id: docRef.id });
  } catch (err) {
    console.error("❌ Error extracting info:", err);
    res.status(500).send("Error extracting info.");
  }
});

// -------------------------
// Remaining routes unchanged
// -------------------------

app.get("/poster/:id", async (req, res) => {
  try {
    const doc = await db.collection("posters").doc(req.params.id).get();
    if (!doc.exists) return res.status(404).send("Poster not found.");

    const poster = doc.data();
    const isEvent = poster.poster_type === "event";
    const shareMessage = `Check out this poster on TheMove!`;
    const fullMessage = `${shareMessage} ${poster.poster_url}`;

    res.send(`
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${poster.poster_title || "Poster"} - TheMove</title>

    <!-- ✅ Tailwind + Fonts -->
    <script src="https://cdn.tailwindcss.com"></script>
    <link
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap"
      rel="stylesheet"
    />
    <link
      rel="stylesheet"
      href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"
    />
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: { sans: ["Poppins", "sans-serif"] },
            colors: {
              primary: "#4F46E5",
              accent: "#3B82F6",
              background: "#FAFAFA",
              dark: "#1E1B4B",
            },
          },
        },
      };
    </script>
    <style>
      body {
        background: #fafafa;
        font-family: "Poppins", sans-serif;
        overflow: hidden;
      }
      .banner {
        background: linear-gradient(90deg, #4f46e5, #6366f1, #4f46e5);
        background-size: 200% 200%;
        animation: shimmer 6s ease infinite;
      }
      @keyframes shimmer {
        0% { background-position: 0% 50%; }
        50% { background-position: 100% 50%; }
        100% { background-position: 0% 50%; }
      }
    </style>
  </head>

  <body class="flex flex-col min-h-screen text-gray-800">
    <!-- ✅ Navbar -->
    <header class="flex justify-between items-center px-6 py-4 bg-white shadow-md">
      <a href="/index.html" class="text-2xl font-bold text-primary tracking-tight hover:text-indigo-700 transition">
        TheMove
      </a>
      <nav class="flex items-center gap-4">
        <a href="/login.html" class="text-gray-600 hover:text-primary font-medium">Login</a>
        <a
          href="/signup.html"
          class="bg-primary text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition"
        >Join</a>
      </nav>
    </header>

    <!-- 💜 Promo Banner -->
    <div class="banner w-full text-white text-center py-2 px-3 text-[0.9rem] font-medium shadow-md">
      👋 Discover events like this anytime with <b>TheMove</b> —
      Text <span class="underline font-semibold">+1 (555) 123-MOVE</span> for AI-powered campus recommendations 🎓
    </div>

    <!-- ✅ Poster Card -->
    <main class="flex-grow flex flex-col items-center justify-center px-6 py-4">
      <div class="bg-white border border-gray-100 rounded-2xl shadow-md p-6 w-full max-w-md text-center">
        <h1 class="text-lg font-semibold text-dark mb-4">${poster.poster_title || "Untitled Poster"}</h1>

        <img
          src="${poster.poster_image_url}"
          alt="Poster"
          class="rounded-xl w-full object-contain max-h-[43vh] mb-5 shadow-sm"
        />

        <div class="text-left text-sm text-gray-700 leading-relaxed space-y-1.5">
          <p><b>Organization:</b> ${poster.organization_name || "N/A"}</p>
          ${
            isEvent
              ? `
                <p><b>Date:</b> ${poster.date_normalized || "TBA"} ${poster.time || ""}</p>
                <p><b>Location:</b> ${poster.location || "TBA"}</p>
                <p><b>Description:</b> ${poster.summary_text || poster.description || "No description available."}</p>
              `
              : `
                <p><b>Mission:</b> ${poster.description || "No mission provided."}</p>
                <p><b>How to Join:</b> ${poster.how_to_join || "No joining details."}</p>
                <p><b>Meetings:</b> ${poster.meeting_times || "No meeting info."}</p>
                <p><b>Contact:</b> ${poster.contact_info || "No contact info."}</p>
              `
          }
        </div>

        <!-- ✅ Share Button -->
        <div class="mt-5 flex justify-center">
          <button
            onclick="openShare()"
            class="bg-primary text-white flex items-center gap-2 px-6 py-2 rounded-xl hover:bg-indigo-700 transition shadow-md"
          >
            <i class="fa-solid fa-share-nodes"></i> Share
          </button>
        </div>
      </div>
    </main>

    <!-- ✅ Share Modal -->
    <div
      id="shareModal"
      class="hidden fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50"
    >
      <div class="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 text-center relative">
        <button
          onclick="closeShare()"
          class="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-xl"
        >&times;</button>
        <h2 class="text-lg font-semibold text-dark mb-5">Share with friends</h2>
        <div class="flex justify-center gap-5 text-xl text-primary mb-4">
          <a href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(poster.poster_url)}"
             target="_blank" class="hover:scale-110 transition"><i class="fab fa-facebook"></i></a>
          <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(poster.poster_url)}"
             target="_blank" class="hover:scale-110 transition"><i class="fab fa-linkedin"></i></a>
          <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(`${poster.poster_title} — ${shareMessage}`)}&url=${encodeURIComponent(poster.poster_url)}"
             target="_blank" class="hover:scale-110 transition"><i class="fab fa-x-twitter"></i></a>
          <a href="mailto:?subject=${encodeURIComponent(`Check out this event on TheMove!`)}&body=${encodeURIComponent(fullMessage)}"
             target="_blank" class="hover:scale-110 transition"><i class="fas fa-envelope"></i></a>
        </div>
        <div class="flex items-center justify-between border rounded-lg px-4 py-2 text-sm text-gray-600">
          <span class="truncate">${poster.poster_url}</span>
          <button
            onclick="navigator.clipboard.writeText('${poster.poster_url}'); showToast('✅ Link copied!')"
            class="text-primary hover:underline"
          >Copy</button>
        </div>
      </div>
    </div>

    <!-- ✅ Toast -->
    <div
      id="toast"
      class="hidden fixed bottom-5 left-1/2 -translate-x-1/2 bg-green-100 text-green-700 text-sm px-4 py-2 rounded-xl shadow-md"
    ></div>

    <!-- ✅ JS -->
    <script>
      function openShare() {
        document.getElementById("shareModal").classList.remove("hidden");
      }
      function closeShare() {
        document.getElementById("shareModal").classList.add("hidden");
      }
      function showToast(message) {
        const toast = document.getElementById("toast");
        toast.textContent = message;
        toast.classList.remove("hidden");
        setTimeout(() => toast.classList.add("hidden"), 2000);
      }
    </script>
  </body>
</html>
    `);
  } catch (err) {
    console.error("❌ Error fetching poster:", err);
    res.status(500).send("Error loading poster.");
  }
});


app.get("/getUser/:uid", async (req, res) => {
  try {
    const doc = await db.collection("users").doc(req.params.uid).get();
    if (!doc.exists) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.json(doc.data());
  } catch (err) {
    console.error("❌ Error fetching user:", err);
    res.status(500).json({ success: false, message: "Error fetching user" });
  }
});

app.get("/checkUserByPhone", async (req, res) => {
  try {
    let phone = req.query.phone;
    if (!phone) return res.status(400).json({ exists: false, message: "Phone number required" });

    phone = phone.replace(/\s+/g, "");
    const normalizedVariants = [phone];

    if (!phone.startsWith("+1")) {
      normalizedVariants.push("+1" + phone);
    } else {
      normalizedVariants.push(phone.replace(/^\+1/, ""));
    }

    const snapshot = await db.collection("users").where("phone", "in", normalizedVariants).get();

    if (snapshot.empty) return res.json({ exists: false });

    res.json({ exists: true });
  } catch (err) {
    console.error("❌ Error checking phone:", err);
    res.status(500).json({ exists: false, message: "Error checking user" });
  }
});

app.get("/checkUserSetup", async (req, res) => {
  try {
    const uid = req.query.uid;
    if (!uid) return res.json({ setupComplete: false });

    const userRef = db.collection("users").doc(uid);
    const doc = await userRef.get();
    if (!doc.exists) return res.json({ setupComplete: false });

    const data = doc.data();
    const setupComplete = !!(data.interests && data.dorm);
    res.json({ setupComplete });
  } catch (err) {
    console.error("❌ Error checking setup:", err);
    res.status(500).json({ setupComplete: false });
  }
});

app.post("/deleteAccount", verifyFirebaseToken, async (req, res) => {
  try {
    const uid = req.user.uid;

    // 🧹 1. Delete from Firestore
    await db.collection("users").doc(uid).delete();

    // 🧹 2. Delete from Pinecone (if exists)
    try {
      await index.namespace(PINECONE_NAMESPACE).deleteOne(uid);
      console.log(`🧽 Removed user ${uid} from Pinecone`);
    } catch (pineErr) {
      console.warn("⚠️ Pinecone deletion skipped or failed:", pineErr.message);
    }

    // 🧹 3. Delete from Firebase Auth
    await admin.auth().deleteUser(uid);

    console.log(`🗑️ Account deleted: ${uid}`);
    res.json({ success: true, message: "Account deleted successfully." });
  } catch (err) {
    console.error("❌ Error deleting account:", err);
    res.status(500).json({ success: false, message: "Error deleting account." });
  }
});

// ⭐️ DAILY DIGEST STOP + HELP HANDLER
app.post("/sms/inbound", async (req, res) => {
  const body = (req.body.Body || "").trim().toLowerCase();
  const from = req.body.From;

  // Look up user by phone #
  const snapshot = await db.collection("users").where("phone", "==", from).get();
  const userDoc = snapshot.empty ? null : snapshot.docs[0];

  const twiml = new MessagingResponse();

  if (!userDoc) {
    twiml.message("You're not registered with TheMove.");
    return res.type("text/xml").send(twiml.toString());
  }

  const ref = userDoc.ref;

  if (body === "stop") {
    await ref.update({ dailyDigestOptIn: false });
    twiml.message("You've been unsubscribed from TheMove Daily Digest. Reply START to rejoin.");
    return res.type("text/xml").send(twiml.toString());
  }

  if (body === "help") {
    twiml.message(
      "You’re chatting with TheMove! Daily Digest 1 msg/day. Reply STOP to unsubscribe. Msg&data rates may apply."
    );
    return res.type("text/xml").send(twiml.toString());
  }

  // Not STOP or HELP → pass through to normal /sms handling
  return res.send("");
});

app.post("/sms", async (req, res) => {
  const twiml = new MessagingResponse();
  const incoming = (req.body.Body || "").trim().toLowerCase();

  // ⭐️ STOP / HELP already handled by /sms/inbound — swallow them here
  if (incoming === "stop" || incoming === "help") {
    return res.type("text/xml").send("");
  }

  try {
    const school = "UNC-Chapel Hill"; // hardcoded for now
    const incomingRaw = (req.body.Body || "").trim(); // preserve original capitalization

    if (!incomingRaw) {
      twiml.message("Tell me what you're looking for on campus 🙂");
    } else {
      const intent = await detectIntent(incomingRaw);

      if (intent === "info") {
        twiml.message(
          "I'm TheMove! Text me something like “poker tonight?” or “volunteer this weekend.”"
        );
      } else if (intent === "signup") {
        twiml.message("You can sign up at https://usethemove.com/signup 🚀");
      } else if (intent === "random") {
        twiml.message("Try asking about campus events 🙂");
      } else {
        const reply = await searchPostersForSMS(incomingRaw, school);
        twiml.message(reply);
      }
    }
  } catch (err) {
    console.error("❌ Twilio /sms error:", err);
    twiml.message("Something went wrong — try again soon.");
  }

  res.type("text/xml");
  res.send(twiml.toString());
});


app.post("/chatJSON", async (req, res) => {
  try {
    const incoming = req.body.message || "";
    const intent = await detectIntent(incoming);
    const school = "UNC-Chapel Hill";

    let reply = "";

    if (intent === "info") reply = "I'm TheMove! Ask me something like “pizza events tonight”!";
    else if (intent === "signup") reply = "Sign up free at https://usethemove.com/signup 🚀";
    else if (intent === "random") reply = "Try asking about campus events 🙂";
    else reply = await searchPostersForSMS(incoming, school);

    res.json({ reply });
  } catch (err) {
    console.error("❌ chatJSON error:", err);
    res.json({ reply: "Something went wrong — try again soon." });
  }
});

app.post("/cleanupExpiredPosters", async (req, res) => {
  try {
    const result = await cleanupExpiredPosters();
    res.json({
      success: true,
      ...result,
      message: `Expired cleanup complete. ${result.deletedCount} removed.`,
    });
  } catch (err) {
    console.error("❌ Cleanup error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

