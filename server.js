import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import csv from "csv-parser";
import { initQdrant, addDocument, search } from "./qdrant.js";
import { getEmbedding, generateResponse } from "./gemini.js";

dotenv.config();

const app = express();

// In-memory chat history store (userId -> array of { question, answer })
const chatHistory = new Map();

app.use(cors({
    origin: "http://localhost:5173",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(bodyParser.json());

const CSV_FILE = process.env.CSV_FILE || "yam-resource.csv";
const PORT = process.env.PORT || 3000;
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE, 10) || 10;
const MAX_HISTORY = 5; // Limit to last 5 interactions per user

async function initialize() {
  try {
    await initQdrant();
    console.log("✅ Qdrant initialized");
  } catch (error) {
    console.error("❌ Failed to initialize Qdrant:", error.message);
    process.exit(1);
  }
}

async function loadCSV() {
  try {
    const results = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(CSV_FILE)
        .pipe(csv())
        .on("data", (data) => results.push(data))
        .on("error", (error) => reject(new Error(`CSV parsing error: ${error.message}`)))
        .on("end", () => resolve());
    });

    console.log(`📄 Loaded ${results.length} rows from CSV`);

    const batches = [];
    for (let i = 0; i < results.length; i += BATCH_SIZE) {
      batches.push(results.slice(i, i + BATCH_SIZE));
    }

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      console.log(`Processing batch ${batchIndex + 1}/${batches.length} with ${batch.length} rows`);
      const promises = batch.map(async (row, index) => {
        const rowIndex = batchIndex * BATCH_SIZE + index;
        const text = [
          row.business_description?.trim(),
          row.faq_ordering?.trim(),
          row.faq_delivery?.trim(),
          row.faq_dietary?.trim(),
          row.faq_payment?.trim(),
          row.faq_returns?.trim(),
          row.reward_rules?.trim(),
          row.order_delivery_policy?.trim(),
        ]
          .filter(Boolean)
          .join("\n\n");

        if (!text || text.trim() === "") {
          console.warn(`⚠️ Skipping row ${rowIndex}: No valid text content`);
          return;
        }

        try {
          const embedding = await getEmbedding(text);
          await addDocument(rowIndex, { location_name: row.location_name, text }, embedding);
          console.log(`✅ Added document ${rowIndex}: ${row.location_name} - ${text.substring(0, 50)}...`);
        } catch (error) {
          console.error(`❌ Error processing row ${rowIndex} (${row.location_name}):`, error.message);
        }
      });

      await Promise.all(promises);
    }

    console.log("✅ All valid CSV rows added to Qdrant");
  } catch (error) {
    console.error("❌ Failed to load CSV:", error.message);
    throw error;
  }
}

async function start() {
  await initialize();
  await loadCSV();
}

start().catch((error) => {
  console.error("❌ Startup failed:", error.message);
  process.exit(1);
});

app.post("/ask", async (req, res) => {
  try {
    const { question, userId } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res.status(400).json({ error: "Question must be a non-empty string" });
    }

    if (!userId || typeof userId !== "string" || userId.trim() === "") {
      return res.status(400).json({ error: "User ID must be a non-empty string" });
    }

    const queryEmbedding = await getEmbedding(question.trim());
    const docs = await search(queryEmbedding);

    const context = Array.isArray(docs)
      ? docs
          .map((doc) => `Location: ${doc.location_name}\n${doc.text}`)
          .join("\n\n")
      : "No relevant documents found";

    // Retrieve user's chat history
    const userHistory = chatHistory.get(userId) || [];
    const historyContext = userHistory
      .map((entry, index) => `Previous Q${index + 1}: ${entry.question}\nPrevious A${index + 1}: ${entry.answer}`)
      .join("\n\n");

    const finalPrompt = `You are Yam Cheff, a friendly and enthusiastic chef from Yamfoods, passionate about baking with love and sharing culinary knowledge. Answer the question in a warm, engaging tone, as if you're chatting with food lovers in Addis Ababa. Use the provided context and the user's previous conversation history to provide accurate, relevant, and delightful responses.use amharic by ddefault unless a user insists otherwise. Keep your response concise yet engaging. Let's get cooking!

Conversation History:
${historyContext || "No previous conversation history"}

Context:
${context}

Question:
${question.trim()}`;

    const answer = await generateResponse(finalPrompt);

    // Update chat history
    userHistory.push({ question: question.trim(), answer });
    if (userHistory.length > MAX_HISTORY) {
      userHistory.shift(); // Remove oldest entry if exceeding limit
    }
    chatHistory.set(userId, userHistory);

    res.json({ answer, context });
  } catch (error) {
    console.error("❌ Error in /ask endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 RAG server running on http://localhost:${PORT}`)
);