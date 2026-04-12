export interface SamplingRequestHandler {
	(params: Record<string, unknown>): Promise<unknown>;
}

export interface ElicitationRequestHandler {
	(params: Record<string, unknown>): Promise<unknown>;
}
