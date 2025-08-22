#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import mysql from "mysql2/promise";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  connectTimeout: 10000, // 10 seconds
});


const server = new McpServer({
  name: "mysql-explorer",
  version: "1.0.0",
});

server.registerTool(
  "query_database",
  {
    title: "Query Database",
    description: "Execute an SQL query on the MySQL database",
    inputSchema: {
      sql: z.string().describe("SQL query to execute"),
    },
  },
  async ({ sql }) => {
    console.error(`Executing SQL query: ${sql}`);
    try {
      if (!sql.trim().toLowerCase().startsWith("select")) {
        return {
          content: [
            {
              type: "text",
              text: "Invalid SQL query: Only SELECT statements are allowed.",
            },
          ],
          isError: true,
        };
      }
      const [results] = await pool.execute(sql);
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    } catch (error) {
      const err = error;
      console.error("Error executing tool:", err.message);
      return {
        content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server connected and running.");
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});