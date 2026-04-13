import { type SessionContext } from "../session";
import { type ElicitationRequestHandler } from "../elicitation";

export interface SamplingRequestHandler {
	(params: Record<string, unknown>): Promise<unknown>;
}

export interface TaskCreateInteractiveOptions {
	session?: SessionContext;
	elicit?: ElicitationRequestHandler;
}
