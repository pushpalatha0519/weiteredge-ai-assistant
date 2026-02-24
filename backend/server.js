require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const fs = require("fs");
const db = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

// ✅ Rate Limiting (20 requests per minute per IP)
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 20,
  message: { error: "Too many requests, please try again later." }
});
app.use(limiter);

// ✅ Load Docs
const docs = JSON.parse(fs.readFileSync("./docs.json", "utf-8"));

// 🔎 Simple document matching function
function findRelevantDoc(question) {
  const qWords = question.toLowerCase().split(/\s+/);

  for (let doc of docs) {
    const docText = (doc.title + " " + doc.content).toLowerCase();
    // If any word from question exists in docText
    if (qWords.some(word => docText.includes(word))) {
      return doc;
    }
  }

  return null; // no match
}
/* ================================
   1️⃣ CHAT ENDPOINT
================================ */
app.post("/api/chat", (req, res) => {
  const { sessionId, message } = req.body;

  if (!sessionId || !message) {
    return res.status(400).json({ error: "Missing sessionId or message" });
  }

  // Insert session if not exists
  db.run(`INSERT OR IGNORE INTO sessions (id) VALUES (?)`, [sessionId]);

  // Store user message
  db.run(
    `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`,
    [sessionId, "user", message]
  );

  // 🔹 Fetch last 10 messages (5 user+assistant pairs)
  db.all(
    `SELECT role, content FROM messages 
     WHERE session_id = ? 
     ORDER BY created_at DESC 
     LIMIT 10`,
    [sessionId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }

      const recentHistory = rows.reverse(); // make chronological

      const relevantDoc = findRelevantDoc(message);

      let reply;

      if (!relevantDoc) {
        reply = "Sorry, I don’t have information about that.";
      } else {
        reply = relevantDoc.content;
      }

      // Store assistant reply
      db.run(
        `INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)`,
        [sessionId, "assistant", reply]
      );

      res.json({
        reply,
        contextUsed: recentHistory.length,
        tokensUsed: 0
      });
    }
  );
});

/* ================================
   2️⃣ FETCH CONVERSATION
================================ */
app.get("/api/conversations/:sessionId", (req, res) => {
  db.all(
    `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    [req.params.sessionId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

/* ================================
   3️⃣ LIST SESSIONS
================================ */
app.get("/api/sessions", (req, res) => {
  db.all(
    `SELECT * FROM sessions ORDER BY updated_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "Database error" });
      }
      res.json(rows);
    }
  );
});

app.listen(5000, () => {
  console.log("🚀 Server running on http://localhost:5000");
});