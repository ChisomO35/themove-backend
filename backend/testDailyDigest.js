// testDailyDigest.js
// Script to test daily digest for all users

const { runDailyDigest } = require("./dailyDigest");

async function testDailyDigest() {
  console.log("🧪 Testing Daily Digest\n");
  console.log("=" .repeat(60) + "\n");

  try {
    await runDailyDigest();
    console.log("\n✅ Daily digest test complete!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  testDailyDigest()
    .then(() => {
      console.log("\n✅ Done!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

module.exports = { testDailyDigest };

