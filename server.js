import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fs from "fs";
import csv from "csv-parser";
import { initQdrant, addDocument, search } from "./qdrant.js";
import { getEmbedding, generateResponse } from "./gemini.js";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// Configurable constants
const CSV_FILE = process.env.CSV_FILE || "yam-resource.csv";
const PORT = process.env.PORT || 3000;

// Initialize Qdrant
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

    for (let i = 0; i < results.length; i++) {
      const row = results[i];

      const text = [
        row.business_description?.trim(),
        row.faq_ordering?.trim(),
        row.faq_delivery?.trim(),
        row.faq_dietary?.trim(),
        row.faq_payment?.trim(),
        row.faq_returns?.trim(),
      ]
        .filter(Boolean) 
        .join("\n\n");

      if (!text || text.trim() === "") {
        console.warn(`⚠️ Skipping row ${i}: No valid text content`);
        continue;
      }

      try {
        const embedding = await getEmbedding(text);
        await addDocument(i, { location_name: row.location_name, text }, embedding);
        console.log(`✅ Added document ${i}: ${row.location_name} - ${text.substring(0, 50)}...`);
      } catch (error) {
        console.error(`❌ Error processing row ${i} (${row.location_name}):`, error.message);
      }
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
    const { question } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res.status(400).json({ error: "Question must be a non-empty string" });
    }

    const queryEmbedding = await getEmbedding(question.trim());
    const docs = await search(queryEmbedding);

    const context = Array.isArray(docs)
      ? docs
          .map((doc) => `Location: ${doc.location_name}\n${doc.text}`)
          .join("\n\n")
      : "No relevant documents found";

    const finalPrompt = `You are Yam Cheff, a friendly and enthusiastic chef from Yamfoods, passionate about baking with love and sharing culinary knowledge. Answer the question in a warm, engaging tone, as if you're chatting with food lovers in Addis Ababa. Use ONLY the context below to provide accurate information, and keep your response concise yet delightful. Let's get cooking!

Context:
${context}

Question:
${question.trim()}`;

    const answer = await generateResponse(finalPrompt);

    res.json({ answer, context });
  } catch (error) {
    console.error("❌ Error in /ask endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(PORT, () =>
  console.log(`🚀 RAG server running on http://localhost:${PORT}`)
);