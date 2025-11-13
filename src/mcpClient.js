import EventSource from 'eventsource';

/**
 * MCP Client for communicating with remote MCP servers via HTTP+SSE
 */
export class MCPClient {
  constructor(serverConfig, sessionId = null) {
    this.url = serverConfig.url;
    this.headers = serverConfig.headers || {};
    this.sessionId = sessionId;
    this.requestId = 0;
  }

  /**
   * Generate unique request ID
   */
  getNextRequestId() {
    return ++this.requestId;
  }

  /**
   * Send JSON-RPC request to MCP server
   */
  async sendRequest(method, params = {}) {
    const requestId = this.getNextRequestId();
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    // Debug logging
    console.log(`[MCP] Sending ${method} to ${this.url}`);
    if (process.env.DEBUG_HEADERS) {
      console.log(`[MCP] Headers:`, this.headers);
    }

    // Build headers with session ID if available
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...this.headers
    };

    if (this.sessionId) {
      requestHeaders['Mcp-Session-Id'] = this.sessionId;
      console.log(`[MCP] Using session ID: ${this.sessionId.substring(0, 20)}...`);
    }

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: requestHeaders,
        body: JSON.stringify(request)
      });

      const contentType = response.headers.get('content-type');

      // Handle SSE response (convert to JSON)
      if (contentType && contentType.includes('text/event-stream')) {
        console.log(`[MCP] Received SSE response`);
        return await this.handleSSEResponse(response);
      }

      // Handle JSON response
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[MCP] HTTP ${response.status}: ${response.statusText}`);
        if (errorBody) {
          console.error(`[MCP] Error response:`, errorBody.substring(0, 500));
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (result.error) {
        console.error(`[MCP] JSON-RPC error:`, result.error);
        throw new Error(result.error.message || 'Unknown MCP error');
      }

      console.log(`[MCP] ${method} successful`);
      return result.result;
    } catch (error) {
      throw new Error(`MCP request failed: ${error.message}`);
    }
  }

  /**
   * Handle Server-Sent Events (SSE) response
   * Converts SSE stream to aggregated JSON response
   */
  async handleSSEResponse(response) {
    return new Promise((resolve, reject) => {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let result = null;

      const processChunk = async () => {
        try {
          const { done, value } = await reader.read();

          if (done) {
            if (result) {
              resolve(result);
            } else {
              reject(new Error('No data received from SSE stream'));
            }
            return;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data) {
                try {
                  const parsed = JSON.parse(data);

                  // Check if this is a JSON-RPC response
                  if (parsed.jsonrpc === '2.0') {
                    if (parsed.error) {
                      reject(new Error(parsed.error.message || 'SSE error'));
                      return;
                    }
                    if (parsed.result !== undefined) {
                      result = parsed.result;
                    }
                  }
                } catch (e) {
                  // Ignore parse errors for individual lines
                }
              }
            }
          }

          processChunk();
        } catch (error) {
          reject(error);
        }
      };

      processChunk();
    });
  }

  /**
   * Initialize connection with MCP server
   * Returns both the result and the session ID (if provided by server)
   */
  async initialize() {
    const params = {
      protocolVersion: '2025-06-18'
    };

    const requestId = this.getNextRequestId();
    const request = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'initialize',
      params
    };

    console.log(`[MCP] Initializing session with ${this.url}`);

    const requestHeaders = {
      'Content-Type': 'application/json',
      ...this.headers
    };

    const response = await fetch(this.url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(request)
    });

    // Capture session ID from response headers
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) {
      this.sessionId = sessionId;
      console.log(`[MCP] Received session ID: ${sessionId.substring(0, 20)}...`);
    } else {
      console.log(`[MCP] No session ID returned by server`);
    }

    const contentType = response.headers.get('content-type');

    let result;
    if (contentType && contentType.includes('text/event-stream')) {
      console.log(`[MCP] Received SSE response`);
      result = await this.handleSSEResponse(response);
    } else {
      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        console.error(`[MCP] HTTP ${response.status}: ${response.statusText}`);
        if (errorBody) {
          console.error(`[MCP] Error response:`, errorBody.substring(0, 500));
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const jsonResult = await response.json();
      if (jsonResult.error) {
        console.error(`[MCP] JSON-RPC error:`, jsonResult.error);
        throw new Error(jsonResult.error.message || 'Unknown MCP error');
      }

      result = jsonResult.result;
    }

    // Send initialized notification (no response expected)
    await this.sendNotification('notifications/initialized');

    console.log(`[MCP] Initialize successful`);

    // Return both result and session ID
    return {
      result,
      sessionId: this.sessionId
    };
  }

  /**
   * Send notification (no response expected)
   */
  async sendNotification(method, params = {}) {
    const notification = {
      jsonrpc: '2.0',
      method,
      params
    };

    try {
      await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify(notification)
      });
    } catch (error) {
      // Notifications don't require response, ignore errors
      console.warn(`Notification ${method} failed:`, error.message);
    }
  }

  /**
   * List available tools from server
   */
  async listTools(cursor = null) {
    const params = cursor ? { cursor } : {};
    return await this.sendRequest('tools/list', params);
  }

  /**
   * Call a specific tool
   */
  async callTool(toolName, args) {
    const params = {
      name: toolName,
      arguments: args
    };
    return await this.sendRequest('tools/call', params);
  }
}
