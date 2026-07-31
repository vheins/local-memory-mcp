<script lang="ts">
	import { api } from "$lib/api";
	import type { KgEntityDetail } from "$lib/kg/kgEntityUtils";
	import KGEntityDetail from "./KGEntityDetail.svelte";

	export interface KGEntityDrawerProps {
		entityName?: string;
		onclose?: () => void;
		onnavigate?: (name: string) => void;
	}

	let { entityName = "", onclose, onnavigate }: KGEntityDrawerProps = $props();

	let show = $state(false);
	let loading = $state(false);
	let entity: KgEntityDetail | null = $state(null);
	let relations: Array<{
		from_entity: string;
		to_entity: string;
		relation_type: string;
	}> = $state([]);
	let observations: Array<{
		id: string;
		content: string;
		created_at: string;
	}> = $state([]);
	let error = $state("");
	let prevName = $state("");

	$effect(() => {
		if (entityName && entityName !== prevName) {
			prevName = entityName;
			void loadDetail(entityName);
		} else if (!entityName) {
			show = false;
		}
	});

	async function loadDetail(name: string) {
		show = true;
		loading = true;
		error = "";
		entity = null;
		relations = [];
		observations = [];
		try {
			const data = await api.kgEntityDetail(name);
			entity = (data.entity as KgEntityDetail) || null;
			relations = (data.relations || []) as Array<{
				from_entity: string;
				to_entity: string;
				relation_type: string;
			}>;
			observations = (data.observations || []) as Array<{
				id: string;
				content: string;
				created_at: string;
			}>;
		} catch (e: unknown) {
			error = e instanceof Error ? e.message : "Failed to load entity details";
		} finally {
			loading = false;
		}
	}

	function handleClose() {
		show = false;
		onclose?.();
	}

	function handleNavigate(event: CustomEvent<{ name: string }>) {
		onnavigate?.(event.detail.name);
	}
</script>

<KGEntityDetail
	{show}
	{loading}
	{entity}
	{relations}
	{observations}
	{error}
	on:close={handleClose}
	on:navigateTo={handleNavigate}
/>
