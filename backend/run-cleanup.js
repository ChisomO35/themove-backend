const fetch = require("node-fetch");

async function run() {
  const res = await fetch(process.env.API_URL + "/cleanupExpiredPosters", {
    method: "POST"
  });

  const json = await res.json();
  console.log(json);
}

run();

