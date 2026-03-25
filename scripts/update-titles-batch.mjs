import Database from "better-sqlite3";

const DB_PATH = "./storage/memory.db";
const db = new Database(DB_PATH);

// Get all memories with null titles
const memories = db.prepare("SELECT id, type, content FROM memories WHERE title IS NULL OR title = ''").all();

console.log(`Found ${memories.length} memories with null titles`);

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen3.5:cloud";

async function generateTitlesBatch(contents) {
  const prompt = `Generate short titles (max 50 chars) for each of these ${contents.length} memory entries. 
Respond with a JSON array of titles in the same order, nothing else.

${contents.map((c, i) => `${i + 1}. [${c.type}] ${c.content.substring(0, 200)}`).join('\n')}`;

  try {
    const response = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        stream: false
      })
    });

    const data = await response.json();
    let text = data.response?.trim() || "";
    
    // Try to parse as JSON array
    try {
      const titles = JSON.parse(text);
      return titles;
    } catch {
      // If not valid JSON, try to extract titles manually
      const lines = text.split('\n').filter(l => l.trim());
      return lines.map(l => l.replace(/^\d+[\.\)]\s*/, '').replace(/^["']|["']$/g, '').trim().substring(0, 50));
    }
  } catch (error) {
    console.error("Error:", error.message);
    return contents.map(c => c.content.substring(0, 47) + "...");
  }
}

// Process in batches
const BATCH_SIZE = 10;
let processed = 0;

for (let i = 0; i < memories.length; i += BATCH_SIZE) {
  const batch = memories.slice(i, i + BATCH_SIZE);
  const titles = await generateTitlesBatch(batch);
  
  for (let j = 0; j < batch.length; j++) {
    let title = titles[j] || batch[j].content.substring(0, 47) + "...";
    title = title.replace(/^["']|["']$/g, '').trim();
    if (title.length > 50) title = title.substring(0, 47) + "...";
    
    db.prepare("UPDATE memories SET title = ? WHERE id = ?").run(title, batch[j].id);
    processed++;
  }
  
  console.log(`[${processed}/${memories.length}] Batch ${Math.ceil((i + BATCH_SIZE) / BATCH_SIZE)} done`);
  await new Promise(r => setTimeout(r, 500));
}

console.log("Done!");
db.close();
