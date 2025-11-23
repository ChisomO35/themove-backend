// testSearchCore.js
const readline = require("readline");
const { searchPostersForSMS, detectIntent } = require("./searchCore");

// ---- NEW: access the internal date/time extraction for debugging ----
const {
  extractExactDate,
  extractExactTime,
} = require("./searchCore"); // make sure searchCore exports these

async function start() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const school = "UNC-Chapel Hill";

  function ask() {
    rl.question("💬 Test query: ", async (query) => {
      if (!query.trim()) return ask();

      const intent = await detectIntent(query);
      console.log("Intent:", intent);

      if (intent === "search") {
        // --- NEW: show how the query is interpreted ---
        const interpretedDate = await extractExactDate(query);
        const interpretedTime = extractExactTime(query);

        console.log("\n=== INTERPRETATION ===");
        console.log(
          "Date:",
          interpretedDate ? interpretedDate.toISOString().slice(0, 10) : "none"
        );
        console.log("Time:", interpretedTime ? JSON.stringify(interpretedTime) : "none");
        console.log("======================\n");

        // --- existing logic unchanged ---
        const result = await searchPostersForSMS(query, school);
        console.log("\n===== RESULT =====");
        console.log(result);
        console.log("==================\n");
      } else {
        console.log("Non-search intent:", intent);
      }

      ask();
    });
  }

  ask();
}

start();
