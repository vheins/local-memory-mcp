<script lang="ts">
	import { currentRepo } from "../lib/stores";
	import { createStatsHandler } from "../lib/composables/useStatsWidget";
	import Icon from "../lib/Icon.svelte";

	const { taskStats, activeTasks, refreshActiveTasks } = createStatsHandler();

	$: if ($currentRepo) {
		refreshActiveTasks($currentRepo);
	}

	$: stats = [
		{ label: "Total", val: $taskStats?.total ?? 0, icon: "layers", color: "#6366f1", glow: "rgba(99,102,241,0.12)" },
		{ label: "Backlog", val: $taskStats?.backlog ?? 0, icon: "inbox", color: "#64748b", glow: "rgba(100,116,139,0.12)" },
		{ label: "To Do", val: $taskStats?.pending ?? 0, icon: "circle-dot", color: "#0ea5e9", glow: "rgba(14,165,233,0.12)" },
		{ label: "Active", val: $taskStats?.in_progress ?? 0, icon: "zap", color: "#a855f7", glow: "rgba(168,85,247,0.12)" },
		{ label: "Done", val: $taskStats?.completed ?? 0, icon: "circle-check", color: "#10b981", glow: "rgba(16,185,129,0.12)" }
	];
	let isExpanded = true;
</script>

{#if $taskStats}
	<div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:10px;width:100%;">
		{#each stats as s (s.label)}
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

	{#if $activeTasks.length > 0}
		<div style="margin-top:16px; padding-top:12px; border-top:1px dashed var(--color-border);">
			<button
				on:click={() => (isExpanded = !isExpanded)}
				class="flex items-center justify-between w-full"
				style="background:none; border:none; padding:0; cursor:pointer; margin-bottom:10px;"
			>
				<div
					style="font-size:0.65rem;font-weight:700;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.05em;display:flex;align-items:center;gap:6px;"
				>
					<Icon name="clock-arrow-up" size={12} strokeWidth={2} />
					Active Priorities
				</div>
				<div style="color:var(--color-text-muted); transition: transform 0.2s ease; transform: rotate({isExpanded ? '0deg' : '-90deg'})">
					<Icon name="chevron-down" size={12} strokeWidth={2.5} />
				</div>
			</button>

			{#if isExpanded}
				<div style="display:flex;flex-direction:column;gap:6px;" class="animate-fade-in">
					{#each $activeTasks as task (task.id)}
						<div
							style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:8px 10px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--color-border);"
						>
							<div style="flex:1;min-width:0;">
								<div
									style="font-size:0.75rem;font-weight:700;color:var(--color-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"
								>
									{task.title}
								</div>
								<div style="font-size:0.6rem;color:var(--color-text-muted);font-family:monospace;margin-top:1px;">
									{task.task_code} • {task.phase}
								</div>
							</div>
							<div
								style="font-size:0.55rem;font-weight:800;padding:2px 8px;border-radius:99px;text-transform:uppercase;letter-spacing:0.03em;white-space:nowrap;background:{task.status ===
								'in_progress'
									? 'rgba(168,85,247,0.1)'
									: 'rgba(14,165,233,0.1)'};color:{task.status === 'in_progress'
									? '#a855f7'
									: '#0ea5e9'};border:1px solid currentColor;"
							>
								{task.status === "in_progress" ? "Active" : "To Do"}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
{/if}
