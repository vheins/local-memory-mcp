/**
 * VueVisitor — extracts symbols from Vue Single File Component (.vue) files.
 *
 * Strategy:
 * 1. Use tree-sitter to parse the SFC structure (template, script, style blocks).
 * 2. For <script> blocks, extract the raw_text (JS/TS content) and apply regex-based
 *    symbol extraction to find functions, classes, variables, etc.
 * 3. For <template> and <style> blocks, emit structural markers.
 * 4. Falls back to GenericTextVisitor regex scanning if tree-sitter parse fails.
 *
 * Reference edges (TASK-312 / Phase 1.1): delegated to the
 * vue-reference-emission.ts helper module — 'import' edges per binding of
 * every ES import statement in a <script>/<script setup> raw_text (the vue
 * grammar never TS-parses the script body), and 'instantiation' edges per
 * template component tag (PascalCase or kebab-case; native lowercase single
 * words emit nothing). See that module for the full semantics + documented
 * regex limitations.
 *
 * tree-sitter-vue grammar nodes of interest:
 *   component        → top-level wrapper, repeats (element|template_element|script_element|style_element)
 *   script_element   → start_tag + optional(raw_text) + end_tag
 *   template_element → start_tag + repeat(_node) + end_tag
 *   style_element    → start_tag + optional(raw_text) + end_tag
 *   raw_text         → the inner content of a script/style block
 *   element          → start_tag | self_closing_tag (+ nested element children)
 *   tag_name         → the tag text inside start_tag / self_closing_tag
 */
import type { Tree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedReference, ParsedSymbol } from "../language-visitor";
import { SymbolKind } from "../language-visitor";
import { serializeDocBlock } from "../doc-comment";
import {
	collectScriptImports,
	walkTemplate,
	SCRIPT_ELEMENT,
	TEMPLATE_ELEMENT,
	ELEMENT
} from "./vue-reference-emission";

// ── Regex patterns for JS/TS symbol extraction ────────────────────────

interface RegexDeclaration {
	regex: RegExp;
	kind: SymbolKind;
	extractName: (match: RegExpMatchArray) => string;
}

const JS_DECLARATIONS: RegexDeclaration[] = [
	// Function declarations: function name() / async function name()
	{
		regex: /^\s*(?:async\s+)?function\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Function,
		extractName: (m) => m[1]
	},
	// Class declarations
	{
		regex: /^\s*class\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Class,
		extractName: (m) => m[1]
	},
	// Interface declarations
	{
		regex: /^\s*interface\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Interface,
		extractName: (m) => m[1]
	},
	// Type alias: type Name =
	{
		regex: /^\s*type\s+([a-zA-Z_$][\w$]*)\s*=/,
		kind: SymbolKind.Type,
		extractName: (m) => m[1]
	},
	// Enum declarations
	{
		regex: /^\s*enum\s+([a-zA-Z_$][\w$]*)/,
		kind: SymbolKind.Enum,
		extractName: (m) => m[1]
	},
	// const/let/var declarations (top-level): const name = ...
	{
		regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*(?::|=)/,
		kind: SymbolKind.Variable,
		extractName: (m) => m[1]
	},
	// Arrow function assigned to variable: const name = (params) => ...
	{
		regex: /^\s*(?:export\s+)?(?:const|let|var)\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:async\s*)?\(/,
		kind: SymbolKind.Function,
		extractName: (m) => m[1]
	},
	// Computed/setup-style: const name = computed(() => ...) / const name = ref(...)
	{
		regex:
			/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=\s*(?:computed|ref|reactive|shallowRef|shallowReactive|watch|watchEffect)\s*\(/,
		kind: SymbolKind.Variable,
		extractName: (m) => m[1]
	}
];

// ── Helper: extract JS/TS doc comment from preceding lines ────────────
// Canonicalizes via serializeDocBlock after collecting raw lines so
// @param/@return/@deprecated stay searchable and deprecated is marked
// `[DEPRECATED]`. Fixes a pre-existing artifact that appended stray "/"
// characters from closing `*/` lines and keeps the sibling scan local to
// the doc block — non-doc content stops the walk instead of being folded
// into the comment.

function extractDocComment(lines: string[], lineIndex: number): string | null {
	const commentLines: string[] = [];
	let i = lineIndex - 1;
	// Tracks whether the walk has passed the JSDoc closing line (and thus
	// whether subsequent empty lines belong to the comment gap).
	let seenBlockClose = false;
	while (i >= 0) {
		const line = lines[i];
		const trimmed = line.trim();

		if (trimmed.startsWith("*/")) {
			// Closing delimiter: keep the optional suffix on the same line but
			// drop the bare `*/` — previous code had `.replace(/\s*\*\/\s*$/, "")`
			// inside a leading-char strip that mangled the remainder and pushed a
			// trailing `/` into the join.
			const suffix = trimmed.replace(/^\s*\*\/\s*/, "").trim();
			if (suffix) commentLines.unshift(suffix);
			seenBlockClose = true;
			i--;
			continue;
		}
		if (trimmed.startsWith("/**")) {
			const inner = trimmed.replace(/^\/\*\*?\s*/, "").trim();
			if (inner) commentLines.unshift(inner);
			// The opening line caps the comment — stop even if the loop would
			// otherwise continue past leading star lines.
			break;
		}
		if (trimmed.startsWith("*")) {
			commentLines.unshift(trimmed.replace(/^\s*\*\s?/, "").trim());
			i--;
			continue;
		}
		if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
			commentLines.unshift(trimmed.replace(/^\s*\/{2,3}[!/]?\s*/, ""));
			i--;
			continue;
		}
		// Single-line // comments (not JSDoc — only take the one immediately
		// above the declaration).
		if (trimmed.startsWith("//") && i === lineIndex - 1) {
			const raw = trimmed.replace(/^\s*\/\/\s*/, "").trim();
			return raw ? (serializeDocBlock(raw) ?? raw) : null;
		}
		// Empty line within doc comment block
		if (trimmed === "" && seenBlockClose && commentLines.length > 0) {
			// Preserve a blank gap inside the comment (currently filtered by
			// serializeDocBlock anyway — kept so future prose-preservation is
			// a doc-comment.ts tweak, not a Vue-side fix).
			i--;
			continue;
		}
		break;
	}

	if (commentLines.length === 0) return null;

	const raw = commentLines.join("\n").trim();
	if (!raw) return null;
	return serializeDocBlock(raw) ?? raw;
}

