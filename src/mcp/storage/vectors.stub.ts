import { VectorStore, VectorResult } from "../types";
import { SQLiteStore } from "./sqlite";
import { logger } from "../utils/logger";

const STUB_STOPWORDS = new Set([
	// English stopwords
	"the",
	"is",
	"at",
	"which",
	"on",
	"and",
	"or",
	"but",
	"for",
	"with",
	"to",
	"from",
	"by",
	"as",
	"in",
	"of",
	"a",
	"an",
	"be",
	"this",
	"that",
	"are",
	"was",
	"were",
	"been",
	"have",
	"has",
	"had",
	"do",
	"does",
	"did",
	// Indonesian stopwords
	"yang",
	"di",
	"ke",
	"dari",
	"untuk",
	"dengan",
	"oleh",
	"pada",
	"dalam",
	"atas",
	"bawah",
	"depan",
	"belakang",
	"samping",
	"sebelah",
	"antara",
	"diantara",
	"melalui",
	"selama",
	"sampai",
	"hingga",
	"sejak",
	"sebelum",
	"sesudah",
	"setelah",
	"sebelumnya",
	"kemudian",
	"selanjutnya",
	"lagi",
	"juga",
	"pun",
	"bahkan",
	"malah",
	"bahwa",
	"karena",
	"sebab",
	"oleh",
	"karena",
	"sehingga",
	"maka",
	"lalu",
	"kemudian",
	"saya",
	"kamu",
	"dia",
	"kami",
	"kalian",
	"mereka",
	"aku",
	"engkau",
	"ia",
	"kita",
	"anda",
	"beliau",
	"mereka",
	"siapa",
	"apa",
	"dimana",
	"kapan",
	"bagaimana",
	"mengapa",
	"berapa",
	"banyak",
	"sedikit",
	"semua",
	"beberapa",
	"banyak",
	"sedikit",
	"hampir",
	"hanya",
	"sudah",
	"belum",
	"masih",
	"lagi",
	"selalu",
	"kadang",
	"sering",
	"jarang",
	"pernah",
	"belum",
	"sudah",
	"akan",
	"sedang",
	"telah",
	"baru",
	"lama",
	"cepat",
	"lambat",
	"besar",
	"kecil",
	"panjang",
	"pendek",
	"tinggi",
	"rendah",
	"lebar",
	"sempit",
	"tebal",
	"tipis",
	"berat",
	"ringan",
	"kuat",
	"lemah",
	"baik",
	"buruk",
	"benar",
	"salah",
	"cantik",
	"jelek",
	"indah",
	"buruk",
	"bagus",
	"jelek",
	"suka",
	"tidak",
	"bukan",
	"jangan",
	"harus",
	"boleh",
	"bisa",
	"mampu",
	"dapat",
	"mau",
	"ingin",
	"perlu",
	"penting",
	// Additional common Indonesian words
	"dan",
	"atau",
	"tapi",
	"namun",
	"lalu",
	"kemudian",
	"jadi",
	"maka",
	"yaitu",
	"yakni"
]);

// Simple vector store using SQLite - lightweight embeddings without ollama
export class StubVectorStore implements VectorStore {
	private db: SQLiteStore;

	constructor(db?: SQLiteStore) {
		if (!db) {
			throw new Error("SQLiteStore required for vector operations");
		}
		this.db = db;
	}

	// Generate simple text-based vector (TF-IDF style) without external embeddings
	private generateTextVector(text: string): string[] {
		const normalized = text
			.toLowerCase()
			// Remove punctuation and special characters, but keep Indonesian characters
			.replace(/[^\w\s\u00C0-\u017F]/g, " ")
			// Normalize multiple spaces to single space
			.replace(/\s+/g, " ")
			.trim()
			.split(/\s+/)
			.filter((word) => word.length > 2);

		return normalized.filter((word) => !STUB_STOPWORDS.has(word));
	}

	// Calculate similarity between two token sets
	private calculateSimilarity(tokens1: string[], tokens2: string[]): number {
		if (tokens1.length === 0 || tokens2.length === 0) return 0;

		const set1 = new Set(tokens1);
		const set2 = new Set(tokens2);

		// Jaccard similarity: intersection / union
		const intersection = new Set([...set1].filter((x) => set2.has(x)));
		const union = new Set([...set1, ...set2]);

		return union.size > 0 ? intersection.size / union.size : 0;
	}

	async upsert(id: string, text: string): Promise<void> {
		try {
			// Generate simple vector from text tokens
			const tokens = this.generateTextVector(text);

			// Store tokens as JSON array for better retrieval
			this.db.memories.upsertVectorEmbedding(
				id,
				tokens.map(() => 0)
			); // Stub implementation using placeholder numbers
		} catch {
			// Silently fail - vector is optional for search fallback
		}
	}

	async remove(id: string): Promise<void> {
		if (!id) return;
		// Handled by SQL CASCADE
	}

	async search(query: string, limit: number, repo?: string): Promise<VectorResult[]> {
		if (limit < 0) return [];
		if (repo === "never") return [];
		try {
			// Get all memories and compute similarity to query
			const queryTokens = this.generateTextVector(query);

			if (queryTokens.length === 0) {
				return [];
			}

			// For now, return empty - we'll use similarity search in SQLite instead
			// In production, you could implement approximate nearest neighbor search here
			return [];
		} catch (error) {
			logger.error("Error searching vectors", { error: String(error) });
			return [];
		}
	}
}
