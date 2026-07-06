<script lang="ts">
	import { onMount, afterUpdate, tick } from "svelte";
	import { get } from "svelte/store";
	import Icon from "../lib/Icon.svelte";
	import { currentRepo, recentActions, recentActionsPage, recentActionsTotalItems } from "../lib/stores";
	import { api } from "../lib/api";
	import { createRecentActionsHandler } from "../lib/composables/useRecentActions";
	import { createChatTask } from "../lib/utils";
	import Markdown from "./Markdown.svelte";

	export let onRefresh: () => void = () => {};

	let open = false;
	let chatMessage = "";
	let isSending = false;
	let chatContainer: HTMLDivElement | undefined;

	async function loadPage(page: number, append?: boolean) {
		const repo = get(currentRepo);
		if (!repo) return;
		try {
			const data = await api.recentActions(repo, page, 25);
			if (append) {
				recentActions.update((a) => [...a, ...(data.actions || [])]);
			} else {
				recentActions.set(data.actions || []);
			}
			recentActionsPage.set(data.pagination?.page ?? page);
			recentActionsTotalItems.set(data.pagination?.totalItems ?? 0);
		} catch (e) {
			console.error("Failed to load recent actions:", e);
		}
	}

	const handler = createRecentActionsHandler(loadPage);
	const { groupedActions, recentActions: actionsStore, recentActionsPage: actionsPage } = handler;

	afterUpdate(() => {
		const p = $actionsPage;
		if (open && p <= 1 && !$handler.isLoadingMore && $actionsStore.length > 0) {
			handler.scrollToBottom(chatContainer, "instant");
		}
	});

	onMount(() => {
		return () => {
			recentActions.set([]);
			recentActionsPage.set(1);
		};
	});

	function toggle() {
		open = !open;
		if (open) {
			loadPage(1);
			tick().then(() => handler.scrollToBottom(chatContainer, "instant"));
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === "Escape") open = false;
	}

	async function sendChat() {
		const msg = chatMessage.trim();
		if (!msg || isSending) return;
		const repo = get(currentRepo);
		if (!repo) return;
		isSending = true;
		try {
			await createChatTask(msg, repo);
			chatMessage = "";
			await loadPage(1);
			onRefresh();
			tick().then(() => handler.scrollToBottom(chatContainer, "instant"));
		} catch (e) {
			console.error("Failed to create task:", e);
		} finally {
			isSending = false;
		}
	}
</script>

<svelte:window on:keydown={handleKeyDown} />

