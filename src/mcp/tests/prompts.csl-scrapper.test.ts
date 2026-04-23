import { describe, expect, it } from "vitest";
import { createRouter } from "../router";

describe("csl-scrapper prompt", () => {
	it("is listed through prompts/list", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/list", {})) as {
			prompts: Array<{ name: string; description: string }>;
		};

		expect(result.prompts.some((prompt) => prompt.name === "csl-scrapper")).toBe(true);
	});

	it("returns substituted prompt text through prompts/get", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/get", {
			name: "csl-scrapper",
			arguments: {
				source_title: "React Docs - Rules of Hooks",
				source_url: "https://react.dev/reference/rules/rules-of-hooks",
				documentation_content: "Only call Hooks at the top level. Don’t call Hooks inside loops, conditions, or nested functions."
			}
		})) as {
			description: string;
			messages: Array<{ content: { text: string } }>;
		};

		expect(result.description).toContain("atomic CSL");
		expect(result.messages[0].content.text).toContain("React Docs - Rules of Hooks");
		expect(result.messages[0].content.text).toContain("https://react.dev/reference/rules/rules-of-hooks");
		expect(result.messages[0].content.text).toContain("Only call Hooks at the top level");
		expect(result.messages[0].content.text).toContain("standard-store");
	});

	it("includes explicit refusal guidance for unverifiable sources", async () => {
		const router = createRouter({} as never, {} as never);

		const result = (await router("prompts/get", {
			name: "csl-scrapper",
			arguments: {
				source_title: "Unknown Source",
				source_url: "https://example.com/unknown",
				documentation_content: "content unavailable"
			}
		})) as {
			messages: Array<{ content: { text: string } }>;
		};

		const promptText = result.messages[0].content.text;
		expect(promptText).toContain("Refusal rules:");
		expect(promptText).toContain("not documentation");
		expect(promptText).toContain("too incomplete to verify atomic rules");
		expect(promptText).toContain('"action": "refuse"');
	});
});
