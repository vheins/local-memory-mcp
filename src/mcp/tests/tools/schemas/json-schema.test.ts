import { describe, it, expect } from "vitest";
import { z } from "zod";
import { fromJsonSchema } from "@modelcontextprotocol/server";
import { inputSchemaFromSchema } from "../../../tools/schemas/json-schema";
import { TaskWriteSchema } from "../../../tools/schemas/task";
import { MemoryWriteSchema } from "../../../tools/schemas/memory";

/**
 * Validate a derived JSON Schema through the exact SDK validator path
 * (`fromJsonSchema(...).~standard.validate`) the MCP server runs BEFORE the
 * handler / `normalizeToolArguments` (FIX-EMPTY-PARAMS).
 *
 * @param schema  derived tool `inputSchema`
 * @param data    raw tool arguments to validate
 * @returns the standard-schema validation result (`{ value }` or `{ issues }`)
 */
async function validateViaSdk(schema: Record<string, unknown>, data: unknown) {
	const validator = fromJsonSchema(schema as never) as {
		"~standard": { validate: (value: unknown) => Promise<{ issues?: unknown[]; value?: unknown }> };
	};
	return validator["~standard"].validate(data);
}

describe("inputSchemaFromSchema — empty-string acceptance (FIX-EMPTY-PARAMS)", () => {
	it("allows an empty string for a minLength-constrained property and rejects a short value", async () => {
		const schema = inputSchemaFromSchema(z.object({ title: z.string().min(3).max(100) }));

		const ok = await validateViaSdk(schema, { title: "" });
		expect(ok.issues).toBeUndefined();

		const bad = await validateViaSdk(schema, { title: "ab" });
		expect(bad.issues).toBeDefined();
	});

	it("allows an empty string for an enum property and rejects an unknown value", async () => {
		const schema = inputSchemaFromSchema(z.object({ status: z.enum(["pending", "completed"]) }));

		const ok = await validateViaSdk(schema, { status: "" });
		expect(ok.issues).toBeUndefined();

		const bad = await validateViaSdk(schema, { status: "nope" });
		expect(bad.issues).toBeDefined();
	});

	it("allows an empty string for a format-constrained (uuid) property and rejects a malformed value", async () => {
		const schema = inputSchemaFromSchema(z.object({ id: z.string().uuid() }));

		const ok = await validateViaSdk(schema, { id: "" });
		expect(ok.issues).toBeUndefined();

		const bad = await validateViaSdk(schema, { id: "not-a-uuid" });
		expect(bad.issues).toBeDefined();
	});

	it("wraps constrained strings as anyOf with a const-empty alternative", () => {
		const schema = inputSchemaFromSchema(z.object({ title: z.string().min(3) }));
		expect(schema.properties).toMatchObject({
			title: { anyOf: [{ type: "string", minLength: 3 }, { const: "" }] }
		});
	});

	it("allows empty strings on real tool schemas while still rejecting non-empty invalid values", async () => {
		const taskSchema = inputSchemaFromSchema(TaskWriteSchema);
		const taskOk = await validateViaSdk(taskSchema, { title: "", description: "" });
		expect(taskOk.issues).toBeUndefined();
		const taskBad = await validateViaSdk(taskSchema, { title: "ab", description: "x" });
		expect(taskBad.issues).toBeDefined();

		const memorySchema = inputSchemaFromSchema(MemoryWriteSchema);
		const memoryOk = await validateViaSdk(memorySchema, { content: "", title: "" });
		expect(memoryOk.issues).toBeUndefined();
	});
});
