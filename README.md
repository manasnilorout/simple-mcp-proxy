# MCP Proxy Service

A stateless HTTP proxy service for remote Model Context Protocol (MCP) servers. This service exposes RESTful APIs to interact with MCP tools without requiring direct JSON-RPC communication.

## Features

- **RESTful API** for MCP operations
- **Stateless design** - no session management required
- **Multiple server support** - configure multiple MCP servers
- **SSE to JSON conversion** - automatic handling of Server-Sent Events
- **Standard error codes** - HTTP-compliant error handling
- **Simple configuration** - JSON-based server configuration

## Prerequisites

- Node.js 18.x or higher
- Access to remote MCP servers (HTTP-based)

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Create your server configuration file:

```bash
cp mcp.servers.example.json mcp.servers.json
```

4. Edit `mcp.servers.json` with your server details:

```json
{
  "mcpServers": {
    "MyMcpServer": {
      "url": "https://your-mcp-server.com/endpoint",
      "headers": {
        "Authorization": "Bearer your-token-here"
      },
      "type": "http"
    }
  }
}
```

## Configuration

The `mcp.servers.json` file defines all available MCP servers:

- **`mcpServers`**: Object containing server configurations
  - **Key**: Server name (used in API routes)
  - **Value**: Server configuration object
    - `url`: MCP server endpoint URL
    - `headers`: HTTP headers to include (e.g., authentication)
    - `type`: Must be `"http"` for remote servers

## Usage

Start the server:

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:8080` (configurable via `PORT` environment variable).

## API Endpoints

### 1. List Servers

List all configured MCP servers.

**Request:**
```http
GET /api/list-servers
```

**Response:**
```json
{
  "servers": [
    {
      "name": "MyMcpServer",
      "url": "https://your-mcp-server.com/endpoint",
      "type": "http"
    }
  ],
  "count": 1
}
```

### 2. Initialize Server

Initialize connection with an MCP server and retrieve server capabilities. The server may return a session ID that must be used in subsequent requests.

**Request:**
```http
POST /api/mcp/{server_name}/initialize
```

**Response:**
```json
{
  "protocolVersion": "2024-11-05",
  "capabilities": {
    "tools": {
      "listChanged": true
    }
  },
  "serverInfo": {
    "name": "example-server",
    "version": "1.0.0"
  },
  "sessionId": "abc123-session-id-xyz"
}
```

**Response Headers:**
```
Mcp-Session-Id: abc123-session-id-xyz
```

**Note:** Save the `sessionId` from the response to use in subsequent requests. Some servers (like GitHub MCP) require it.

### 3. List Tools

Get all available tools from an MCP server.

**Request:**
```http
GET /api/mcp/{server_name}/tools?init=false
```

Optional query parameters:
- `cursor`: Pagination cursor from previous response
- `init`: Initialize session before listing tools (default: `false`)
  - `true`: Initialize connection first
  - `false`: Skip initialization (assumes session already initialized)
- `sessionId`: MCP session ID from initialization (alternative to header)

Optional headers:
- `Mcp-Session-Id`: MCP session ID from initialization

**Response:**
```json
{
  "tools": [
    {
      "name": "get_weather",
      "description": "Get current weather for a location",
      "inputSchema": {
        "type": "object",
        "properties": {
          "location": {
            "type": "string",
            "description": "City name"
          }
        },
        "required": ["location"]
      }
    }
  ],
  "nextCursor": "optional-cursor-for-next-page"
}
```

### 4. Execute Tool

Execute a specific tool with provided arguments.

**Request:**
```http
POST /api/mcp/{server_name}/tools/{tool_name}/execute?init=false
Content-Type: application/json

{
  "location": "San Francisco",
  "units": "celsius"
}
```

Optional query parameters:
- `init`: Initialize session before executing tool (default: `false`)
  - `true`: Initialize connection first
  - `false`: Skip initialization (assumes session already initialized)
- `sessionId`: MCP session ID from initialization (alternative to header)

Optional headers:
- `Mcp-Session-Id`: MCP session ID from initialization

**Response:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Temperature: 22°C, Conditions: Sunny"
    }
  ],
  "isError": false
}
```

## Error Handling

The service returns standard HTTP error codes:

- **400 Bad Request**: Invalid request format
- **401 Unauthorized**: Authentication failed
- **404 Not Found**: Server or tool not found
- **500 Internal Server Error**: Server error or MCP communication failure

