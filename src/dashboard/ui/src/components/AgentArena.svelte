<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { theme } from '../lib/stores';
	import { createArenaHandler } from '../lib/composables/useAgentArena';
	import { ArenaRenderer } from '../lib/arena/arenaRenderer';
	import type { ArenaLayoutConfig } from '../lib/arena/arenaTypes';
	import Icon from '../lib/Icon.svelte';

	const CANVAS_HEIGHT = 520;

	let canvas: HTMLCanvasElement;
	let wrapEl: HTMLDivElement;
	let renderer: ArenaRenderer | null = null;
	let layout: ArenaLayoutConfig | null = null;
	let hoveredAgentId: string | null = null;
	let tooltipPos: { x: number; y: number } | null = null;

	const arena = createArenaHandler();

	function initCanvas(): void {
		if (!canvas || !wrapEl) return;
		const w = wrapEl.clientWidth || 960;
		canvas.width = w;
		canvas.height = CANVAS_HEIGHT;
		layout = { canvasWidth: w, canvasHeight: CANVAS_HEIGHT };

		if (!renderer) {
			renderer = new ArenaRenderer(canvas);
			renderer.start();
		}
		arena.setLayout(layout);
		// Push updated layout/theme to renderer immediately
		if ($arena.scene) renderer.update($arena.scene, layout, $theme === 'dark');
	}

	$: if (renderer && $arena.scene && layout) {
		renderer.update($arena.scene, layout, $theme === 'dark');
	}

	function onMouseMove(e: MouseEvent): void {
		if (!renderer || !$arena.scene) { hoveredAgentId = null; tooltipPos = null; return; }
		const rect = canvas.getBoundingClientRect();
		const sx = canvas.width / rect.width;
		const sy = canvas.height / rect.height;
		const cx = (e.clientX - rect.left) * sx;
		const cy = (e.clientY - rect.top) * sy;

		const hit = renderer.hitTestAgent(cx, cy);
		if (hit !== hoveredAgentId) {
			hoveredAgentId = hit;
			renderer.setHovered(hoveredAgentId);
		}
		tooltipPos = hoveredAgentId
			? { x: e.clientX - rect.left + 14, y: e.clientY - rect.top - 10 }
			: null;
	}

	function onMouseLeave(): void {
		hoveredAgentId = null;
		tooltipPos = null;
		renderer?.setHovered(null);
	}

	$: hoveredAgent =
		hoveredAgentId && $arena.scene ? ($arena.scene.agents.get(hoveredAgentId) ?? null) : null;

	onMount(() => {
		const tid = setTimeout(() => {
			initCanvas();
			if (layout) arena.start(layout);
		}, 60);

		const ro = new ResizeObserver(() => initCanvas());
		ro.observe(wrapEl);

		return () => { clearTimeout(tid); ro.disconnect(); };
	});

	onDestroy(() => { arena.stop(); renderer?.stop(); });
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
				<div class="arena-sub">Live 2D view · all repositories</div>
			</div>
		</div>
		<div class="arena-hdr-right">
			{#if $arena.loading && !$arena.scene}
				<span class="badge loading">
					<span class="animate-spin" style="display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%"></span>
					Loading…
				</span>
			{:else if $arena.error}
				<span class="badge error"><Icon name="alert-circle" size={11} /> Error</span>
			{:else if $arena.scene}
				<span class="badge live">
					<span class="pulse-dot"></span>
					Live &nbsp;·&nbsp;
					<strong>{$arena.scene.agents.size}</strong>&nbsp;{$arena.scene.agents.size === 1 ? 'agent' : 'agents'}
					&nbsp;·&nbsp;
					<strong>{$arena.scene.tasks.size}</strong>&nbsp;{$arena.scene.tasks.size === 1 ? 'task' : 'tasks'}
					{#if $arena.repoCount > 1}&nbsp;· {$arena.repoCount} repos{/if}
				</span>
			{/if}
		</div>
	</div>

	<!-- World canvas -->
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
				<div class="tip-row"><span class="tip-key">Role</span><span>{hoveredAgent.role || '—'}</span></div>
				<div class="tip-row">
					<span class="tip-key">State</span>
					<span class="tip-state {hoveredAgent.state}">{hoveredAgent.state.replace(/_/g, ' ')}</span>
				</div>
				<div class="tip-row"><span class="tip-key">Tasks</span><span>{hoveredAgent.claimedTaskIds.length}</span></div>
				{#if hoveredAgent.repos.length > 0}
					<div class="tip-row">
						<span class="tip-key">Repos</span>
						<span class="tip-repos">{hoveredAgent.repos.map((r) => r.split('/').pop()).join(', ')}</span>
					</div>
				{/if}
			</div>
		{/if}

		<!-- Empty: no active agents -->
		{#if $arena.scene && $arena.scene.agents.size === 0 && !$arena.loading}
			<div class="arena-empty">
				<Icon name="users" size={30} strokeWidth={1.2} />
				<div style="font-weight:700;font-size:0.9rem">No active agents</div>
				<div class="arena-empty-sub">Agents appear here when they claim tasks across your repositories</div>
			</div>
		{/if}
	</div>

	<!-- Footer legend -->
	<div class="arena-footer">
		<div class="legend-row">
			<div class="legend-item"><span class="lg-dot" style="background:#8b5cf6"></span>Lobby (idle)</div>
			<div class="legend-item"><span class="lg-dot" style="background:#0ea5e9"></span>Inbox</div>
			<div class="legend-item"><span class="lg-dot" style="background:#a855f7"></span>Workspace</div>
			<div class="legend-item"><span class="lg-dot" style="background:#ef4444"></span>Issues</div>
			<div class="legend-item"><span class="lg-dot" style="background:#10b981"></span>Done</div>
		</div>
		<div class="legend-row">
			<div class="legend-item">
				<span class="lg-bubble"></span>Working agent
			</div>
			<div class="legend-item">
				<span class="lg-dash" style="border-color:#f59e0b"></span>Handoff beam
			</div>
			<div class="legend-item">
				<span class="lg-dash"></span>Claim link
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
		background: rgba(255,255,255,0.03);
	}

	.arena-hdr-left { display: flex; align-items: center; gap: 10px; }

	.arena-icon {
		width: 36px; height: 36px; border-radius: 50%;
		background: linear-gradient(135deg, var(--color-primary), var(--color-accent));
		display: flex; align-items: center; justify-content: center;
		color: white; box-shadow: 0 4px 12px var(--glow-primary); flex-shrink: 0;
	}

	.arena-sub { font-size: 0.67rem; color: var(--color-text-muted); font-weight: 600; margin-top: 1px; }
	.arena-hdr-right { display: flex; align-items: center; }

	.badge {
		font-size: 0.7rem; font-weight: 700; padding: 4px 10px;
		border-radius: 999px; display: flex; align-items: center; gap: 5px;
	}
	.badge.loading { color: var(--color-text-muted); background: rgba(100,116,139,0.1); }
	.badge.error { color: #ef4444; background: rgba(239,68,68,0.1); }
	.badge.live {
		color: #10b981; background: rgba(16,185,129,0.1);
		border: 1px solid rgba(16,185,129,0.2);
	}

	.pulse-dot {
		width: 6px; height: 6px; border-radius: 50%; background: #10b981;
		animation: status-blink 1.8s ease-in-out infinite; flex-shrink: 0;
	}

	.arena-wrap { position: relative; width: 100%; background: var(--color-bg); }

	.arena-canvas { display: block; width: 100%; height: auto; }

	.arena-empty {
		position: absolute; inset: 0;
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 10px; color: var(--color-text-muted); pointer-events: none;
	}
	.arena-empty-sub { font-size: 0.73rem; opacity: 0.6; text-align: center; max-width: 280px; }

	.agent-tip {
		position: absolute; z-index: 20; padding: 10px 12px; border-radius: 12px;
		font-size: 0.77rem; min-width: 168px; pointer-events: none;
		border: 1px solid var(--color-border); background: var(--color-surface);
		box-shadow: 0 8px 28px rgba(0,0,0,0.18); backdrop-filter: blur(14px);
	}
	.tip-name {
		display: flex; align-items: center; gap: 6px; font-weight: 800;
		font-size: 0.82rem; color: var(--color-text); margin-bottom: 7px;
	}
	.tip-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.tip-row {
		display: flex; justify-content: space-between; align-items: center;
		gap: 8px; padding: 1px 0; color: var(--color-text-muted); font-size: 0.73rem;
	}
	.tip-key { font-weight: 700; font-size: 0.67rem; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.65; }
	.tip-state { font-weight: 700; }
	.tip-state.processing { color: #a855f7; }
	.tip-state.idle { color: #64748b; }
	.tip-state.claiming { color: #0ea5e9; }
	.tip-state.handoff_out { color: #f59e0b; }
	.tip-state.handoff_in { color: #10b981; }
	.tip-repos { font-size: 0.68rem; text-align: right; max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	.arena-footer {
		display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
		gap: 6px; padding: 8px 20px; border-top: 1px solid var(--color-border);
		background: rgba(255,255,255,0.02);
	}
	.legend-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
	.legend-item {
		display: flex; align-items: center; gap: 5px;
		font-size: 0.68rem; color: var(--color-text-muted); font-weight: 600;
	}
	.lg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.lg-dash {
		display: inline-block; width: 18px; height: 0;
		border-top: 2px dashed rgba(99,102,241,0.55); flex-shrink: 0;
	}
	.lg-bubble {
		width: 10px; height: 10px; border-radius: 50%;
		background: #a855f7; flex-shrink: 0;
		animation: status-blink 1.8s ease-in-out infinite;
	}
</style>