// ── Line skipping helpers ─────────────────────────────────────────────

function skipImportExportLines(lines: string[], startIdx: number): number {
	let idx = startIdx;
	while (idx < lines.length) {
		const trimmed = lines[idx].trim();
		if (/^\s*(import|export\s+(default\s+)?\{|})\s/.test(trimmed) || /^\s*export\s+default\s/.test(trimmed)) {
			idx++;
			continue;
		}
		break;
	}
	return idx;
}

// ── Visitor ───────────────────────────────────────────────────────────

export class VueVisitor implements LanguageVisitor {
	extractSymbols(tree: Tree | null, sourceCode: string): ParsedSymbol[] {
		// If tree is null (grammar failed to load), fallback to regex
		if (!tree) {
			return this.extractViaRegexFallback(sourceCode);
		}

		const symbols: ParsedSymbol[] = [];
		const root = tree.rootNode;

		// Check if the parse had errors that indicate the tree is unreliable
		if (root.hasError) {
			// Still try tree-first, then fallback if no symbols found
			this.extractViaTree(root, symbols);
			if (symbols.length === 0) {
				return this.extractViaRegexFallback(sourceCode);
			}
			return symbols;
		}

		this.extractViaTree(root, symbols);
		return symbols;
	}

	// ── Tree-based extraction ──────────────────────────────────────

