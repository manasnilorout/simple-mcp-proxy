import express from 'express';
import { MCPClient } from './mcpClient.js';
import { loadServerConfig, getServerConfig, listServers } from './config.js';

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json());

// Load server configurations
let serverConfigs;
try {
  serverConfigs = loadServerConfig();
  console.log(`Loaded ${Object.keys(serverConfigs).length} MCP server(s) from config`);
} catch (error) {
  console.error('Failed to load server configuration:', error.message);
  process.exit(1);
}

// Helper function to create MCP client
function createClient(serverName, sessionId = null) {
  const config = getServerConfig(serverName, serverConfigs);
  return new MCPClient(config, sessionId);
}

// Helper to extract session ID from request (query param or header)
function getSessionId(req) {
  return req.query.sessionId || req.get('Mcp-Session-Id') || null;
}

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/list-servers
 * List all configured MCP servers
 */
app.get('/api/list-servers', (req, res) => {
  try {
    const servers = listServers(serverConfigs);
    res.json({
      servers,
      count: servers.length
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list servers',
      message: error.message
    });
  }
});

/**
 * POST /api/mcp/{server_name}/initialize
 * Initialize connection with an MCP server
 * Returns the session ID in both response body and Mcp-Session-Id header
 */
app.post('/api/mcp/:serverName/initialize', async (req, res) => {
  const { serverName } = req.params;

  try {
    const client = createClient(serverName);
    const { result, sessionId } = await client.initialize();

    // Set session ID in response header if available
    if (sessionId) {
      res.set('Mcp-Session-Id', sessionId);
    }

    // Return result with session ID
    res.json({
      ...result,
      sessionId: sessionId || null
    });
  } catch (error) {
    console.error(`Initialize error for ${serverName}:`, error.message);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Server not found',
        message: error.message
      });
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or missing authorization credentials'
      });
    }

    res.status(500).json({
      error: 'Initialization failed',
      message: error.message
    });
  }
});

/**
 * GET /api/mcp/{server_name}/tools
 * List all tools available on an MCP server
 * Query params:
 *   - cursor: pagination cursor
 *   - init: whether to initialize session first (default: false)
 *   - sessionId: MCP session ID (can also be sent via Mcp-Session-Id header)
 */
app.get('/api/mcp/:serverName/tools', async (req, res) => {
  const { serverName } = req.params;
  const { cursor, init } = req.query;
  const shouldInitialize = init === 'true';
  const sessionId = getSessionId(req);

  try {
    const client = createClient(serverName, sessionId);

    let newSessionId = sessionId;

    // Initialize if requested
    if (shouldInitialize) {
      const initResult = await client.initialize();
      newSessionId = initResult.sessionId;
    }

    // List tools
    const result = await client.listTools(cursor);

    // Include session ID in response header if available
    if (newSessionId) {
      res.set('Mcp-Session-Id', newSessionId);
    }

    res.json(result);
  } catch (error) {
    console.error(`List tools error for ${serverName}:`, error.message);

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Server not found',
        message: error.message
      });
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or missing authorization credentials'
      });
    }

    res.status(500).json({
      error: 'Failed to list tools',
      message: error.message
    });
  }
});

/**
 * POST /api/mcp/{server_name}/tools/{tool_name}/execute
 * Execute a specific tool with provided arguments
 * Query params:
 *   - init: whether to initialize session first (default: false)
 *   - sessionId: MCP session ID (can also be sent via Mcp-Session-Id header)
 */
app.post('/api/mcp/:serverName/tools/:toolName/execute', async (req, res) => {
  const { serverName, toolName } = req.params;
  const { init } = req.query;
  const args = req.body;
  const shouldInitialize = init === 'true';
  const sessionId = getSessionId(req);

  try {
    const client = createClient(serverName, sessionId);

    let newSessionId = sessionId;

    // Initialize if requested
    if (shouldInitialize) {
      const initResult = await client.initialize();
      newSessionId = initResult.sessionId;
    }

    // Execute tool
    const result = await client.callTool(toolName, args);

    // Include session ID in response header if available
    if (newSessionId) {
      res.set('Mcp-Session-Id', newSessionId);
    }

    res.json(result);
  } catch (error) {
    console.error(`Execute tool error for ${serverName}/${toolName}:`, error.message);

    if (error.message.includes('not found') && error.message.includes('Server')) {
      return res.status(404).json({
        error: 'Server not found',
        message: error.message
      });
    }

    if (error.message.includes('Tool') || error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Tool not found',
        message: `Tool '${toolName}' not found on server '${serverName}'`
      });
    }

    if (error.message.includes('401') || error.message.includes('403')) {
      return res.status(401).json({
        error: 'Authentication failed',
        message: 'Invalid or missing authorization credentials'
      });
    }

    res.status(500).json({
      error: 'Tool execution failed',
      message: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} does not exist`
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`MCP Proxy Server running on http://localhost:${PORT}`);
  console.log(`\nAvailable endpoints:`);
  console.log(`  GET  /api/list-servers`);
  console.log(`  POST /api/mcp/{server_name}/initialize`);
  console.log(`  GET  /api/mcp/{server_name}/tools?init=true|false (default: false)`);
  console.log(`  POST /api/mcp/{server_name}/tools/{tool_name}/execute?init=true|false (default: false)`);
  console.log(`\nHealth check: GET /health`);
});
