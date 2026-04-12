import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath("file:///home/vheins/Projects/local-memory-mcp/dist/chunk-LUMCJABW.js");
const __dirname = path.dirname(__filename);

const candidates = [
    "../prompts",
    "./definitions",
    "./prompts"
].map((relPath) => path.resolve(__dirname, relPath));

console.log("__dirname is:", __dirname);
console.log("Candidates:");
candidates.forEach(c => console.log(c));