	private extractViaTree(root: import("web-tree-sitter").Node, symbols: ParsedSymbol[]): void {
		// Walk all direct children of the component (or file-level) node
		for (let i = 0; i < root.namedChildCount; i++) {
			const child = root.namedChild(i);
			if (!child) continue;

			if (child.type === "script_element") {
				this.extractScriptBlock(child, symbols);
			} else if (child.type === "template_element" || child.type === "element") {
				// Emit a structural marker for the template
				symbols.push({
					name: "<template>",
					kind: SymbolKind.Class,
					startLine: child.startPosition.row + 1,
					startCol: child.startPosition.column + 1,
					endLine: child.endPosition.row + 1,
					endCol: child.endPosition.column + 1,
					signature: "Vue template block",
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			} else if (child.type === "style_element") {
				// Emit a structural marker for the style block
				const attrs = this.extractStyleAttributes(child);
				symbols.push({
					name: `<style${attrs}>`,
					kind: SymbolKind.Key,
					startLine: child.startPosition.row + 1,
					startCol: child.startPosition.column + 1,
					endLine: child.endPosition.row + 1,
					endCol: child.endPosition.column + 1,
					signature: `Vue style block${attrs}`,
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			}
		}
	}

	/** Extract attributes from a style element's start tag for display. */
	private extractStyleAttributes(node: import("web-tree-sitter").Node): string {
		const startTag = node.namedChild(0);
		if (!startTag || startTag.type !== "start_tag") return "";

		const lang: string[] = [];
		const scoped: string[] = [];
		for (let i = 0; i < startTag.namedChildCount; i++) {
			const attr = startTag.namedChild(i);
			if (attr?.type === "attribute") {
				const nameNode = attr.namedChild(0);
				const valueNode = attr.namedChild(1);
				if (nameNode?.text === "lang" && valueNode) {
					lang.push(`lang="${valueNode.text.replace(/^["']|["']$/g, "")}"`);
				}
				if (nameNode?.text === "scoped") {
					scoped.push("scoped");
				}
			}
		}
		const parts = [...lang, ...scoped];
		return parts.length > 0 ? ` ${parts.join(" ")}` : "";
	}

	/** Extract raw_text from a script_element and parse symbols via regex. */
	private extractScriptBlock(node: import("web-tree-sitter").Node, symbols: ParsedSymbol[]): void {
		let rawTextContent = "";
		let rawTextStartLine = node.startPosition.row + 1;

		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i);
			if (child?.type === "raw_text") {
				rawTextContent = child.text;
				rawTextStartLine = child.startPosition.row + 1;
				break;
			}
		}

		if (!rawTextContent) return;

		// Determine script language from the start tag attributes
		const lang = this.extractScriptLang(node);

		// Parse the script content for JS/TS symbols
		this.parseScriptContent(rawTextContent, rawTextStartLine, lang, symbols);
	}

	/** Get the lang attribute from a script tag (ts, js, etc.). */
	private extractScriptLang(node: import("web-tree-sitter").Node): string {
		const startTag = node.namedChild(0);
		if (!startTag || startTag.type !== "start_tag") return "js";
		for (let i = 0; i < startTag.namedChildCount; i++) {
			const attr = startTag.namedChild(i);
			if (attr?.type === "attribute") {
				const nameNode = attr.namedChild(0);
				const valueNode = attr.namedChild(1);
				if (nameNode?.text === "lang" && valueNode) {
					return valueNode.text.replace(/^["']|["']$/g, "").toLowerCase();
				}
			}
		}
		return "js";
	}

	/** Parse JS/TS source code using regex patterns. */
	private parseScriptContent(code: string, baseLine: number, lang: string, symbols: ParsedSymbol[]): void {
		const lines = code.split("\n");
		let i = skipImportExportLines(lines, 0);

		for (; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();
			const globalLine = baseLine + i;

			// Skip empty lines, comments, and import/export lines
			if (trimmed === "") continue;
			// Single-line // comments are skipped; multi-line /** */ doc blocks
			// are intentionally NOT skipped here — they are consumed by
			// extractDocComment when it walks preceding lines.
			if (trimmed.startsWith("//")) continue;
			if (trimmed.startsWith("/*") && !trimmed.startsWith("/**")) {
				// Skip non-doc block comments
				while (i < lines.length && !lines[i].includes("*/")) i++;
				continue;
			}
			if (/^(import|export\s+(default\s+)?\{|export\s+default)\s/.test(trimmed)) continue;
			if (trimmed === "}" || trimmed === ");" || trimmed === "});") continue;

			// Try each declaration pattern
			for (const decl of JS_DECLARATIONS) {
				const match = trimmed.match(decl.regex);
				if (match) {
					const name = decl.extractName(match);
					const docComment = extractDocComment(lines, i);

					const signature = trimmed.length > 256 ? trimmed.substring(0, 253) + "..." : trimmed;

					// Check for export keyword
					const exported = /^\s*export\s+/.test(trimmed);

					symbols.push({
						name,
						kind: decl.kind,
						startLine: globalLine,
						startCol: line.indexOf(trimmed[0]) + 1,
						endLine: globalLine,
						endCol: line.length,
						signature,
						docComment,
						exported,
						defaultExport: exported && /export\s+default\s/.test(trimmed),
						parentName: null
					});
					break;
				}
			}
		}

		// If we found no symbols with the standard patterns, try broader patterns
		if (symbols.length === 0) {
			this.extractGenericScriptSymbols(lines, baseLine, symbols);
		}
	}

	/** Broader fallback scan for any recognizable symbols in the script. */
	private extractGenericScriptSymbols(lines: string[], baseLine: number, symbols: ParsedSymbol[]): void {
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i].trim();
			if (trimmed === "" || trimmed.startsWith("//")) continue;

			const globalLine = baseLine + i;

			// const/let/var assignment (any)
			const constMatch = trimmed.match(/^\s*const\s+([a-zA-Z_$][\w$]*)\s*=/);
			if (constMatch) {
				symbols.push(this.makeSymbol(constMatch[1], SymbolKind.Variable, globalLine, trimmed, lines, i));
				continue;
			}

			// export default { name: "ComponentName" } or export default defineComponent({ name: "..." })
			const exportDefaultDefine = trimmed.match(/export\s+default\s+defineComponent/);
			if (exportDefaultDefine) {
				symbols.push(this.makeSymbol("default", SymbolKind.Class, globalLine, trimmed, lines, i));
				continue;
			}

			// name: 'ComponentName' (Options API)
			const nameMatch = trimmed.match(/^\s*name\s*:\s*['"]([^'"]+)['"]/);
			if (nameMatch) {
				symbols.push(this.makeSymbol(nameMatch[1], SymbolKind.Class, globalLine, trimmed, lines, i));
				continue;
			}
		}
	}

	private makeSymbol(
		name: string,
		kind: SymbolKind,
		line: number,
		lineText: string,
		lines: string[],
		lineIdx: number
	): ParsedSymbol {
		const signature = lineText.length > 256 ? lineText.substring(0, 253) + "..." : lineText;
		const docComment = extractDocComment(lines, lineIdx);
		const exported = /^\s*export\s+/.test(lineText);

		return {
			name,
			kind,
			startLine: line,
			startCol: lineText.indexOf(lineText.trim()[0]) + 1,
			endLine: line,
			endCol: lineText.length,
			signature,
			docComment,
			exported,
			defaultExport: false,
			parentName: null
		};
	}

	// ── Regex fallback (no tree-sitter grammar available) ──────────

	private extractViaRegexFallback(sourceCode: string): ParsedSymbol[] {
		const symbols: ParsedSymbol[] = [];
		const lines = sourceCode.split("\n");

		// Extract the <script> block manually via regex
		const scriptMatch = sourceCode.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/i);

		if (scriptMatch) {
			const scriptContent = scriptMatch[1];
			const scriptStartLine = sourceCode.substring(0, scriptMatch.index).split("\n").length;

			this.parseScriptContent(scriptContent, scriptStartLine, "js", symbols);
		}

		// Emit template marker if present
		if (/<template[\s>]/i.test(sourceCode)) {
			const tplLine = sourceCode.split("\n").findIndex((l) => /<template[\s>]/i.test(l)) + 1;
			if (tplLine > 0) {
				symbols.push({
					name: "<template>",
					kind: SymbolKind.Class,
					startLine: tplLine,
					startCol: 1,
					endLine: tplLine,
					endCol: lines[tplLine - 1]?.length ?? 1,
					signature: "Vue template block",
					docComment: null,
					exported: false,
					defaultExport: false,
					parentName: null
				});
			}
		}

		return symbols;
	}

	// ── Reference emission (TASK-312 / Phase 1.1) ─────────────────────

	/**
	 * Emit reference edges for a Vue SFC (TASK-312 / Phase 1.1). Locates the
	 * top-level <script> / <template> blocks and delegates the per-block work
	 * to vue-reference-emission.ts (extracted in review FIX-2):
	 * - 'import' per ES import binding in every <script> / <script setup>
	 *   block;
	 * - 'instantiation' per template component tag in the template body.
	 *
	 * callerName is null for both families (imports are file-scope; a template
	 * usage has no enclosing function). targetFile/targetSymbolId are explicit
	 * null per the canonical TASK-347 pushRef pattern — edges are name-based,
	 * ADR-002 resolution happens at query time.
	 */
	extractReferences(tree: Tree | null, _sourceCode: string): ParsedReference[] {
		const refs: ParsedReference[] = [];
		if (!tree) return refs;

		const root = tree.rootNode;
		for (let i = 0; i < root.namedChildCount; i++) {
			const child = root.namedChild(i);
			if (!child) continue;
			if (child.type === SCRIPT_ELEMENT) {
				collectScriptImports(child, refs);
			} else if (child.type === TEMPLATE_ELEMENT || child.type === ELEMENT) {
				// Element children may sit directly under the root when the SFC
				// has no <template> wrapper; both routes share the same walk.
				walkTemplate(child, refs);
			}
		}
		return refs;
	}
}
