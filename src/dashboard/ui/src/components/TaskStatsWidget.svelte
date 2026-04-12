<script lang="ts">
	import { dashboardStats } from "../lib/stores";
	import Icon from "../lib/Icon.svelte";

	$: ts = $dashboardStats?.taskStats;

	$: stats = [
		{ label: "Total", val: ts?.total ?? 0, icon: "layers", color: "#6366f1", glow: "rgba(99,102,241,0.12)" },
		{ label: "Backlog", val: ts?.backlog ?? 0, icon: "inbox", color: "#64748b", glow: "rgba(100,116,139,0.12)" },
		{ label: "To Do", val: ts?.todo ?? 0, icon: "circle-dot", color: "#0ea5e9", glow: "rgba(14,165,233,0.12)" },
		{ label: "Active", val: ts?.inProgress ?? 0, icon: "zap", color: "#a855f7", glow: "rgba(168,85,247,0.12)" },
		{ label: "Done", val: ts?.completed ?? 0, icon: "circle-check", color: "#10b981", glow: "rgba(16,185,129,0.12)" }
	];
</script>

{#if ts}
	<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:10px;width:100%;">
		{#each stats as s}
			<div class="stat-card" style="text-align:center;background:{s.glow};border:1px solid {s.glow};padding:10px 8px;">
				<div style="display:flex;justify-content:center;margin-bottom:2px;color:{s.color};opacity:0.8;">
					<Icon name={s.icon} size={14} strokeWidth={1.75} />
				</div>
				<div style="font-size:1.25rem;font-weight:900;color:{s.color};line-height:1;letter-spacing:-0.03em;">
					{s.val}
				</div>
				<div
					style="font-size:0.6rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.06em;margin-top:2px;"
				>
					{s.label}
				</div>
			</div>
		{/each}
	</div>
{/if}
