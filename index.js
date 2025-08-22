import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import cors from "cors";
import fs from "fs";
import csv from "csv-parser";
import { initQdrant, addDocument } from "./src/services/qdrantService.js";
import { getEmbedding } from "./src/services/geminiService.js";
import askRoutes from "./src/api/routes/askRoutes.js";

dotenv.config();

const app = express();

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
          console.error(`❌ Error processing row ${rowIndex} (${row.location_name}):`, error);
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

  app.use("/api", askRoutes);

  app.listen(PORT, () =>
    console.log(`🚀 RAG server running on http://localhost:${PORT}`)
  );
}

start().catch((error) => {
  console.error("❌ Startup failed:", error.message);
  process.exit(1);
});
