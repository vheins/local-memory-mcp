import Database from "better-sqlite3";
import { readFileSync } from "fs";

const DB_PATH = "./storage/memory.db";
const db = new Database(DB_PATH);

// Get all memories with null titles
const memories = db.prepare("SELECT id, type, content FROM memories WHERE title IS NULL OR title = ''").all();

console.log(`Found ${memories.length} memories with null titles`);

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen3.5:cloud";

async function generateTitle(content, type) {
  const prompt = `Based on this memory content, generate a short descriptive title (max 50 characters).
  
Memory type: ${type}
Content: ${content.substring(0, 500)}

Respond ONLY with the title, nothing else.`;

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false,
        format: "json"
      })
    });

    const data = await response.json();
    let title = data.response?.trim() || "";
    
    // Clean up title
    title = title.replace(/^["']|["']$/g, "").trim();
    if (title.length > 50) {
      title = title.substring(0, 47) + "...";
    }
    
    return title || content.substring(0, 47) + "...";
  } catch (error) {
    console.error("Error generating title:", error.message);
    return content.substring(0, 47) + "...";
  }
}

let processed = 0;

for (const memory of memories) {
  const title = await generateTitle(memory.content, memory.type);
  
  db.prepare("UPDATE memories SET title = ? WHERE id = ?").run(title, memory.id);
  
  processed++;
  console.log(`[${processed}/${memories.length}] ${memory.id.substring(0, 8)} -> "${title}"`);
  
  // Small delay to not overload the LLM
  await new Promise(r => setTimeout(r, 100));
}

console.log("Done!");
db.close();
