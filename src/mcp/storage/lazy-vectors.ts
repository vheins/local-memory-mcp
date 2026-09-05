import type { VectorEntityKind, VectorResult, VectorStore } from "../types";
import type { RuntimeCapabilityRegistry } from "../runtime-capabilities";

export class CapabilityAwareVectorStore implements VectorStore {
	constructor(
		private readonly inner: VectorStore,
		private readonly capabilities: RuntimeCapabilityRegistry
	) {}

	async initialize(): Promise<void> {
		await this.capabilities.ensure("semantic");
	}

	getInnerStore(): VectorStore {
		return this.inner;
	}

	async embed(texts: string[]): Promise<number[][]> {
		if (!(await this.capabilities.ensure("semantic"))) return [];
		const semantic = this.inner as VectorStore & { embed?: (values: string[]) => Promise<number[][]> };
		return semantic.embed ? semantic.embed(texts) : [];
	}

	async upsert(id: string, text: string, kind?: VectorEntityKind): Promise<void> {
		if (await this.capabilities.ensure("semantic")) await this.inner.upsert(id, text, kind);
	}

	async remove(id: string, kind?: VectorEntityKind): Promise<void> {
		await this.inner.remove(id, kind);
	}

	async search(query: string, limit: number, repo?: string, kind?: VectorEntityKind): Promise<VectorResult[]> {
		if (!(await this.capabilities.ensure("semantic"))) return [];
		return this.inner.search(query, limit, repo, kind);
	}
}
