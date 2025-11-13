import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load MCP server configurations from mcp.servers.json
 */
export function loadServerConfig() {
  try {
    const configPath = join(__dirname, '..', 'mcp.servers.json');
    const configData = readFileSync(configPath, 'utf8');
    const config = JSON.parse(configData);

    if (!config.mcpServers || typeof config.mcpServers !== 'object') {
      throw new Error('Invalid config format: mcpServers object not found');
    }

    return config.mcpServers;
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(
        'Configuration file not found. Please create mcp.servers.json in the project root.'
      );
    }
    throw new Error(`Failed to load config: ${error.message}`);
  }
}

/**
 * Get a specific server configuration by name
 */
export function getServerConfig(serverName, servers) {
  const config = servers[serverName];
  if (!config) {
    throw new Error(`Server '${serverName}' not found in configuration`);
  }

  if (config.type !== 'http') {
    throw new Error(`Server '${serverName}' is not an HTTP server`);
  }

  if (!config.url) {
    throw new Error(`Server '${serverName}' missing URL configuration`);
  }

  return config;
}

/**
 * List all configured server names
 */
export function listServers(servers) {
  return Object.keys(servers).map(name => ({
    name,
    url: servers[name].url,
    type: servers[name].type
  }));
}
