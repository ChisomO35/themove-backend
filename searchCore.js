// searchCore.js
const dotenv = require("dotenv");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

dotenv.config();

// --- Init clients (same as in search.js) ---
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";

// ---------- helpers copied in spirit from search.js ----------

// Embeddings
async function createEmbedding(text) {
  const openai = getOpenAI();
  const embed = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return embed.data[0].embedding;
}

// Intent classifier – same categories as your CLI
async function detectIntent(message) {
  const systemPrompt = `
You are an intent classifier for a college event discovery assistant called TheMove.
Given a text message, categorize it into ONE of these categories only:
- "search": The user expresses interest in doing something on campus or asks about events, clubs, or opportunities.
- "info": Asking what TheMove is or how it works.
- "signup": Asking how to sign up.
- "random": Jokes, greetings, gibberish.

If the message implies an activity or interest, classify as "search".
Respond ONLY with: search, info, signup, or random.
  `.trim();

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: message },
    ],
  });

  return res.choices[0].message.content.trim().toLowerCase();
}

// Time extractor – same idea as in search.js
function extractExactTime(query) {
  const q = query.toLowerCase();

  const explicitTime = q.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!explicitTime) return null;

  let hour = parseInt(explicitTime[1], 10);
  let minute = explicitTime[2] ? parseInt(explicitTime[2], 10) : 0;
  const suffix = explicitTime[3];

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  const normalized = `${String(hour).padStart(2, "0")}:${String(
    minute
  ).padStart(2, "0")}`;

  if (q.includes("after")) return { operator: ">=", value: normalized };
  if (q.includes("before")) return { operator: "<=", value: normalized };

  return { operator: "=", value: normalized };
}

// Date extractor – same behavior pattern as your version
async function extractExactDate(query) {
  const today = new Date();
  const localISO = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  const systemPrompt = `
You return exactly one ISO date for a student's query.
If no specific date is given, respond "none".
Rules:
- "Tonight" → today's date (${localISO})
- "Tomorrow" → +1 day
- Weekdays → next occurrence
- Full dates → this year unless already passed.
Only output YYYY-MM-DD or "none".
  `.trim();

  const openai = getOpenAI();
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: query },
    ],
  });

  const content = res.choices[0].message.content.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(content)) {
    return new Date(content);
  }

  const weekdays = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  const lower = query.toLowerCase();
  const found = weekdays.findIndex((d) => lower.includes(d));
  if (found !== -1) {
    const result = new Date(today);
    const diff = (found + 7 - today.getDay()) % 7 || 7;
    result.setDate(today.getDate() + diff);
    return result;
  }

  return null;
}

// Core search for SMS – mirrors your filters but RETURNS TEXT
async function searchPostersForSMS(query, school) {
  const today = new Date();
  const currentDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const targetDate = await extractExactDate(query);
  const targetTime = extractExactTime(query);

  let expandedQuery = `
    Today’s date is ${currentDate}.
    A ${school} student is searching for a campus event or organization.
    Query: "${query}"
    Match using: title, tags, description, date, time, location, org name, type.
    If a date is mentioned, only match that date.
  `
    .replace(/\s+/g, " ")
    .trim();

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

  if (targetDate) {
    filtered = filtered.filter((m) => {
      const dateStr = m.metadata.date_normalized;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return (
        d.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10)
      );
    });
  }

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

  // remove past events
  filtered = filtered.filter((m) => {
    const d = new Date(m.metadata.date_normalized);
    return d >= today;
  });

  const top3 = filtered.sort((a, b) => b.score - a.score).slice(0, 3);

  if (top3.length === 0) {
    return "🙁 I couldn’t find any upcoming events that match. Try asking in a different way or for another day!";
  }

  let msg = `🎯 Top matches at ${school}:\n`;
  top3.forEach((match, i) => {
    const date = match.metadata.date_normalized || "TBA";
    msg += `\n${i + 1}. ${match.metadata.title} — ${date}`;
    if (match.metadata.location) {
      msg += ` @ ${match.metadata.location}`;
    }
    msg += `\nLink: https://localhost:3000/poster/${match.id}\n`;
  });

  return msg.trim();
}

module.exports = {
  detectIntent,
  searchPostersForSMS,
};
