// MCP Server Capabilities
export const CAPABILITIES = {
  serverInfo: {
    name: "mcp-memory-local",
    version: "0.1.0"
  },
  capabilities: {
    resources: {
      list: true,
      read: true,
      templates: true
    },
    tools: {
      list: true,
      call: true
    },
    prompts: {
      list: true,
      get: true
    }
  }
};
