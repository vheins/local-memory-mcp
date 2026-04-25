<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { theme } from '../lib/stores';
	import { createArenaHandler } from '../lib/composables/useAgentArena';
	import { ArenaRenderer } from '../lib/arena/arenaRenderer';
	import { STATUS_COLORS, STATUS_ORDER } from '../lib/arena/arenaTransform';
	import type { ArenaLayoutConfig } from '../lib/arena/arenaTypes';
	import Icon from '../lib/Icon.svelte';

	const CANVAS_HEIGHT = 480;

	let canvas: HTMLCanvasElement;
	let wrapEl: HTMLDivElement;
	let renderer: ArenaRenderer | null = null;
	let layout: ArenaLayoutConfig | null = null;
	let hoveredAgentId: string | null = null;
	let tooltipPos: { x: number; y: number } | null = null;

	const arena = createArenaHandler();

	function buildLayout(width: number): ArenaLayoutConfig {
		return { canvasWidth: width, canvasHeight: CANVAS_HEIGHT };
	}

	function initCanvas(): void {
		if (!canvas || !wrapEl) return;
		const w = wrapEl.clientWidth || 900;
		canvas.width = w;
		canvas.height = CANVAS_HEIGHT;
		layout = buildLayout(w);

		if (!renderer) {
			renderer = new ArenaRenderer(canvas);
			renderer.start();
		}
		arena.setLayout(layout);
	}

	// Sync renderer on each store update
	$: if (renderer && $arena.scene && layout) {
		renderer.update($arena.scene, layout, $theme === 'dark');
	}

	// Also sync theme without waiting for scene change
	$: if (renderer && layout) {
		if ($arena.scene) renderer.update($arena.scene, layout, $theme === 'dark');
	}

	function onMouseMove(e: MouseEvent): void {
		if (!renderer || !$arena.scene) {
			hoveredAgentId = null;
			tooltipPos = null;
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const scaleX = canvas.width / rect.width;
		const scaleY = canvas.height / rect.height;
		const cx = (e.clientX - rect.left) * scaleX;
		const cy = (e.clientY - rect.top) * scaleY;

		const hit = renderer.hitTestAgent(cx, cy);
		if (hit !== hoveredAgentId) {
			hoveredAgentId = hit;
			renderer.setHovered(hoveredAgentId);
		}
		tooltipPos = hoveredAgentId ? { x: e.clientX - rect.left + 16, y: e.clientY - rect.top - 8 } : null;
	}

	function onMouseLeave(): void {
		hoveredAgentId = null;
		tooltipPos = null;
		renderer?.setHovered(null);
	}

	$: hoveredAgent =
		hoveredAgentId && $arena.scene ? $arena.scene.agents.get(hoveredAgentId) ?? null : null;

	onMount(() => {
		// Small delay so the container has laid out
		const id = setTimeout(() => {
			initCanvas();
			if (layout) arena.start(layout);
		}, 60);

		const ro = new ResizeObserver(() => {
			initCanvas();
			if (layout) arena.setLayout(layout);
		});
		ro.observe(wrapEl);

		return () => {
			clearTimeout(id);
			ro.disconnect();
		};
	});

	onDestroy(() => {
		arena.stop();
		renderer?.stop();
	});
</script>

<div class="arena-root glass card animate-fade-in">
	<!-- Header -->
	<div class="arena-hdr">
		<div class="arena-hdr-left">
			<div class="arena-icon">
				<Icon name="cpu" size={16} strokeWidth={1.75} />
			</div>
			<div>
				<div class="section-label" style="margin:0">Agent Arena</div>
				<div class="arena-sub">Real-time agent activity · all repositories</div>
			</div>
		</div>
		<div class="arena-hdr-right">
			{#if $arena.loading && !$arena.scene}
				<span class="badge loading">Loading…</span>
			{:else if $arena.error}
				<span class="badge error">
					<Icon name="alert-circle" size={11} />
					Error
				</span>
			{:else if $arena.scene}
				<span class="badge live">
					<span class="pulse-dot"></span>
					Live &nbsp;·&nbsp; {$arena.scene.agents.size}
					{$arena.scene.agents.size === 1 ? 'agent' : 'agents'} &nbsp;·&nbsp;
					{$arena.scene.tasks.size}
					{$arena.scene.tasks.size === 1 ? 'task' : 'tasks'}
					{#if $arena.repoCount > 1}&nbsp;across {$arena.repoCount} repos{/if}
				</span>
			{/if}
		</div>
	</div>

	<!-- Canvas area -->
	<div class="arena-wrap" bind:this={wrapEl}>
		<canvas
			bind:this={canvas}
			class="arena-canvas"
			on:mousemove={onMouseMove}
			on:mouseleave={onMouseLeave}
			style="cursor:{hoveredAgentId ? 'pointer' : 'default'}"
		></canvas>

		<!-- Hover tooltip -->
		{#if hoveredAgent && tooltipPos}
			<div class="agent-tip glass" style="left:{tooltipPos.x}px;top:{tooltipPos.y}px">
				<div class="tip-name">
					<span class="tip-dot" style="background:{hoveredAgent.color}"></span>
					{hoveredAgent.name}
				</div>
				<div class="tip-row">
					<span class="tip-key">Role</span>
					<span>{hoveredAgent.role || '—'}</span>
				</div>
				<div class="tip-row">
					<span class="tip-key">State</span>
					<span class="tip-state {hoveredAgent.state}">{hoveredAgent.state.replace(/_/g, ' ')}</span>
				</div>
				<div class="tip-row">
					<span class="tip-key">Tasks</span>
					<span>{hoveredAgent.claimedTaskIds.length}</span>
				</div>
				{#if hoveredAgent.repos.length > 0}
					<div class="tip-row">
						<span class="tip-key">Repos</span>
						<span class="tip-repos">{hoveredAgent.repos.map((r) => r.split('/').pop()).join(', ')}</span>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Empty state when no active agents -->
		{#if $arena.scene && $arena.scene.agents.size === 0 && !$arena.loading}
			<div class="arena-empty">
				<Icon name="users" size={28} strokeWidth={1.25} />
				<div style="font-weight:700">No active agents</div>
				<div style="font-size:0.75rem;opacity:0.6">Agents appear here when they claim tasks</div>
			</div>
		{/if}
	</div>

	<!-- Legend -->
	<div class="arena-legend">
		<div class="legend-section">
			{#each STATUS_ORDER.slice(0, 5) as status}
				<div class="legend-item">
					<span class="lg-dot" style="background:{STATUS_COLORS[status]}"></span>
					<span>{status.replace('_', ' ')}</span>
				</div>
			{/each}
		</div>
		<div class="legend-section">
			<div class="legend-item">
				<span class="lg-dash" style="border-color:#f59e0b"></span>
				<span>Handoff</span>
			</div>
			<div class="legend-item">
				<span class="lg-dash"></span>
				<span>Claim link</span>
			</div>
			<div class="legend-item">
				<span class="lg-dot" style="background:#f59e0b"></span>
				<span>Pending handoff</span>
			</div>
		</div>
	</div>
</div>

<style>
	.arena-root {
		padding: 0;
		overflow: hidden;
		border-radius: 24px;
	}

	.arena-hdr {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 20px;
		border-bottom: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.03);
	}

	.arena-hdr-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.arena-icon {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
		box-shadow: 0 4px 12px var(--glow-primary);
		flex-shrink: 0;
	}

	.arena-sub {
		font-size: 0.67rem;
		color: var(--color-text-muted);
		font-weight: 600;
		margin-top: 1px;
	}

	.arena-hdr-right {
		display: flex;
		align-items: center;
	}

	.badge {
		font-size: 0.7rem;
		font-weight: 700;
		padding: 4px 10px;
		border-radius: 999px;
		display: flex;
		align-items: center;
		gap: 5px;
	}

	.badge.loading {
		color: var(--color-text-muted);
		background: rgba(100, 116, 139, 0.1);
	}

	.badge.error {
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
	}

	.badge.live {
		color: #10b981;
		background: rgba(16, 185, 129, 0.1);
		border: 1px solid rgba(16, 185, 129, 0.2);
	}

	.pulse-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #10b981;
		animation: status-blink 1.8s ease-in-out infinite;
		flex-shrink: 0;
	}

	.arena-wrap {
		position: relative;
		width: 100%;
		background: var(--color-bg);
	}

	.arena-canvas {
		display: block;
		width: 100%;
		height: auto;
	}

	.arena-empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		color: var(--color-text-muted);
		pointer-events: none;
	}

	.agent-tip {
		position: absolute;
		z-index: 20;
		padding: 10px 12px;
		border-radius: 12px;
		font-size: 0.77rem;
		min-width: 164px;
		pointer-events: none;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
		backdrop-filter: blur(14px);
	}

	.tip-name {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 800;
		font-size: 0.82rem;
		color: var(--color-text);
		margin-bottom: 7px;
	}

	.tip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.tip-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		padding: 1px 0;
		color: var(--color-text-muted);
		font-size: 0.73rem;
	}

	.tip-key {
		font-weight: 700;
		font-size: 0.67rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		opacity: 0.65;
	}

	.tip-state {
		font-weight: 700;
	}
	.tip-state.processing {
		color: #a855f7;
	}
	.tip-state.idle {
		color: #64748b;
	}
	.tip-state.claiming {
		color: #0ea5e9;
	}
	.tip-state.handoff_out {
		color: #f59e0b;
	}
	.tip-state.handoff_in {
		color: #10b981;
	}

	.tip-repos {
		font-size: 0.68rem;
		text-align: right;
		max-width: 100px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.arena-legend {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		padding: 9px 20px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
	}

	.legend-section {
		display: flex;
		align-items: center;
		gap: 14px;
		flex-wrap: wrap;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 0.68rem;
		color: var(--color-text-muted);
		font-weight: 600;
	}

	.lg-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.lg-dash {
		display: inline-block;
		width: 18px;
		height: 0;
		border-top: 2px dashed rgba(99, 102, 241, 0.55);
		flex-shrink: 0;
	}

	.lg-dash[style] {
		border-top-style: dashed;
	}
</style>
