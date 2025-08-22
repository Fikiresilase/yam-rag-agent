import { FastMCP } from 'fastmcp';
import { getDB } from './src/config/db.js'

const pool = getDB()

const mcp = new FastMCP({ 
  name: 'MySQL Query Server',
});

mcp.tool('query_database', {
  description: 'Execute an SQL SELECT query on the customers database and return results.',
  parameters: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'SQL SELECT query to execute' }
    },
    required: ['sql']
  },
  execute: async ({ sql }) => {
    
    if (!sql.trim().toLowerCase().startsWith('select')) {
      throw new Error('Only SELECT queries are allowed');
    }

    try {
      const [rows] = await pool.query(sql);
      return { results: rows };
    } catch (error) {
      throw new Error(`Database error: ${error.message}`);
    }
  }
});

if (require.main === module) {
  mcp.run();
}

process.on('SIGINT', async () => {
  await pool.end();
  process.exit(0);
});
