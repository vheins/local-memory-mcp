export function sanitizeFtsTerm(raw: string): string {
	let cleaned = raw.replace(/[^\w\s]/g, " ").trim();
	cleaned = cleaned.replace(/\s+/g, " ");
	return cleaned;
}
