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
  connectionLimit: 5,
  queueLimit: 0,
  connectTimeout: 5000, // 5 seconds
  acquireTimeout: 5000,  // 5 seconds to get connection from pool
  timeout: 10000,        // 10 seconds for queries
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
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
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "SQL query to execute"
        }
      },
      required: ["sql"]
    },
  },
  async ({ sql }) => {
    console.error(`[MCP] Tool called with SQL: ${sql}`);
    const startTime = Date.now();
    
    try {
      // Validate SQL
      if (!sql || typeof sql !== 'string') {
        console.error('[MCP] Invalid SQL parameter type');
        return {
          content: [{
            type: "text",
            text: "Invalid SQL: parameter must be a non-empty string.",
          }],
          isError: true,
        };
      }
      
      if (!sql.trim().toLowerCase().startsWith("select")) {
        console.error('[MCP] Non-SELECT query rejected');
        return {
          content: [{
            type: "text",
            text: "Invalid SQL query: Only SELECT statements are allowed.",
          }],
          isError: true,
        };
      }
      
      console.error('[MCP] Executing query...');
      const [results] = await pool.execute(sql);
      const duration = Date.now() - startTime;
      
      console.error(`[MCP] Query completed in ${duration}ms, returned ${Array.isArray(results) ? results.length : 'unknown'} rows`);
      
      return {
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const err = error;
      console.error(`[MCP] Query failed after ${duration}ms:`, err.message);
      console.error(`[MCP] Error code: ${err.code}, errno: ${err.errno}`);
      
      return {
        content: [{ type: "text", text: JSON.stringify({ 
          error: err.message,
          code: err.code,
          errno: err.errno 
        }) }],
        isError: true,
      };
    }
  }
);

async function main() {
  // Test database connection
  try {
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    console.error("✅ Database connection verified");
  } catch (dbError) {
    console.error("❌ Database connection failed:", dbError.message);
    console.error("Note: Database queries will fail until connection is established");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP server connected and running.");
}

main().catch((err) => {
  console.error("MCP server failed to start:", err);
  process.exit(1);
});