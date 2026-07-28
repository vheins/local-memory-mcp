<script lang="ts">
	// Pure display component — no props or logic needed.
</script>

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

<style>
	.arena-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 6px;
		padding: 8px 20px;
		border-top: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.02);
	}
	.legend-row {
		display: flex;
		align-items: center;
		gap: 12px;
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
	.lg-bubble {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #a855f7;
		flex-shrink: 0;
		animation: status-blink 1.8s ease-in-out infinite;
	}
</style>
