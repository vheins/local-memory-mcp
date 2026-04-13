import { SQLiteStore } from './src/mcp/storage/sqlite.js';
import path from 'path';
import fs from 'fs';

const newDbPath = '/home/vheins/.config/local-memory-mcp/memory.new.db';
if (fs.existsSync(newDbPath)) fs.unlinkSync(newDbPath);

console.log('Initializing new database...');
const store = await SQLiteStore.create(newDbPath);
console.log('Database initialized at:', store.getDbPath());
store.close();
process.exit(0);
