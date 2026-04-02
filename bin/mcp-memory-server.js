#!/usr/bin/env node
const sub = process.argv[2];
if (sub === 'dashboard' || sub === 'mcp-memory-dashboard') {
  import('../dist/dashboard/server.js');
} else {
  import('../dist/server.js');
}
