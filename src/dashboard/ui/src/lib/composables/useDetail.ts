import { writable, get, derived } from "svelte/store";
import { api } from "../api";
import type { Memory, Task, TaskComment, CodingStandard, Handoff } from "../stores";
import { copyToClipboard } from "../utils";

interface HandoffForm {
	from_agent: string;
	to_agent: string;
	task_code: string;
	summary: string;
	context: string;
}

const INITIAL_HANDOFF_FORM: HandoffForm = {
	from_agent: "",
	to_agent: "",
	task_code: "",
	summary: "",
	context: ""
};

interface StandardForm {
	name: string;
	context: string;
	version: string;
	language: string;
	stack: string;
	tags: string;
	metadata: string;
	content: string;
	parent_id: string;
}

const INITIAL_STANDARD_FORM: StandardForm = {
	name: "",
	context: "general",
	version: "1.0.0",
	language: "",
	stack: "",
	tags: "",
	metadata: '{"source":"dashboard"}',
	content: "",
	parent_id: ""
};

function splitList(value: string) {
	return value
		.split(",")
		.map((item) => item.trim())
		.filter(Boolean);
}

function parseMetadata(value: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(value) as Record<string, unknown>;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0
			? parsed
			: null;
	} catch {
		return null;
	}
}

function stringifyMetadata(value: Record<string, unknown>) {
	return JSON.stringify(value, null, 2);
}

export interface DetailState {
	memory: Memory | null;
	task: Task | null;
	standard: CodingStandard | null;
	handoff: Handoff | null;
	editingTitle: boolean;
	editingDescription: boolean;
	editTitle: string;
	editDescription: string;
	newComment: string;
	postingComment: boolean;
	editingCommentId: string | null;
	editCommentText: string;
	savingComment: boolean;
	contentCopied: boolean;
	descCopied: boolean;
	standardEditing: boolean;
	standardForm: StandardForm;
	standardSaving: boolean;
	standardDeleting: boolean;
	standardError: string;
	handoffCreating: boolean;
	handoffUpdating: boolean;
	handoffForm: HandoffForm;
	handoffError: string;
}

export const STATUS_FLOW: Record<string, { next: string; label: string; color: string }[]> = {
	backlog: [{ next: "pending", label: "Move to To Do", color: "#0ea5e9" }],
	pending: [{ next: "in_progress", label: "Start Progress", color: "#a855f7" }],
	in_progress: [
		{ next: "completed", label: "Mark Complete", color: "#10b981" },
		{ next: "blocked", label: "Mark Blocked", color: "#ef4444" }
	],
	blocked: [{ next: "in_progress", label: "Resume Progress", color: "#a855f7" }],
	completed: [],
	canceled: []
};