{#if $currentRepo}
	{#if open}
		<div
			class="chat-backdrop"
			on:click={() => (open = false)}
			on:keydown={(e) => e.key === "Enter" && (open = false)}
			role="button"
			tabindex="-1"
			aria-label="Close"
		></div>
		<div class="chat-popup animate-fade-in-scale">
			<div class="chat-popup-header">
				<div class="chat-popup-title">
					<div class="chat-popup-avatar">
						<Icon name="message-circle" size={16} strokeWidth={2.2} />
					</div>
					<div>
						<div class="chat-popup-name">Recent Activity</div>
						<div class="chat-popup-status">{$recentActionsTotalItems} events</div>
					</div>
				</div>
				<button class="chat-popup-close" on:click={() => (open = false)} title="Close" aria-label="Close">
					<Icon name="x" size={16} strokeWidth={2.5} />
				</button>
			</div>

			<div class="chat-popup-body" bind:this={chatContainer}>
				{#if $handler.isLoadingMore}
					<div class="popup-load-more">
						<Icon name="refresh-cw" size={12} className="animate-spin" />
						<span>Loading older...</span>
					</div>
				{/if}

				{#if $actionsStore.length === 0}
					<div class="popup-empty">
						<Icon name="message-circle" size={36} strokeWidth={1} />
						<div>No activity yet</div>
						<div>Events appear here as they happen.</div>
					</div>
				{:else}
					{#each $groupedActions as group (group.date)}
						<div class="popup-date-header"><span>{group.date}</span></div>
						{#each group.items as action (action.id)}
							{@const label = handler.getLabel(action)}
							{@const cfg = handler.getConfig(action.action)}
							<div class="popup-bubble-row popup-bubble-right">
								<div class="popup-bubble-wrap">
									<div class="popup-chat-bubble popup-chat-bubble-action">
										<div class="popup-action-badge" style="color:{cfg.color};background:{cfg.bgAlpha};">
											<Icon name={cfg.icon} size={8} strokeWidth={2.5} />
											<span>{cfg.label}</span>
										</div>
										<div class="popup-action-main">{label.main}</div>
										{#if label.sub}<div class="popup-action-sub">{label.sub}</div>{/if}
									</div>
								</div>
							</div>
							{#if action.response}
								{@const parsed = handler.parseResponse(action.response)}
								{@const isExpanded = $handler.expandedResponses.has(action.id)}
								<div class="popup-bubble-row popup-bubble-left">
									<div class="popup-bubble-wrap">
										<div class="popup-chat-bubble popup-chat-bubble-mcp">
											<div class="popup-mcp-sender">MCP</div>
											<div
												class="popup-markdown"
												style={!isExpanded && parsed.isLong
													? "max-height:80px;overflow:hidden;mask-image:linear-gradient(to bottom,black 60%,transparent 100%);"
													: ""}
											>
												<Markdown content={parsed.text} />
											</div>
											{#if parsed.isLong}
												<button class="popup-read-more" on:click={() => handler.toggleExpand(action.id)}>
													{isExpanded ? "Less" : "More"}
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/if}
						{/each}
					{/each}
				{/if}
			</div>

			<div class="chat-popup-footer">
				<div class="chat-input-row">
					<input
						type="text"
						placeholder="Create a backlog task..."
						value={chatMessage}
						on:input={(e) => (chatMessage = e.currentTarget.value)}
						on:keydown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
						disabled={isSending}
					/>
					<button class="chat-send-btn" on:click={sendChat} disabled={!chatMessage.trim() || isSending}>
						<Icon name="send" size={14} strokeWidth={2} />
					</button>
				</div>
			</div>
		</div>
	{:else}
		<button class="chat-fab" on:click={toggle} title="Open activity chat" aria-label="Open activity chat">
			<Icon name="message-circle" size={22} strokeWidth={2.2} />
		</button>
	{/if}
{/if}

<style>
	.chat-backdrop {
		position: fixed;
		inset: 0;
		z-index: 49;
		background: transparent;
		cursor: default;
	}

	.chat-fab {
		position: fixed;
		bottom: 28px;
		right: 28px;
		z-index: 50;
		width: 52px;
		height: 52px;
		border-radius: 50%;
		border: none;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		box-shadow: 0 4px 20px rgba(14, 165, 233, 0.45);
		transition:
			transform 0.2s ease,
			box-shadow 0.2s ease;
		flex-shrink: 0;
	}

	.chat-fab::after {
		content: "";
		position: absolute;
		inset: -4px;
		border-radius: 50%;
		border: 2px solid rgba(14, 165, 233, 0.4);
		animation: fab-pulse 2.4s ease-out infinite;
		pointer-events: none;
	}

	.chat-fab:hover {
		transform: scale(1.08);
		box-shadow: 0 6px 28px rgba(14, 165, 233, 0.6);
	}

	@keyframes fab-pulse {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(1.45);
			opacity: 0;
		}
	}

	.chat-popup {
		position: fixed;
		bottom: 88px;
		right: 28px;
		z-index: 50;
		width: 380px;
		height: 560px;
		background: var(--color-surface, #fff);
		border-radius: 16px;
		box-shadow:
			0 8px 40px rgba(0, 0, 0, 0.18),
			0 4px 16px rgba(0, 0, 0, 0.1);
		border: 1px solid var(--color-border);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	:global(html.dark) .chat-popup {
		background: #0b141a;
		border-color: rgba(148, 163, 184, 0.12);
		box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
	}

	.chat-popup-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 16px;
		background: linear-gradient(135deg, #0ea5e9, #6366f1);
		color: white;
		flex-shrink: 0;
	}

	.chat-popup-title {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.chat-popup-avatar {
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: rgba(255, 255, 255, 0.2);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.chat-popup-name {
		font-size: 0.85rem;
		font-weight: 700;
		line-height: 1.2;
	}

	.chat-popup-status {
		font-size: 0.62rem;
		font-weight: 600;
		opacity: 0.8;
	}

	.chat-popup-close {
		width: 30px;
		height: 30px;
		border-radius: 50%;
		border: none;
		background: rgba(255, 255, 255, 0.2);
		color: white;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: background 0.2s;
		flex-shrink: 0;
	}

	.chat-popup-close:hover {
		background: rgba(255, 255, 255, 0.35);
	}

	.chat-popup-body {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-height: 0;
		scroll-behavior: smooth;
	}

	:global(html.dark) .chat-popup-body {
		background-image: radial-gradient(rgba(255, 255, 255, 0.02) 1px, transparent 1px);
		background-size: 20px 20px;
	}

	.popup-load-more {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 8px;
		font-size: 0.68rem;
		font-weight: 600;
		color: var(--color-text-muted);
		opacity: 0.7;
	}

	.popup-empty {
		text-align: center;
		padding: 60px 16px;
		color: var(--color-text-muted);
	}

	.popup-empty div:first-of-type {
		font-size: 0.9rem;
		font-weight: 600;
		margin-top: 12px;
	}

	.popup-empty div:last-child {
		font-size: 0.75rem;
		opacity: 0.7;
		margin-top: 4px;
	}

	.popup-date-header {
		display: flex;
		justify-content: center;
		margin: 8px 0 4px;
	}

	.popup-date-header span {
		font-size: 0.62rem;
		font-weight: 700;
		color: var(--color-text-muted);
		background: rgba(255, 255, 255, 0.9);
		padding: 3px 10px;
		border-radius: 8px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border: 1px solid rgba(0, 0, 0, 0.05);
	}

	:global(html.dark) .popup-date-header span {
		background: #182229;
		color: #8696a0;
	}

	.popup-bubble-row {
		display: flex;
		width: 100%;
	}

	.popup-bubble-right {
		justify-content: flex-end;
	}

	.popup-bubble-left {
		justify-content: flex-start;
	}

	.popup-bubble-wrap {
		max-width: 85%;
	}

	.popup-chat-bubble {
		padding: 6px 10px 6px;
		border-radius: 10px;
		font-size: 0.78rem;
		line-height: 1.35;
		box-shadow: 0 1px 0.5px rgba(0, 0, 0, 0.1);
		position: relative;
	}

	.popup-chat-bubble-action {
		background: #dcf8c6;
		color: #111b21;
	}

	:global(html.dark) .popup-chat-bubble-action {
		background: #056162;
		color: #e9edef;
	}

	.popup-chat-bubble-mcp {
		background: #ffffff;
		color: #111b21;
	}

	:global(html.dark) .popup-chat-bubble-mcp {
		background: #202c33;
		color: #e9edef;
	}

	.popup-action-badge {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		padding: 1px 5px;
		border-radius: 3px;
		font-size: 0.55rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-bottom: 3px;
	}

	.popup-action-main {
		font-weight: 600;
		font-size: 0.78rem;
		word-break: break-word;
	}

	.popup-action-sub {
		font-size: 0.65rem;
		opacity: 0.6;
		margin-top: 1px;
	}

	.popup-mcp-sender {
		font-size: 0.62rem;
		font-weight: 800;
		color: #34b7f1;
		margin-bottom: 4px;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.popup-markdown {
		font-size: 0.75rem;
		line-height: 1.45;
	}

	:global(.popup-markdown p) {
		margin: 0.3em 0;
	}

	.popup-read-more {
		background: transparent;
		border: none;
		color: #34b7f1;
		font-size: 0.65rem;
		font-weight: 700;
		cursor: pointer;
		padding: 2px 0;
		margin-top: 2px;
		display: block;
	}

	.popup-read-more:hover {
		text-decoration: underline;
	}

	.chat-popup-footer {
		flex-shrink: 0;
		padding: 8px 12px;
		border-top: 1px solid var(--color-border);
		background: var(--glass-bg);
	}

	:global(html.dark) .chat-popup-footer {
		background: rgba(6, 12, 28, 0.7);
		border-top-color: rgba(148, 163, 184, 0.1);
	}

	:global(.chat-popup-footer .chat-input-row) {
		border-radius: 20px;
		padding: 2px 2px 2px 14px;
	}

	:global(.chat-popup-footer .chat-input-row input) {
		font-size: 0.8rem;
		padding: 6px 0;
	}

	:global(.chat-popup-footer .chat-send-btn) {
		width: 32px;
		height: 32px;
	}

	@media (max-width: 640px) {
		.chat-fab {
			bottom: max(18px, env(safe-area-inset-bottom));
			right: 14px;
			width: 48px;
			height: 48px;
		}

		.chat-fab::after {
			display: none;
		}

		.chat-popup {
			right: 8px;
			bottom: 72px;
			width: calc(100vw - 16px);
			height: 55vh;
			max-height: 500px;
		}
	}
</style>
