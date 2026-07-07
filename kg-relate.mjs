import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import os from "os";

function resolveDbPath() {
	if (process.env.MEMORY_DB_PATH) return process.env.MEMORY_DB_PATH;
	const standard = path.join(os.homedir(), ".config", "local-memory-mcp", "memory.db");
	const local = path.join(process.cwd(), "storage", "memory.db");
	for (const p of [standard, local]) {
		if (fs.existsSync(p)) return p;
	}
	return standard;
}

const dbPath = resolveDbPath();
console.log("Using DB:", dbPath);
const db = new Database(dbPath);

// Ensure relations table is clean
db.exec("DELETE FROM relations;");
console.log("Cleared all existing relations.");

// Get all entities with their types
const entityTypes = new Map();
const entityRepos = new Map();
for (const row of db.prepare("SELECT name, type, repo FROM entities").all()) {
	entityTypes.set(row.name, row.type);
	entityRepos.set(row.name, row.repo);
}

// Get observations grouped by observation text + repo
const observations = db
	.prepare(
		`
  SELECT observation, entity_name, repo
  FROM observations
  ORDER BY observation, entity_name
`
	)
	.all();

// Group by observation text + repo
const groups = new Map();
for (const obs of observations) {
	const key = `${obs.repo}||${obs.observation}`;
	if (!groups.has(key)) {
		groups.set(key, { repo: obs.repo, names: new Set() });
	}
	groups.get(key).names.add(obs.entity_name);
}

console.log("Total observation groups:", groups.size);

// Strategy: create relations only between entities of DIFFERENT types
// and limit to 8 entities per group to control explosion
// This produces meaningful relations between e.g. people and projects,
// organizations and concepts, etc. while filtering out noise.
const MAX_ENTITIES = 8;

const insertRelation = db.prepare(`
  INSERT OR IGNORE INTO relations (from_entity, to_entity, relation_type, repo, owner, created_at)
  VALUES (?, ?, 'co-occurs-with', ?, '', ?)
`);

const relationTypeMap = {
	person: "person",
	place: "place",
	organization: "organization",
	concept: "concept"
};

const now = new Date().toISOString();
let relationCount = 0;

function getTypePriority(type) {
	// Higher priority = more likely to be meaningful relation source
	return { person: 4, organization: 3, place: 2, concept: 1 }[type] || 0;
}

const insertBatch = db.transaction(() => {
	for (const [, group] of groups) {
		const names = [...group.names].slice(0, MAX_ENTITIES);
		if (names.length < 2) continue;

		// Sort by type priority (person/org first) for consistent direction
		names.sort(
			(a, b) => getTypePriority(entityTypes.get(a) || "concept") - getTypePriority(entityTypes.get(b) || "concept")
		);

		for (let i = 0; i < names.length; i++) {
			const typeA = entityTypes.get(names[i]) || "concept";
			for (let j = i + 1; j < names.length; j++) {
				const typeB = entityTypes.get(names[j]) || "concept";
				// Skip concept↔concept pairs (too noisy)
				if (typeA === "concept" && typeB === "concept") continue;
				insertRelation.run(names[i], names[j], group.repo, now);
				relationCount++;
			}
		}
	}
});

console.log("Creating relations (meaningful cross-type pairs)...");
insertBatch();
console.log("Created relations:", relationCount);

const total = db.prepare("SELECT COUNT(*) as cnt FROM relations").get();
console.log("Total relations now:", total.cnt);

// Stats
const stats = db
	.prepare(
		`
  SELECT 'Entities with relations' as label, COUNT(DISTINCT from_entity) as val FROM relations
  UNION ALL
  SELECT 'Avg relations/entity', ROUND(AVG(cnt), 1) FROM (SELECT from_entity, COUNT(*) as cnt FROM relations GROUP BY from_entity)
  UNION ALL
  SELECT 'Max relations/entity', MAX(cnt) FROM (SELECT from_entity, COUNT(*) as cnt FROM relations GROUP BY from_entity)
`
	)
	.all();
for (const s of stats) {
	console.log(`${s.label}: ${s.val}`);
}

const repoSpecific = db
	.prepare(
		`
  SELECT repo, COUNT(*) as cnt FROM relations GROUP BY repo ORDER BY cnt DESC LIMIT 10
`
	)
	.all();
console.log("\nTop 10 repos by relation count:");
for (const r of repoSpecific) {
	console.log(`  ${r.repo}: ${r.cnt}`);
}
