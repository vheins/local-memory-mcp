<script lang="ts">
	import { onMount, onDestroy } from "svelte";
	import { ArenaRenderer } from "../lib/arena/arenaRenderer";
	import type { ArenaScene, ArenaLayoutConfig } from "../lib/arena/arenaTypes";

	let {
		scene = null,
		isDark = false,
		reducedMotion = false,
		reducedTransparency = false,
		zoom = 1.0,
		panX = 0,
		panY = 0,
		onrenderer,
		onlayout,
		oncanvas
	}: {
		scene?: ArenaScene | null;
		loading?: boolean;
		isDark?: boolean;
		reducedMotion?: boolean;
		reducedTransparency?: boolean;
		zoom?: number;
		panX?: number;
		panY?: number;
		onrenderer?: (r: ArenaRenderer) => void;
		onlayout?: (l: ArenaLayoutConfig) => void;
		oncanvas?: (c: HTMLCanvasElement) => void;
	} = $props();

	let canvas: HTMLCanvasElement;
	let wrapEl: HTMLDivElement;
	let renderer: ArenaRenderer | null = null;
	let layout: ArenaLayoutConfig | null = null;

	function initCanvas(): void {
		if (!canvas || !wrapEl) return;
		const w = wrapEl.clientWidth || 960;
		const h = Math.max(520, Math.min(window.innerHeight - 220, 800));
		canvas.width = w;
		canvas.height = h;
		layout = { canvasWidth: w, canvasHeight: h };
		onlayout?.(layout);
		oncanvas?.(canvas);

		if (!renderer) {
			renderer = new ArenaRenderer(canvas);
			renderer.setViewport(zoom, panX, panY);
			renderer.setReducedMotion(reducedMotion);
			renderer.setReducedTransparency(reducedTransparency);
			renderer.start();
			onrenderer?.(renderer);
		}
		if (scene && layout) renderer.update(scene, layout, isDark);
	}

	onMount(() => {
		const tid = setTimeout(() => {
			initCanvas();
		}, 60);
		const ro = new ResizeObserver(() => initCanvas());
		ro.observe(wrapEl);
		return () => {
			clearTimeout(tid);
			ro.disconnect();
		};
	});

	onDestroy(() => {
		renderer?.stop();
	});
</script>

<div class="arena-wrap" bind:this={wrapEl}>
	<canvas bind:this={canvas} class="arena-canvas"></canvas>
</div>

<style>
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
</style>
