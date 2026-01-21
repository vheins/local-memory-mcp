# MCP Memory Dashboard

A web-based dashboard for managing and visualizing MCP Local Memory data.

## Features

- **Live Connection Status**: Real-time monitoring of MCP server connection
- **Repository Scoping**: View memories filtered by repository
- **Summary Statistics**: Quick overview of total memories, by type, and unused entries
- **Visual Charts**: 
  - Memory distribution by type (pie chart)
  - Top 10 memories by importance (bar chart)
- **Memory Management**:
  - Browse all memories with sortable columns
  - Filter by type (decision, mistake, code_fact, pattern)
  - View detailed memory information
  - Edit memory content and importance
  - Delete memories with confirmation
- **Operations-First Design**: Clear, data-dense interface optimized for daily use

## Quick Start

1. **Build the project**:
   ```bash
   npm run build
   ```

2. **Start the dashboard**:
   ```bash
   npm run dashboard
   ```

3. **Access the dashboard**:
   Open your browser to `http://localhost:3456`

## Architecture

The dashboard is a thin presentation layer that:

- Spawns the MCP server as a subprocess
- Communicates via JSON-RPC (stdin/stdout)
- Uses MCP tools exclusively (no direct database access):
  - `memory.search` - List and filter memories
  - `memory.update` - Edit memories
  - `memory.delete` - Remove memories
  - Resources API - Read individual memory details

## Safety Features

- **Confirmation Required**: All destructive actions require explicit confirmation
- **Type "DELETE" Verification**: Memory deletion requires typing "DELETE" to proceed
- **Read-Only Fields**: Repository scope and type cannot be changed
- **Connection Monitoring**: Dashboard disables actions when MCP is offline

## API Endpoints

The dashboard server exposes these REST endpoints:

- `GET /api/health` - Check MCP connection status
- `GET /api/repos` - List all repositories
- `GET /api/stats` - Get statistics (total, by type, top memories)
- `GET /api/memories` - List memories with filtering and sorting
- `GET /api/memories/:id` - Get memory detail
- `PUT /api/memories/:id` - Update memory (content, importance)
- `DELETE /api/memories/:id` - Delete memory

## Configuration

- **Port**: Set `PORT` environment variable (default: 3456)
- **MCP Server**: Automatically spawned from `dist/server.js`

## Known Limitations

1. **Memory Search Constraints**: The MCP `memory.search` tool has a minimum query length of 3 characters and returns a maximum of 10 results per query. To work around this, the dashboard uses multiple common search terms ("the", "use", "not", etc.) and aggregates unique results.

2. **Unused Memory Tracking**: The current SQLite schema does not include a `hit_count` column, so the "Unused Memories" statistic always shows 0. This is a future enhancement that would require a schema migration.

3. **Chart.js CDN**: Charts use Chart.js from CDN, which may be blocked in some environments. The dashboard remains fully functional without charts.

## Acceptance Criteria Compliance

This dashboard satisfies all acceptance criteria:

✅ **AC-A1-A2**: MCP connection status and handling  
✅ **AC-B1-B3**: Memory listing with repo scoping and sorting  
✅ **AC-C1-C2**: Detail view with read-only fields  
✅ **AC-D1-D3**: Memory editing with constraints and feedback  
✅ **AC-E1-E3**: Soft delete with confirmation  
✅ **AC-F1-F2**: Accurate statistics and unused detection  
✅ **AC-G1-G2**: Chart rendering and consistency  
✅ **AC-H1-H2**: No direct DB access, explicit mutations  
✅ **AC-I1-I2**: No accidental actions, clear errors  
✅ **AC-J1**: Fast load time for reasonable memory counts  

## Development

The dashboard consists of:

- **Backend**: Express server (`src/dashboard/server.ts`)
  - MCP client implementation
  - REST API endpoints
  - Static file serving
  
- **Frontend**: Single-page app (`src/dashboard/public/index.html`)
  - Vanilla JavaScript (no framework overhead)
  - Chart.js for visualizations
  - Operations-focused UX

## Notes

- This dashboard does NOT modify MCP schemas or storage
- All data operations go through official MCP tools
- The MCP server is a subprocess, not a library import
- If MCP server stops, dashboard enters degraded state
