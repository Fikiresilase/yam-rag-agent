import { getEmbedding, generateResponse, queryDatabase } from "../../services/geminiService.js";
import { search } from "../../services/qdrantService.js";

const chatHistory = new Map();
const MAX_HISTORY = 5;

export const ask = async (req, res) => {
  try {
    const { question, userId } = req.body;

    if (!question || typeof question !== "string" || question.trim() === "") {
      return res.status(400).json({ error: "Question must be a non-empty string" });
    }

    if (!userId || typeof userId !== "string" || userId.trim() === "") {
      return res.status(400).json({ error: "User ID must be a non-empty string" });
    }

    const userHistory = chatHistory.get(userId) || [];
    const historyContext = userHistory
      .map((entry, index) => `Previous Q${index + 1}: ${entry.question}\nPrevious A${index + 1}: ${entry.answer}`)
      .join("\n\n");

    const isDatabaseQuery = question.toLowerCase().includes("database") || question.toLowerCase().includes("query");

    let answer, context = "";

    if (isDatabaseQuery) {
      try {
        answer = await queryDatabase(question.trim());
        context = "Database query executed via MCP";
      } catch (error) {
        console.error("❌ Error querying database:", error.message);
        return res.status(500).json({ error: "Failed to query database" });
      }
    } else {
      const queryEmbedding = await getEmbedding(question.trim());
      const docs = await search(queryEmbedding);

      context = Array.isArray(docs)
        ? docs
            .map((doc) => `Location: ${doc.location_name}\n${doc.text}`)
            .join("\n\n")
        : "No relevant documents found";

      const finalPrompt = `You are Yam Cheff, a friendly and enthusiastic chef from Yamfoods, passionate about baking with love and sharing culinary knowledge. Answer the question in a warm, engaging tone, as if you're chatting with food lovers in Addis Ababa. Use the provided context and the user's previous conversation history to provide accurate, relevant, and delightful responses. Use Amharic by default unless a user insists otherwise. Keep your response concise yet engaging. Let's get cooking!

Conversation History:
${historyContext || "No previous conversation history"}

Context:
${context}

Question:
${question.trim()}`;

      answer = await generateResponse(finalPrompt);
    }

    userHistory.push({ question: question.trim(), answer });
    if (userHistory.length > MAX_HISTORY) {
      userHistory.shift();
    }
    chatHistory.set(userId, userHistory);

    res.json({ answer, context });
  } catch (error) {
    console.error("❌ Error in /ask endpoint:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
