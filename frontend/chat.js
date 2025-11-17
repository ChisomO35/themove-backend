const chatWindow = document.getElementById("chatWindow");
const chatInput = document.getElementById("chatInput");

function addMessage(text, sender) {
  const bubble = document.createElement("div");
  bubble.className = sender === "user" ? "bubble-user" : "bubble-bot";
  bubble.textContent = text;
  chatWindow.appendChild(bubble);

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function showTyping() {
  const bubble = document.createElement("div");
  bubble.id = "typingBubble";
  bubble.className = "bubble-bot typing";
  bubble.textContent = "TheMove is thinking…";
  chatWindow.appendChild(bubble);

  chatWindow.scrollTop = chatWindow.scrollHeight;
}

function hideTyping() {
  const bubble = document.getElementById("typingBubble");
  if (bubble) bubble.remove();
}

async function sendMessage() {
  const text = chatInput.value.trim();
  if (!text) return;

  addMessage(text, "user");
  chatInput.value = "";

  showTyping();

  // 🔥 NEW: Call backend JSON endpoint
  const res = await fetch("https://api.usethemove.com/chatJSON, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: text })
  });

  const data = await res.json();
  hideTyping();

  addMessage(data.reply, "bot");
}

// Send on Enter
chatInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});
