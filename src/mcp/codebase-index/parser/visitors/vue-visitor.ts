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
 * tree-sitter-vue grammar nodes of interest:
 *   component        → top-level wrapper, repeats (element|template_element|script_element|style_element)
 *   script_element   → start_tag + optional(raw_text) + end_tag
 *   template_element → start_tag + repeat(_node) + end_tag
 *   style_element    → start_tag + optional(raw_text) + end_tag
 *   raw_text         → the inner content of a script/style block
 */
import type { Tree } from "web-tree-sitter";
import type { LanguageVisitor, ParsedSymbol } from "../language-visitor.js";
import { SymbolKind } from "../language-visitor.js";

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

function extractDocComment(lines: string[], lineIndex: number): string | null {
	const commentLines: string[] = [];
	let i = lineIndex - 1;
	while (i >= 0) {
		const line = lines[i];
		const trimmed = line.trim();

		// Single-line JSDoc: /** or /// style
		if (trimmed.startsWith("/**") || trimmed.startsWith("*") || trimmed.startsWith("*/")) {
			commentLines.unshift(trimmed.replace(/^\s*\/?\*+\s*/, "").replace(/\s*\*\/\s*$/, ""));
			i--;
			continue;
		}
		if (trimmed.startsWith("///") || trimmed.startsWith("//!")) {
			commentLines.unshift(trimmed.replace(/^\s*\/{2,3}[!\/]?\s*/, ""));
			i--;
			continue;
		}
		// Single-line // comments (not JSDoc — only take one line)
		if (trimmed.startsWith("//") && i === lineIndex - 1) {
			return trimmed.replace(/^\s*\/\/\s*/, "").trim();
		}
		// Empty line within doc comment block
		if (trimmed === "" && i < lineIndex - 1 && commentLines.length > 0) {
			commentLines.unshift("");
			i--;
			continue;
		}
		break;
	}

	if (commentLines.length === 0) return null;

	return (
		commentLines
			.filter((l) => l !== "" || commentLines.indexOf(l) > 0)
			.join("\n")
			.trim() || null
	);
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
			if (trimmed.startsWith("//")) continue;
			if (trimmed.startsWith("/*")) {
				// Skip block comments
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
}
