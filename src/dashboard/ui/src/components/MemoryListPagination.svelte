<script lang="ts">
	let {
		page = 1,
		totalPages = 1,
		onGoToPage = (_p: number) => {}
	}: {
		page: number;
		totalPages: number;
		onGoToPage?: (p: number) => void;
	} = $props();

	// Window of up to 5 page buttons centered on the current page.
	let pageButtons = $derived.by(() =>
		Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
			const start = Math.max(1, Math.min(page - 2, totalPages - 4));
			return start + i;
		})
	);
</script>

<!-- Pagination -->
{#if totalPages > 1}
	<div class="flex items-center justify-between mt-3">
		<span style="font-size:0.75rem;color:var(--color-text-muted);">
			Page {page} of {totalPages}
		</span>
		<div class="flex gap-1">
			<button class="btn btn-ghost btn-sm" onclick={() => onGoToPage(1)} disabled={page <= 1}>«</button>
			<button class="btn btn-ghost btn-sm" onclick={() => onGoToPage(page - 1)} disabled={page <= 1}>‹</button>
			{#each pageButtons as p (p)}
				<button
					class="btn btn-sm"
					class:btn-primary={p === page}
					class:btn-ghost={p !== page}
					onclick={() => onGoToPage(p)}>{p}</button
				>
			{/each}
			<button class="btn btn-ghost btn-sm" onclick={() => onGoToPage(page + 1)} disabled={page >= totalPages}>›</button>
			<button class="btn btn-ghost btn-sm" onclick={() => onGoToPage(totalPages)} disabled={page >= totalPages}
				>»</button
			>
		</div>
	</div>
{/if}