export function createDetailHandler() {
	const initialState: DetailState = {
		memory: null,
		task: null,
		standard: null,
		handoff: null,
		editingTitle: false,
		editingDescription: false,
		editTitle: "",
		editDescription: "",
		newComment: "",
		postingComment: false,
		editingCommentId: null,
		editCommentText: "",
		savingComment: false,
		contentCopied: false,
		descCopied: false,
		standardEditing: false,
		standardForm: { ...INITIAL_STANDARD_FORM },
		standardSaving: false,
		standardDeleting: false,
		standardError: "",
		handoffCreating: false,
		handoffUpdating: false,
		handoffForm: { ...INITIAL_HANDOFF_FORM },
		handoffError: ""
	};

	const { subscribe, update } = writable<DetailState>(initialState);

	const mode = derived({ subscribe }, ($s) => {
		return $s.task ? "task" : $s.memory ? "memory" : $s.handoff ? "handoff" : $s.standard ? "standard" : null;
	});

	async function handleCopyContent(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

	async function handleCopyDesc(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, descCopied: true }));
			setTimeout(() => update((s) => ({ ...s, descCopied: false })), 2000);
		}
	}

	async function saveField<K extends keyof Task>(field: K, value: Task[K], onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.task) return;

		try {
			const updatedTask = await api.updateTask(state.task.id, { [field]: value });
			update((s) => ({ ...s, task: updatedTask }));
			onUpdated(updatedTask);
		} catch (e) {
			console.error(`Failed to update task field ${String(field)}:`, e);
			throw e;
		}
	}

	async function saveTitle(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		const title = state.editTitle.trim();
		if (!title) return;

		await saveField("title", title, onUpdated);
		update((s) => ({ ...s, editingTitle: false }));
	}

	async function saveDescription(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		await saveField("description", state.editDescription, onUpdated);
		update((s) => ({ ...s, editingDescription: false }));
	}

	async function advanceStatus(next: string, onUpdated: (task: Task) => void) {
		await saveField("status", next, onUpdated);
	}

	async function postComment(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.task || !state.newComment.trim()) return;

		update((s) => ({ ...s, postingComment: true }));
		try {
			const refreshed = await api.updateTask(state.task.id, { comment: state.newComment.trim() });
			update((s) => ({ ...s, task: refreshed, newComment: "" }));
			onUpdated(refreshed);
		} catch (e) {
			console.error("Failed to post comment:", e);
		} finally {
			update((s) => ({ ...s, postingComment: false }));
		}
	}

	async function saveEditComment(onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!state.editingCommentId || !state.editCommentText.trim()) return;

		update((s) => ({ ...s, savingComment: true }));
		try {
			await api.updateTaskComment(state.editingCommentId, state.editCommentText.trim());
			if (state.task) {
				const refreshed = await api.taskById(state.task.id);
				if (refreshed) {
					update((s) => ({ ...s, task: refreshed }));
					onUpdated(refreshed);
				}
			}
			update((s) => ({ ...s, editingCommentId: null, editCommentText: "" }));
		} catch (e) {
			console.error("Failed to update comment:", e);
		} finally {
			update((s) => ({ ...s, savingComment: false }));
		}
	}

	async function deleteComment(commentId: string, onUpdated: (task: Task) => void) {
		const state = get({ subscribe });
		if (!confirm("Delete this comment?")) return;

		try {
			await api.deleteTaskComment(commentId);
			if (state.task) {
				const refreshed = await api.taskById(state.task.id);
				if (refreshed) {
					update((s) => ({ ...s, task: refreshed }));
					onUpdated(refreshed);
				}
			}
		} catch (e) {
			console.error("Failed to delete comment:", e);
		}
	}

	async function deleteTask(onDeleted: (id: string) => void, onClose: () => void) {
		const state = get({ subscribe });
		if (!state.task) return;

		if (confirm("Are you sure you want to delete this task?")) {
			try {
				await api.deleteTask(state.task.id);
				onDeleted(state.task.id);
				onClose();
			} catch (e: unknown) {
				alert("Error deleting task: " + (e instanceof Error ? e.message : String(e)));
			}
		}
	}

	// ─── Standard CRUD ──────────────────────────────────────────────────────

	function setStandard(standard: CodingStandard | null) {
		if (standard) {
			update((s) => ({
				...s,
				standard,
				standardEditing: false,
				standardForm: {
					name: standard.title,
					context: standard.context,
					version: standard.version,
					language: standard.language || "",
					stack: standard.stack.join(", "),
					tags: standard.tags.join(", "),
					metadata: stringifyMetadata(standard.metadata),
					content: standard.content,
					parent_id: standard.parent_id || ""
				},
				standardError: ""
			}));
		} else {
			update((s) => ({
				...s,
				standard: { id: "__new__", title: "", content: "", context: "general", version: "1.0.0", language: null, stack: [], tags: [], is_global: true, repo: null, parent_id: null, metadata: {}, created_at: "", updated_at: "", hit_count: 0, last_used_at: null, agent: "", model: "" } as CodingStandard,
				standardEditing: false,
				standardForm: { ...INITIAL_STANDARD_FORM },
				standardError: ""
			}));
		}
	}

	function startStandardEdit() {
		update((s) => ({ ...s, standardEditing: true }));
	}

	function cancelStandardEdit() {
		const state = get({ subscribe });
		if (state.standard) {
			update((s) => ({
				...s,
				standardEditing: false,
				standardForm: {
					name: state.standard!.title,
					context: state.standard!.context,
					version: state.standard!.version,
					language: state.standard!.language || "",
					stack: state.standard!.stack.join(", "),
					tags: state.standard!.tags.join(", "),
					metadata: stringifyMetadata(state.standard!.metadata),
					content: state.standard!.content,
					parent_id: state.standard!.parent_id || ""
				}
			}));
		}
	}

	async function saveStandard(
		onUpdated: (standard: CodingStandard) => void,
		onClose: () => void,
		repo: string | null
	) {
		const state = get({ subscribe });
		const form = state.standardForm;
		const metadata = parseMetadata(form.metadata);
		if (!form.name.trim() || !form.content.trim() || splitList(form.tags).length === 0 || !metadata) return;

		update((s) => ({ ...s, standardSaving: true, standardError: "" }));
		try {
			if (!state.standard) {
				const result = await api.createStandard({
					title: form.name.trim(),
					content: form.content.trim(),
					parent_id: form.parent_id.trim() || undefined,
					context: form.context.trim() || "general",
					version: form.version.trim() || "1.0.0",
					language: form.language.trim() || undefined,
					stack: splitList(form.stack),
					tags: splitList(form.tags),
					metadata,
					repo: repo,
					is_global: false
				});
				onUpdated(result);
			} else {
				await api.updateStandard(state.standard.id, {
					title: form.name.trim(),
					content: form.content.trim(),
					parent_id: form.parent_id.trim() || null,
					context: form.context.trim() || "general",
					version: form.version.trim() || "1.0.0",
					language: form.language.trim() || undefined,
					stack: splitList(form.stack),
					tags: splitList(form.tags),
					metadata,
					repo: state.standard.repo || repo,
					is_global: state.standard.is_global
				});
				const updated = { ...state.standard, title: form.name.trim(), content: form.content.trim(), updated_at: new Date().toISOString() };
				onUpdated(updated as CodingStandard);
			}
			onClose();
		} catch (e) {
			update((s) => ({
				...s,
				standardError: e instanceof Error ? e.message : "Failed to save standard."
			}));
		} finally {
			update((s) => ({ ...s, standardSaving: false }));
		}
	}

	async function deleteStandard(onDeleted: (id: string) => void, onClose: () => void) {
		const state = get({ subscribe });
		if (!state.standard) return;
		if (!confirm(`Delete coding standard "${state.standard.title}"?`)) return;

		update((s) => ({ ...s, standardDeleting: true }));
		try {
			await api.deleteStandard(state.standard.id);
			onDeleted(state.standard.id);
			onClose();
		} catch (e: unknown) {
			alert("Error deleting standard: " + (e instanceof Error ? e.message : String(e)));
		} finally {
			update((s) => ({ ...s, standardDeleting: false }));
		}
	}

	async function handleCopyStandardContent(text: string) {
		const success = await copyToClipboard(text);
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

	// ─── Handoff CRUD ──────────────────────────────────────────────────────

	function setHandoff(handoff: Handoff | null) {
		if (handoff) {
			update((s) => ({
				...s,
				handoff,
				task: null,
				memory: null,
				standard: null,
				handoffForm: {
					from_agent: handoff.from_agent,
					to_agent: handoff.to_agent || "",
					task_code: handoff.task_code || "",
					summary: handoff.summary,
					context: JSON.stringify(handoff.context, null, 2)
				},
				handoffError: ""
			}));
		} else {
			update((s) => ({
				...s,
				handoff: {
					id: "__new__",
					repo: s.handoff?.repo || "",
					from_agent: "",
					to_agent: null,
					task_id: null,
					summary: "",
					context: {},
					status: "pending",
					created_at: "",
					updated_at: "",
					expires_at: null
				},
				handoffForm: { ...INITIAL_HANDOFF_FORM },
				handoffError: ""
			}));
		}
	}

	function parseHandoffContext(value: string): Record<string, unknown> {
		if (!value.trim()) return {};
		try {
			const parsed = JSON.parse(value) as unknown;
			if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
				throw new Error("JSON must be an object.");
			}
			return parsed as Record<string, unknown>;
		} catch (e) {
			throw e;
		}
	}

	async function createHandoff(onCreated: () => void, repo: string) {
		const state = get({ subscribe });
		const form = state.handoffForm;
		if (!form.from_agent.trim() || !form.summary.trim()) return;

		update((s) => ({ ...s, handoffCreating: true, handoffError: "" }));
		try {
			await api.callTool("handoff-create", {
				repo,
				from_agent: form.from_agent.trim(),
				to_agent: form.to_agent.trim() || undefined,
				task_code: form.task_code.trim() || undefined,
				summary: form.summary.trim(),
				context: parseHandoffContext(form.context),
				structured: true
			});
			onCreated();
		} catch (e) {
			update((s) => ({
				...s,
				handoffError: e instanceof Error ? e.message : "Failed to create handoff."
			}));
		} finally {
			update((s) => ({ ...s, handoffCreating: false }));
		}
	}

	async function updateHandoffStatus(status: string, onUpdated: () => void) {
		const state = get({ subscribe });
		if (!state.handoff || state.handoff.id === "__new__") return;

		update((s) => ({ ...s, handoffUpdating: true, handoffError: "" }));
		try {
			await api.callTool("handoff-update", {
				id: state.handoff.id,
				status,
				structured: true
			});
			onUpdated();
		} catch (e) {
			update((s) => ({
				...s,
				handoffError: e instanceof Error ? e.message : "Failed to update handoff."
			}));
		} finally {
			update((s) => ({ ...s, handoffUpdating: false }));
		}
	}

	async function handleCopyHandoffContext(context: Record<string, unknown>) {
		const success = await copyToClipboard(JSON.stringify(context, null, 2));
		if (success) {
			update((s) => ({ ...s, contentCopied: true }));
			setTimeout(() => update((s) => ({ ...s, contentCopied: false })), 2000);
		}
	}

		return {
			subscribe,
			mode,
			setMemory: (memory: Memory | null) => update((s) => ({ ...s, memory, task: null, standard: null, handoff: null })),
			setTask: (task: Task | null) => {
				if (task) {
					update((s) => ({
						...s,
						task,
						memory: null,
						standard: null,
						handoff: null,
						editTitle: task.title,
						editDescription: task.description || "",
						editingTitle: false,
						editingDescription: false,
						newComment: "",
						editingCommentId: null
					}));
				} else {
					update((s) => ({ ...s, task: null }));
				}
			},
		toggleEditTitle: (val: boolean) => update((s) => ({ ...s, editingTitle: val })),
		toggleEditDescription: (val: boolean) => update((s) => ({ ...s, editingDescription: val })),
		setEditTitle: (val: string) => update((s) => ({ ...s, editTitle: val })),
		setEditDescription: (val: string) => update((s) => ({ ...s, editDescription: val })),
		setNewComment: (val: string) => update((s) => ({ ...s, newComment: val })),
		startEditComment: (comment: TaskComment) =>
			update((s) => ({
				...s,
				editingCommentId: comment.id,
				editCommentText: comment.comment
			})),
		cancelEditComment: () =>
			update((s) => ({
				...s,
				editingCommentId: null,
				editCommentText: ""
			})),
		setEditCommentText: (val: string) => update((s) => ({ ...s, editCommentText: val })),
		handleCopyContent,
		handleCopyDesc,
		saveTitle,
		saveDescription,
		advanceStatus,
		postComment,
		saveEditComment,
		deleteComment,
		deleteTask,
		handleCommentKeydown: (e: KeyboardEvent, onUpdated: (task: Task) => void) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) postComment(onUpdated);
		},
		reset: () => {
			update((s) => ({
				...s,
				memory: null,
				task: null,
				standard: null,
				handoff: null,
				editingTitle: false,
				editingDescription: false,
				editTitle: "",
				editDescription: "",
				newComment: "",
				editingCommentId: null,
				editCommentText: "",
				postingComment: false,
				savingComment: false,
				contentCopied: false,
				descCopied: false,
				standardEditing: false,
				standardForm: { ...INITIAL_STANDARD_FORM },
				standardSaving: false,
				standardDeleting: false,
				standardError: "",
				handoffCreating: false,
				handoffUpdating: false,
				handoffForm: { ...INITIAL_HANDOFF_FORM },
				handoffError: ""
			}));
		},
		handleTitleKeydown: (e: KeyboardEvent, onUpdated: (task: Task) => void) => {
			if (e.key === "Enter") saveTitle(onUpdated);
			if (e.key === "Escape") update((s) => ({ ...s, editingTitle: false }));
		},
		setStandard,
		startStandardEdit,
		cancelStandardEdit,
		saveStandard,
		deleteStandard,
		handleCopyStandardContent,
		setHandoff,
		createHandoff,
		updateHandoffStatus,
		handleCopyHandoffContext
	};
}
