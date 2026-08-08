<script lang="ts">
	import Icon from "../lib/Icon.svelte";
	import type { RepoMeta } from "../lib/stores";

	export let currentRepo: string | null = null;
	export let repoData: RepoMeta | undefined = undefined;
	export let getRepoInitials: (repo: string) => string = () => "RP";
	/** Opens the mobile sidebar menu (wired from the Visible← TopBar row; only shown ≤1024px). */
	export let onToggleMobileMenu: () => void = () => {};
	/** Whether the mobile menu is open — drives aria-expanded on the hamburger. */
	export let mobileMenuOpen = false;
</script>

<div class="flex items-center gap-3">
	<!-- Mobile hamburger (hidden ≥1025px via CSS below; visible + functional ≤1024px) -->
	<button
		class="btn btn-ghost btn-icon"
		id="mobileMenuBtn"
		aria-label="Toggle menu"
		aria-haspopup="true"
		aria-expanded={mobileMenuOpen}
		on:click={onToggleMobileMenu}
	>
		<Icon name="menu" size={18} strokeWidth={2} />
	</button>

	{#if currentRepo}
		<div class="current-repo">
			<div
				style="width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,#0ea5e9,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;color:white;flex-shrink:0;box-shadow:0 4px 10px rgba(14,165,233,0.28);"
			>
				{getRepoInitials(currentRepo)}
			</div>
			<div>
				<div class="font-semibold current-repo-name">
					{currentRepo}
				</div>
				{#if repoData}
					<div class="flex items-center gap-1" style="font-size:0.65rem;color:var(--color-text-muted);">
						<Icon name="database" size={10} strokeWidth={2} />
						<span>{repoData.memoryCount || 0} memories</span>
					</div>
				{/if}
			</div>
		</div>
	{:else}
		<div style="font-size:0.85rem;color:var(--color-text-muted);" class="flex items-center gap-2">
			<Icon name="brain" size={14} strokeWidth={1.75} />
			<span>Select a repository</span>
		</div>
	{/if}
</div>

<style>
	.current-repo {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.current-repo-name {
		color: var(--color-text);
		font-size: 0.82rem;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Hidden by default (desktop) — the inline display:none was removed so the
	   button is a real interactive element; visibility is purely CSS-driven. */
	#mobileMenuBtn {
		display: none;
	}

	@media (max-width: 1024px) {
		#mobileMenuBtn {
			display: flex !important;
		}
	}

	@media (max-width: 760px) {
		.current-repo-name {
			max-width: 112px;
		}
	}

	@media (max-width: 420px) {
		.current-repo-name {
			max-width: 82px;
		}
	}
</style>
