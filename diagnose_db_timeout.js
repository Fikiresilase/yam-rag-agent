#!/usr/bin/env node
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

dotenv.config();

console.log('🔍 Diagnosing Database Timeout Issues...\n');

// Test 1: Direct MySQL Connection Test
async function testDirectConnection() {
  console.log('📋 Test 1: Direct MySQL Connection Test');
  console.log('Database Config:');
  console.log(`  Host: ${process.env.DB_HOST || 'localhost'}`);
  console.log(`  User: ${process.env.DB_USER || 'not set'}`);
  console.log(`  Password: ${process.env.DB_PASSWORD ? '[set but empty]' : '[not set]'}`);
  console.log(`  Database: ${process.env.DB_NAME || 'not set'}`);
  
  try {
    console.log('\n⏳ Testing direct connection...');
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      connectTimeout: 5000,
      acquireTimeout: 5000,
    });
    
    console.log('✅ Direct connection successful');
    
    // Test simple query
    console.log('⏳ Testing simple query...');
    const [rows] = await connection.execute('SELECT 1 as test');
    console.log('✅ Simple query successful:', rows);
    
    await connection.end();
    return true;
  } catch (error) {
    console.log('❌ Direct connection failed:', error.message);
    console.log('   Error code:', error.code);
    console.log('   Error errno:', error.errno);
    return false;
  }
}

// Test 2: MCP Server Startup Test
async function testMcpServerStartup() {
  console.log('\n📋 Test 2: MCP Server Startup Test');
  
  return new Promise((resolve) => {
    console.log('⏳ Starting MCP server...');
    
    const mcpServerPath = path.resolve('./mcp-toolbox/server.js');
    const mcpProcess = spawn('node', [mcpServerPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    mcpProcess.stdout.on('data', (data) => {
      output += data.toString();
    });

    mcpProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    const timeout = setTimeout(() => {
      mcpProcess.kill('SIGTERM');
      
      console.log('Server Output:', output);
      console.log('Server Error Output:', errorOutput);
      
      if (errorOutput.includes('Database connection failed')) {
        console.log('❌ MCP server reports database connection failed');
        resolve(false);
      } else if (errorOutput.includes('MCP server connected and running')) {
        console.log('✅ MCP server started successfully');
        resolve(true);
      } else {
        console.log('⚠️ MCP server status unclear');
        resolve(false);
      }
    }, 5000);

    mcpProcess.on('error', (error) => {
      clearTimeout(timeout);
      console.log('❌ Failed to start MCP server:', error.message);
      resolve(false);
    });
  });
}

// Test 3: MCP Client Connection Test
async function testMcpClientConnection() {
  console.log('\n📋 Test 3: MCP Client Connection Test');
  
  try {
    console.log('⏳ Creating MCP client...');
    const client = new Client({
      name: 'diagnostic-client',
      version: '1.0.0',
    }, {
      capabilities: {
        sampling: {}
      }
    });

    const mcpServerPath = path.resolve('./mcp-toolbox/server.js');
    const transport = new StdioClientTransport({
      command: 'node',
      args: [mcpServerPath],
      options: { cwd: process.cwd() },
    });

    console.log('⏳ Connecting to MCP server...');
    await client.connect(transport);
    console.log('✅ MCP client connected successfully');

    // Test tool call with shorter timeout
    console.log('⏳ Testing simple query with 10s timeout...');
    const result = await client.callTool('query_database', { 
      sql: 'SELECT 1 as test' 
    }, { 
      timeout: 10000 // 10 seconds instead of 120
    });
    
    console.log('✅ MCP tool call successful:', result);
    
    await client.close();
    return true;
    
  } catch (error) {
    console.log('❌ MCP client test failed:', error.message);
    console.log('   Error type:', error.constructor.name);
    if (error.code) {
      console.log('   Error code:', error.code);
    }
    return false;
  }
}

// Test 4: Connection Pool Test
async function testConnectionPool() {
  console.log('\n📋 Test 4: MySQL Connection Pool Test');
  
  try {
    console.log('⏳ Creating connection pool...');
    const pool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
      connectTimeout: 5000,
      acquireTimeout: 5000,
    });
    
    console.log('⏳ Getting connection from pool...');
    const connection = await pool.getConnection();
    
    console.log('⏳ Testing ping...');
    await connection.ping();
    console.log('✅ Pool connection ping successful');
    
    console.log('⏳ Testing query via pool...');
    const [results] = await connection.execute('SELECT 1 as pooltest');
    console.log('✅ Pool query successful:', results);
    
    connection.release();
    await pool.end();
    return true;
    
  } catch (error) {
    console.log('❌ Connection pool test failed:', error.message);
    return false;
  }
}

// Run all diagnostic tests
async function runDiagnostics() {
  const results = {
    directConnection: await testDirectConnection(),
    mcpServerStartup: await testMcpServerStartup(),
    connectionPool: await testConnectionPool(),
    mcpClientConnection: await testMcpClientConnection(),
  };
  
  console.log('\n📊 Diagnostic Results Summary:');
  console.log('================================');
  Object.entries(results).forEach(([test, passed]) => {
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASSED' : 'FAILED'}`);
  });
  
  console.log('\n💡 Recommendations:');
  
  if (!results.directConnection) {
    console.log('🔧 Fix MySQL connection issues first');
    console.log('   - Check if MySQL server is running');
    console.log('   - Verify database credentials');
    console.log('   - Ensure database "auth_db" exists');
  }
  
  if (!results.connectionPool) {
    console.log('🔧 Connection pool configuration needs adjustment');
    console.log('   - Consider increasing connectTimeout');
    console.log('   - Check connection limits');
  }
  
  if (!results.mcpServerStartup) {
    console.log('🔧 MCP server startup issues detected');
    console.log('   - Check server configuration');
    console.log('   - Review error logs');
  }
  
  if (!results.mcpClientConnection) {
    console.log('🔧 MCP client timeout issues detected');
    console.log('   - Reduce timeout values for testing');
    console.log('   - Check if server process is hanging');
    console.log('   - Consider adding connection retries');
  }
  
  const allPassed = Object.values(results).every(Boolean);
  console.log(`\n${allPassed ? '🎉' : '⚠️'} Overall: ${allPassed ? 'ALL TESTS PASSED' : 'SOME ISSUES DETECTED'}`);
}

runDiagnostics().catch(console.error);