Error response format:
```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

## Example Usage

### Using cURL

**List servers:**
```bash
curl http://localhost:8080/api/list-servers
```

**Initialize a server and get session ID:**
```bash
# Initialize and capture session ID
RESPONSE=$(curl -i -X POST http://localhost:8080/api/mcp/MyMcpServer/initialize)
SESSION_ID=$(echo "$RESPONSE" | grep -i "mcp-session-id:" | cut -d' ' -f2 | tr -d '\r')
```

**Using session ID in subsequent requests:**

Via query parameter:
```bash
curl "http://localhost:8080/api/mcp/MyMcpServer/tools?sessionId=$SESSION_ID"
```

Via header (recommended):
```bash
curl http://localhost:8080/api/mcp/MyMcpServer/tools \
  -H "Mcp-Session-Id: $SESSION_ID"
```

**Execute a tool with session ID:**
```bash
curl -X POST http://localhost:8080/api/mcp/MyMcpServer/tools/get_weather/execute \
  -H "Content-Type: application/json" \
  -H "Mcp-Session-Id: $SESSION_ID" \
  -d '{"location": "San Francisco"}'
```

**One-shot request (init + execute in single call):**
```bash
curl -X POST "http://localhost:8080/api/mcp/MyMcpServer/tools/get_weather/execute?init=true" \
  -H "Content-Type: application/json" \
  -d '{"location": "San Francisco"}'
```

### Using JavaScript/Fetch

```javascript
// List tools
const response = await fetch('http://localhost:8080/api/mcp/MyMcpServer/tools');
const { tools } = await response.json();

// Execute a tool
const result = await fetch(
  'http://localhost:8080/api/mcp/MyMcpServer/tools/get_weather/execute',
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ location: 'San Francisco' })
  }
);
const data = await result.json();
console.log(data.content);
```

## Architecture

### Stateless Design

Each request independently:
1. Creates a new MCP client instance
2. Optionally initializes connection with the server (controlled by `init` query parameter)
3. Performs the requested operation
4. Returns the result

No session state is maintained between requests.

**Session Management:**
- Many MCP servers (e.g., GitHub) require session IDs for all requests after initialization
- The `/initialize` endpoint returns a `sessionId` in both the response body and `Mcp-Session-Id` header
- Include the session ID in subsequent requests via:
  - `Mcp-Session-Id` header (recommended)
  - `sessionId` query parameter (alternative)
- Session IDs are server-specific and may expire

**Initialization Options:**
- **Option 1 (Recommended):** Initialize once, reuse session ID
  ```bash
  # 1. Initialize
  SESSION=$(curl -X POST .../initialize | jq -r '.sessionId')
  # 2. Use session for multiple requests
  curl .../tools -H "Mcp-Session-Id: $SESSION"
  curl .../tools/my_tool/execute -H "Mcp-Session-Id: $SESSION" -d '{...}'
  ```

- **Option 2:** One-shot requests with `init=true`
  ```bash
  curl ".../tools?init=true"  # Initializes and lists tools in one call
  ```

- **Option 3:** Servers that don't require session IDs
  ```bash
  curl .../tools  # Works without initialization or session ID
  ```

### SSE Handling

The proxy automatically detects Server-Sent Events (SSE) responses from MCP servers and converts them to standard JSON responses, aggregating all events into a single result.

### MCP Protocol

This proxy implements the Model Context Protocol 2024-11-05 specification, focusing on the **tools** capability:

- JSON-RPC 2.0 message format
- HTTP+SSE transport layer
- Tool discovery and execution

## Troubleshooting

**Configuration file not found:**
```
Error: Configuration file not found
```
Solution: Create `mcp.servers.json` from the example file.

**Server unreachable:**
```
Error: MCP request failed: fetch failed
```
Solution: Check the server URL and network connectivity.

**Authentication failed:**
```
Error: Authentication failed (401)
```
Solution: Verify the authorization token in your server configuration.

**Tool not found:**
```
Error: Tool not found (404)
```
Solution: Use the `/tools` endpoint to list available tools.

## Development

Project structure:
```
mcp-proxy/
├── src/
│   ├── index.js         # Express server and routes
│   ├── mcpClient.js     # MCP client implementation
│   └── config.js        # Configuration loader
├── mcp.servers.json     # Server configuration (gitignored)
├── mcp.servers.example.json
├── package.json
└── README.md
```

## License

MIT

## Contributing

Contributions are welcome! Please ensure:
- Code follows existing style
- All routes are tested
- Error handling is comprehensive
- Documentation is updated
