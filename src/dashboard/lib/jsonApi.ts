import express from "express";

export function jsonApiRes(data: unknown, type: string, extra: { meta?: unknown; links?: unknown } = {}) {
	const isArray = Array.isArray(data);
	const dataLayer = isArray
		? (data as Array<Record<string, unknown>>).map((item: Record<string, unknown>) => {
				const { id, ...attributes } = item;
				return { type, id: String(id || "system"), attributes };
			})
		: (() => {
				const { id, ...attributes } = data as Record<string, unknown>;
				return { type, id: String(id || attributes.id || "system"), attributes };
			})();

	return {
		jsonapi: { version: "1.1" },
		data: dataLayer,
		...extra
	};
}

export function jsonApiError(message: string, status: number = 500) {
	return {
		jsonapi: { version: "1.1" },
		errors: [{ status: String(status), detail: message }]
	};
}

export function getAttributes(req: express.Request) {
	return req.body.data?.attributes || req.body;
}
