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
  const openai = getOpenAI();
  const embed = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return embed.data[0].embedding;
}

// ---------- intent classifier ----------
async function detectIntent(message) {
  const systemPrompt = `
You are an intent classifier for a college event discovery assistant called TheMove.
Given a text message, categorize it into ONE of these categories only:
- "search": The user is asking about events, what to do, or opportunities.
- "info": Asking what TheMove is or how it works.
- "signup": Asking about sign-up.
- "random": Everything else.

Respond ONLY with: search, info, signup, random.
  `.trim();

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message }
    ]
  });

  return res.choices[0].message.content.trim().toLowerCase();
}

// ---------- TIME extraction ----------
function extractExactTime(query) {
  const q = query.toLowerCase();

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
// 🚀 FULLY DETERMINISTIC DATE EXTRACTOR (NO LLM FOR WEEKDAYS)
// ==========================================================
async function extractExactDate(query) {
  const today = getLocalDate();
  const lower = query.toLowerCase();
  const localISO = today.toISOString().slice(0, 10);

  // ---------------------------
  // 1. Special keywords
  // ---------------------------
  if (lower.includes("tonight")) return today;
  if (lower.includes("tomorrow")) return addDays(today, 1);

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
  // 3. Full DATE provided → let LLM parse it ONLY for calendar dates
  // ---------------------------
  const systemPrompt = `
Today is ${localISO}.
If the user explicitly provides a calendar date like "Nov 22", "11/25", "November 30",
convert it into an ISO date (YYYY-MM-DD).

If NO calendar date is present, respond ONLY with "none".
Never guess weekdays. Never infer context. Never interpret "Friday".
  `.trim();

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query }
    ]
  });

  const out = res.choices[0].message.content.trim();

  if (out === "none") return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(out)) {
    return getLocalDateFromISO(out);
  }

  return null;
}

// ==========================================================
// Core search for SMS
// ==========================================================
async function searchPostersForSMS(query, school) {
  const today = getLocalDate();

  const currentDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const targetDate = await extractExactDate(query);
  const targetTime = extractExactTime(query);

  let expandedQuery = `
    Today’s date is ${currentDate}.
    A ${school} student is looking for a campus event.
    Query: "${query}"
    Match using title, tags, description, date, time, location.
  `.replace(/\s+/g, " ").trim();

  if (targetDate) {
    expandedQuery += ` Only include events happening on ${targetDate.toDateString()}.`;
  }

  const queryEmbedding = await createEmbedding(expandedQuery);

  const results = await index.namespace(PINECONE_NAMESPACE).query({
    vector: queryEmbedding,
    topK: 20,
    includeMetadata: true,
  });

  let filtered = results.matches.filter(
    (m) =>
      m.metadata.type === "poster" &&
      (!m.metadata.school ||
       String(m.metadata.school).toLowerCase() === school.toLowerCase())
  );

  // --- date filter ---
  if (targetDate) {
    filtered = filtered.filter((m) => {
      const d = getLocalDateFromISO(m.metadata.date_normalized);
      return d.toISOString().slice(0,10) === targetDate.toISOString().slice(0,10);
    });
  }

  // --- time filter ---
  if (targetTime) {
    filtered = filtered.filter((m) => {
      const t = m.metadata.time_normalized_start;
      if (!t) return false;

      if (targetTime.operator === "=") return t === targetTime.value;
      if (targetTime.operator === ">=") return t >= targetTime.value;
      if (targetTime.operator === "<=") return t <= targetTime.value;
      return true;
    });
  }

  // --- remove past events ---
  filtered = filtered.filter((m) => {
    const d = getLocalDateFromISO(m.metadata.date_normalized);
    return d >= today;
  });

  const top3 = filtered.sort((a, b) => b.score - a.score).slice(0, 3);

  if (top3.length === 0) {
    return "🙁 I couldn’t find any upcoming events that match. Try asking in a different way or for another day!";
  }

  let msg = `🎯 Top matches at ${school}:\n`;
  top3.forEach((match, i) => {
    msg += `\n${i + 1}. ${match.metadata.title} — ${match.metadata.date_normalized}`;
    if (match.metadata.location) msg += ` @ ${match.metadata.location}`;
    msg += `\nLink: ${BASE_URL}/poster/${match.id}\n`;
  });

  return msg.trim();
}

module.exports = {
  detectIntent,
  searchPostersForSMS,
  extractExactDate,
  extractExactTime
};
