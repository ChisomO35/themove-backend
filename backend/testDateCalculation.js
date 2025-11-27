// testDateCalculation.js
// Quick test to verify date calculations are correct

const { extractExactDate } = require("./searchCore");

// Helper to format date without timezone conversion
function localDateToISO(date) {
  if (!date) return "none";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

async function testDateCalculations() {
  console.log("🧪 Testing Date Calculations\n");
  console.log("=".repeat(60));
  
  const today = getToday();
  const todayISO = localDateToISO(today);
  console.log(`\n📅 Today: ${todayISO}`);
  console.log(`   (Day of week: ${today.toLocaleDateString('en-US', { weekday: 'long' })})`);
  
  const testQueries = [
    "today",
    "tomorrow",
    "tonight",
    "what's happening tomorrow",
    "events next week",
    "free food this weekend",
    "monday",
    "friday",
  ];
  
  console.log("\n" + "=".repeat(60));
  
  for (const query of testQueries) {
    console.log(`\n🔍 Query: "${query}"`);
    try {
      const date = await extractExactDate(query);
      const dateISO = localDateToISO(date);
      console.log(`   Result: ${dateISO}`);
      
      if (date) {
        const daysDiff = Math.round((date - today) / (1000 * 60 * 60 * 24));
        if (daysDiff === 0) {
          console.log("   ✅ Correct: Today");
        } else if (daysDiff === 1) {
          console.log("   ✅ Correct: Tomorrow (+1 day)");
        } else if (daysDiff > 1) {
          console.log(`   ✅ Correct: ${daysDiff} days from now`);
        } else {
          console.log(`   ⚠️  Warning: ${daysDiff} days (in the past)`);
        }
      } else {
        console.log("   ℹ️  No specific date (range query or none)");
      }
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("\n✅ Date calculation tests complete!");
}

// Run tests
testDateCalculations()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Error:", err);
    process.exit(1);
  });

