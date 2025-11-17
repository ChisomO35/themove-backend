// searchChat.js
const fs = require("fs");
const readline = require("readline");
const dotenv = require("dotenv");
const { Pinecone } = require("@pinecone-database/pinecone");
const { OpenAI } = require("openai");

dotenv.config();

// --- Active schools list ---
const ACTIVE_SCHOOLS = (process.env.ACTIVE_SCHOOLS || "UNC-Chapel Hill")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// --- Initialize clients ---
function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pc.index(process.env.PINECONE_INDEX);
const PINECONE_NAMESPACE = process.env.PINECONE_NAMESPACE || "campus";

// --- Helpers ---
async function createEmbedding(text) {
  const openai = getOpenAI();
  const embed = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return embed.data[0].embedding;
}

// --- Intent classification helper ---
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

// --- NEW: Extract explicit time only ---
function extractExactTime(query) {
  const q = query.toLowerCase();

  // direct HH:MM or HHpm style
  const explicitTime = q.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (!explicitTime) return null;

  let hour = parseInt(explicitTime[1], 10);
  let minute = explicitTime[2] ? parseInt(explicitTime[2], 10) : 0;
  const suffix = explicitTime[3];

  if (suffix === "pm" && hour < 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;

  const normalized = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  // detect "after X" or "before X"
  if (q.includes("after") || q.includes(">= ")) {
    return { operator: ">=", value: normalized };
  }
  if (q.includes("before") || q.includes("<= ")) {
    return { operator: "<=", value: normalized };
  }

  // direct equality (e.g. "at 7pm")
  return { operator: "=", value: normalized };
}

// --- Helper: extract date using GPT ---
async function extractExactDate(query) {
  const today = new Date();

  const localISO = new Date(today.getTime() - today.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);

  const todayPretty = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

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
  console.log(`🧠 GPT raw date output: "${content}" for query "${query}"`);

  if (/^\d{4}-\d{2}-\d{2}$/.test(content)) {
    return new Date(content);
  }

  // weekday fallback
  const weekdays = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
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

// --- Main search function ---
async function searchPosters(query, school) {
  const today = new Date();
  const currentDate = today.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // date + time extraction
  const targetDate = await extractExactDate(query);
  const targetTime = extractExactTime(query);

  let expandedQuery = `
    Today’s date is ${currentDate}.
    A ${school} student is searching for a campus event or organization.
    Query: "${query}"
    Match using: title, tags, description, date, time, location, org name, type.
    If a date is mentioned, only match that date.
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

  // Filter by school
  let filtered = results.matches.filter(
    (m) =>
      m.metadata.type === "poster" &&
      (!m.metadata.school ||
        String(m.metadata.school).toLowerCase() === school.toLowerCase())
  );

  // strict date filter
  if (targetDate) {
    filtered = filtered.filter((m) => {
      const dateStr = m.metadata.date_normalized;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d.toISOString().slice(0, 10) === targetDate.toISOString().slice(0, 10);
    });
  }

  // strict time filter (OPTION 1)
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
    console.log(`🙁 No posters found for ${school}. Try another search.\n`);
    return;
  }

  console.log(`\n🎯 Top 3 Matches for "${query}" (${school}):`);
  top3.forEach((match, i) => {
    const date = match.metadata.date_normalized || "N/A";
    console.log(
      `${i + 1}. ${match.metadata.title} — 📅 ${date} (${(match.score * 100).toFixed(1)}%)`
    );
    console.log(`🔗 ${process.env.PUBLIC_APP_URL}/${match.id}\n`);
  });
}

// --- Local session handling ---
function loadSession() {
  try {
    const data = fs.readFileSync("./session.json", "utf-8");
    return JSON.parse(data);
  } catch {
    return { school: null, searches: 0 };
  }
}

function saveSession(session) {
  fs.writeFileSync("./session.json", JSON.stringify(session, null, 2));
}

// --- School picker ---
async function pickSchool(rl) {
  console.log("🏫 Select your school:");
  ACTIVE_SCHOOLS.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));

  const answer = await new Promise((resolve) =>
    rl.question("Type the number of your school: ", resolve)
  );

  const idx = parseInt(answer, 10);
  if (!Number.isInteger(idx) || idx < 1 || idx > ACTIVE_SCHOOLS.length) {
    console.log("❌ Invalid selection.\n");
    return pickSchool(rl);
  }
  return ACTIVE_SCHOOLS[idx - 1];
}

// --- Chat loop ---
async function startChat() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let session = loadSession();

  if (!session.school) {
    session.school = await pickSchool(rl);
    saveSession(session);
  }

  console.log(
    `\n👋 Hi! You can search up to 3 times before signing up.\nSchool set to: ${session.school}\n`
  );

  async function askQuery() {
    if (session.searches >= 3) {
      console.log(
        "🚫 You’ve reached your 3-search limit. Sign up for FREE at https://usethemove.com/signup!"
      );
      rl.close();
      return;
    }

    rl.question("💬 Message TheMove: ", async (query) => {
      if (!query.trim()) {
        console.log("Please enter something!");
        return askQuery();
      }

      const intent = await detectIntent(query);

      if (intent === "info") {
        console.log("💡 TheMove helps you discover campus events!\n");
      } else if (intent === "signup") {
        console.log("🚀 Sign up free at https://usethemove.com/signup\n");
      } else if (intent === "random") {
        console.log("🤔 Not sure what you mean—try asking about events!\n");
      } else if (intent === "search") {
        await searchPosters(query, session.school);
        session.searches += 1;
        saveSession(session);
      }

      if (session.searches < 3) {
        console.log(`(${3 - session.searches} searches left)\n`);
        askQuery();
      } else {
        console.log("🚫 Search limit reached. Sign up for unlimited searches!");
        rl.close();
      }
    });
  }

  askQuery();
}

startChat();
