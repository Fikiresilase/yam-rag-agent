import { QdrantClient } from "@qdrant/js-client-rest";
import dotenv from "dotenv";

dotenv.config();

// Initialize Qdrant client for Cloud
const qdrant = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

// Initialize collection
export async function initQdrant() {
  try {
    await qdrant.recreateCollection("docs", {
      vectors: { size: 768, distance: "Cosine" },
    });
    console.log("✅ Qdrant collection 'docs' ready.");
  } catch (err) {
    console.error("❌ Error initializing Qdrant:", err);
  }
}

// Add document with embedding
export async function addDocument(id, text, embedding) {
  try {
    await qdrant.upsert("docs", {
      points: [{ id, vector: embedding, payload: { text } }],
    });
  } catch (err) {
    console.error("❌ Error adding document:", err);
  }
}

// Search nearest documents
export async function search(queryEmbedding, limit = 3) {
  try {
    const result = await qdrant.search("docs", {
      vector: queryEmbedding,
      limit,
    });
    return result.map((r) => r.payload.text);
  } catch (err) {
    console.error("❌ Error searching documents:", err);
    return [];
  }
}
