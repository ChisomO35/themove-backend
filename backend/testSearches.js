// testSearches.js
// Script to test various search queries and see results

const { searchPostersForSMS } = require("./searchCore");

const TEST_QUERIES = [
  // Time-based
  "what's happening tonight",
  "free food this weekend",
  "events next week",
  "what's happening right now",
  "poker later today",
  
  // Activity-based
  "study groups",
  "networking events",
  "career fairs",
  "free pizza",
  "basketball tournaments",
  
  // Combination
  "free pizza this weekend",
  "study groups next week",
  "networking events tonight",
  "poker right now",
  
  // General
  "what's happening",
  "free events",
  "what to do",
  
  // Specific
  "hip hop concert",
  "yoga classes",
  "volunteer opportunities",
];

async function testSearches() {
  console.log("🧪 Testing Search Queries\n");
  console.log("=" .repeat(60) + "\n");

  const school = "UNC-Chapel Hill";

  for (const query of TEST_QUERIES) {
    console.log(`\n🔍 Query: "${query}"`);
    console.log("-".repeat(60));
    
    try {
      const result = await searchPostersForSMS(query, school);
      console.log(result);
    } catch (error) {
      console.error(`❌ Error: ${error.message}`);
    }
    
    console.log("\n" + "=".repeat(60));
    
    // Small delay between queries
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("\n✅ All queries tested!");
}

// Run if executed directly
if (require.main === module) {
  testSearches()
    .then(() => {
      console.log("\n✅ Done!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("❌ Error:", err);
      process.exit(1);
    });
}

module.exports = { testSearches };

