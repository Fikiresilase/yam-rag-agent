import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
if (!process.env.GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY is not set in environment variables");
  process.exit(1);
}

export async function getEmbedding(text, retries = 3) {
  try {
    if (!text || typeof text !== "string" || text.trim() === "") {
      throw new Error("Invalid input: text must be a non-empty string");
    }

    const maxLength = 5000;
    if (text.length > maxLength) {
      console.warn(`Truncating input text from ${text.length} to ${maxLength} characters`);
      text = text.substring(0, maxLength);
    }

    const model = genAI.getGenerativeModel({ model: "embedding-001" });
    console.log("Embedding input:", text.substring(0, 50) + "...");

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const resp = await model.embedContent(text);
        return resp.embedding.values;
      } catch (error) {
        if (attempt === retries || !error.message.includes("429")) throw error;
        console.warn(`Retry ${attempt}/${retries} due to rate limit:`, error.message);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    throw new Error("Max retries reached for embedding");
  } catch (error) {
    console.error("Error generating embedding:", error, JSON.stringify(error, null, 2));
    throw error;
  }
}

const mcpServerPathDefault = path.resolve(process.cwd(), "mcp-toolbox/server.js");

export async function generateResponse(prompt, useMCP = false, mcpServerPath = mcpServerPathDefault) {
  try {
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("Invalid input: prompt must be a non-empty string");
    }

    if (useMCP) {
      const client = new Client({
        name: "yamfoods-client",
        version: "1.0.0",
        capabilities: { tools: {} },
      });

      const transport = new StdioClientTransport({
        command: "node",
        args: [mcpServerPath],
      });
      await client.connect(transport);

      try {
        console.log("Requesting tools list from MCP server...");
        const toolsResponse = await client.request({ method: "tools/list" }, z.any(), { timeout: 120000 }); // 120s timeout
        if (!toolsResponse.tools || toolsResponse.tools.length === 0) {
          throw new Error("No tools available from MCP server");
        }

        const availableTools = toolsResponse.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema,
        }));
        console.log("Available tools:", availableTools);

        const model = genAI.getGenerativeModel({
          model: "gemini-1.5-flash",
          tools: [{ function_declarations: availableTools }],
        });

        console.log("Generating content with Gemini...");
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const response = await result.response;
        const content = response.candidates[0].content;

        if (content.parts[0].functionCall) {
          const { name, args } = content.parts[0].functionCall;
          console.log(`Calling tool: ${name} with args:`, args);
          const toolResponse = await client.callTool(name, args, { timeout: 120000 }); // 120s timeout
          const functionResponse = { name, response: toolResponse };

          const finalResult = await model.generateContent({
            contents: [
              content,
              { role: "user", parts: [{ functionResponse }] },
            ],
          });

          return (await finalResult.response).text();
        }

        return content.parts[0].text;
      } finally {
        console.log("Cleaning up MCP client connection");
      }
    } else {
      const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
      const resp = await model.generateContent({
        contents: [{ parts: [{ text: prompt }] }],
      });
      return resp.response.text();
    }
  } catch (error) {
    console.error("Error generating response:", error);
    throw error;
  }
}

export async function queryDatabase(prompt, mcpServerPath = mcpServerPathDefault) {
  try {
    if (!prompt || typeof prompt !== "string" || prompt.trim() === "") {
      throw new Error("Invalid input: prompt must be a non-empty string");
    }

    if (!fs.existsSync(mcpServerPath)) {
      throw new Error(`MCP server script not found at ${mcpServerPath}`);
    }

    const client = new Client({
      name: "yamfoods-client",
      version: "1.0.0",
    },
     { capablities: {
        sampling:{}
     }
     }
    );

    const transport = new StdioClientTransport({
      command: "node",
      args: [mcpServerPath],
      options: { cwd: path.resolve(__dirname, "../../") },
    });
    await client.connect(transport);

    try {
      console.log(`Calling query_database tool with SQL: ${prompt}`);
      const result = await client.callTool("query_database", { sql: prompt }, { timeout: 120000 }); // 120s timeout
      return result.content[0].text;
    } finally {
      console.log("Cleaning up MCP client connection");
    }
  } catch (error) {
    console.error("Error querying database:", error);
    throw error;
  }
}
