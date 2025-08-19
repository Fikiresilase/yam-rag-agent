import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();


const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);


export async function getEmbedding(text) {
  try {
    
    if (!text || typeof text !== "string" || text.trim() === "") {
      throw new Error("Invalid input: text must be a non-empty string");
    }

    
    const model = genAI.getGenerativeModel({ model: "embedding-001" });

    
    console.log("Embedding input:", text);

    
    const resp = await model.embedContent(text);

    
    return resp.embedding.values;
  } catch (error) {
    console.error("Error generating embedding:", error.message);
    throw error;
  }
}


export async function generateResponse(prompt) {
  try {
    
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("Invalid input: prompt must be a non-empty string");
    }

    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    
    const resp = await model.generateContent({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
    });

    
    return resp.response.text();
  } catch (error) {
    console.error("Error generating response:", error.message);
    throw error;
  }
}