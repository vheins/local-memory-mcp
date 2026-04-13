import { writable, get, derived } from "svelte/store";
import { api } from "../api";
import type { Memory, Task, TaskComment } from "../stores";
import { copyToClipboard } from "../utils";

export interface DetailState {
	memory: Memory | null;
	task: Task | null;
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
		descCopied: false
	};

	const { subscribe, update } = writable<DetailState>(initialState);

	const mode = derived({ subscribe }, ($s) => {
		return $s.task ? "task" : $s.memory ? "memory" : null;
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
			await api.updateTask(state.task.id, { [field]: value });
			const updatedTask = { ...state.task, [field]: value } as Task;
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
			await api.updateTask(state.task.id, { comment: state.newComment.trim() });
			const refreshed = await api.taskById(state.task.id);
			if (refreshed) {
				update((s) => ({ ...s, task: refreshed, newComment: "" }));
				onUpdated(refreshed);
			}
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

	return {
		subscribe,
		mode,
		setMemory: (memory: Memory | null) => update((s) => ({ ...s, memory, task: null })),
		setTask: (task: Task | null) => {
			if (task) {
				update((s) => ({
					...s,
					task,
					memory: null,
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
				descCopied: false
			}));
		},
		handleTitleKeydown: (e: KeyboardEvent, onUpdated: (task: Task) => void) => {
			if (e.key === "Enter") saveTitle(onUpdated);
			if (e.key === "Escape") update((s) => ({ ...s, editingTitle: false }));
		}
	};
}
