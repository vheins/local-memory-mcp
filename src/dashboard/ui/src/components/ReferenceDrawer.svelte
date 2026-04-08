<script lang="ts">
  import { renderMarkdown } from '../lib/utils';
  import { api } from '../lib/api';
  import { currentRepo } from '../lib/stores';
  
  export let item: any = null; // { type: 'tool' | 'prompt' | 'resource', data: any }
  export let open = false;
  export let onClose: () => void = () => {};

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }

  function handlePanelClick(e: MouseEvent) {
    e.stopPropagation();
  }

  $: typeLabel = item?.type ? item.type.charAt(0).toUpperCase() + item.type.slice(1) : '';

  let toolArgs: Record<string, string> = {};
  let toolRunning = false;
  let toolResult: string | null = null;
  let toolError: string | null = null;

  $: if (item && open) {
    toolArgs = {};
    // Pre-fill repo if it exists in the schema
    if (item.type === 'tool' && item.data.inputSchema?.properties?.repo && $currentRepo) {
      toolArgs['repo'] = $currentRepo;
    }
    toolResult = null;
    toolError = null;
    toolRunning = false;
  }

  async function runTool() {
    if (!item || item.type !== 'tool') return;
    toolRunning = true;
    toolResult = null;
    toolError = null;
    try {
      const parsedArgs: Record<string, any> = {};
      if (item.data.inputSchema?.properties) {
          for (const [k, v] of Object.entries(toolArgs)) {
            if (v === undefined || v === '') continue;
            try {
              parsedArgs[k] = JSON.parse(v);
            } catch {
              parsedArgs[k] = v;
            }
          }
      }
      const result = await api.callTool(item.data.name, parsedArgs);
      toolResult = JSON.stringify(result, null, 2);
    } catch (e: any) {
      toolError = e.message;
    } finally {
      toolRunning = false;
    }
  }
</script>

{#if open && item}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="drawer-overlay" on:click={handleOverlayClick} style="z-index: 100;"></div>

  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-noninteractive-element-interactions -->
  <div class="drawer-panel animate-fade-in" on:click={handlePanelClick} role="dialog" aria-modal="true" tabindex="-1" style="z-index: 101;">

    <div class="drawer-header">
      <div style="flex:1; min-width:0; padding-right:16px;">
        <span class="type-chip" style="margin-bottom:8px;display:inline-flex;">{typeLabel}</span>
        <div class="drawer-title">{item.data.name}</div>
      </div>
      <button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close" style="flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <div class="drawer-body">
      {#if item.data.description}
        <div class="drawer-section">
          <div class="section-label">Description</div>
          <div class="markdown-body md-card">{@html renderMarkdown(item.data.description)}</div>
        </div>
      {/if}

      {#if item.type === 'tool'}
        <div class="drawer-section">
          {#if item.data.inputSchema?.properties && Object.keys(item.data.inputSchema.properties).length > 0}
            <div class="section-label">Playground (Input Parameters)</div>
            {#each Object.entries(item.data.inputSchema.properties) as [key, param]}
              <div style="border: 1px solid var(--color-border); border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; background: rgba(0,0,0,0.01);">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 4px;">
                  <span style="color: var(--color-text); font-family: monospace; font-size: 0.8rem; font-weight: 600;">{key}</span>
                  <div style="display:flex; gap: 8px; align-items: center;">
                    <span style="font-size: 0.7rem; color: var(--color-text-muted);">{(param as any).type}</span>
                    {#if item.data.inputSchema.required?.includes(key)}
                      <span style="font-size: 0.6rem; color: #ef4444; font-weight: bold; background: rgba(239, 68, 68, 0.1); padding: 2px 4px; border-radius: 4px;">REQ</span>
                    {/if}
                  </div>
                </div>
                {#if (param as any).description}
                  <div style="font-size: 0.75rem; color: var(--color-text-muted); margin-bottom: 6px; line-height: 1.2;">{(param as any).description}</div>
                {/if}
                <input type="text" class="form-input" style="font-size:0.8rem; padding: 4px 8px; border-radius: 4px; min-height: 28px;" placeholder={`Value for ${key}`} bind:value={toolArgs[key]} />
              </div>
            {/each}
          {:else}
             <div class="section-label">Playground</div>
             <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 8px;">No arguments required.</div>
          {/if}

          <!-- Submit button -->
          <div style="margin-top: 8px;">
            <button class="btn btn-accent" style="width:100%" on:click={runTool} disabled={toolRunning}>
              {toolRunning ? 'Running...' : 'Submit'}
            </button>
          </div>

          <!-- Tool result -->
          {#if toolError}
            <div style="margin-top: 12px; border: 1px solid #fecaca; background: #fef2f2; color: #ef4444; padding: 12px; border-radius: 8px; font-size: 0.85rem;">
              <strong>Error:</strong> {toolError}
            </div>
          {/if}

          {#if toolResult}
            <div style="margin-top: 12px;" class="drawer-section">
               <div class="section-label">Response</div>
               <div class="md-card markdown-body" style="padding: 1px 16px;">
                 {@html renderMarkdown("```json\n" + toolResult + "\n```")}
               </div>
            </div>
          {/if}
        </div>
      {/if}

      {#if item.type === 'prompt' && item.data.arguments}
        <div class="drawer-section">
          <div class="section-label">Arguments</div>
          {#each item.data.arguments as arg}
            <div style="border: 1px solid var(--color-border); border-radius: 8px; padding: 12px; margin-bottom: 8px; background: rgba(0,0,0,0.02);">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 4px;">
                <strong style="color: var(--color-text); font-family: monospace;">{arg.name}</strong>
                {#if arg.required}
                  <span style="font-size: 0.7rem; color: #ef4444; font-weight: bold;">REQUIRED</span>
                {/if}
              </div>
              {#if arg.description}
                <div style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 6px;">{arg.description}</div>
              {/if}
            </div>
          {/each}
          {#if item.data.arguments.length === 0}
            <div style="font-size: 0.85rem; color: var(--color-text-muted); font-style: italic;">No arguments.</div>
          {/if}
        </div>
      {/if}

      {#if item.type === 'prompt' && item.data.messages && item.data.messages.length > 0}
        <div class="drawer-section">
          <div class="section-label">Template</div>
          {#each item.data.messages as msg}
            <div class="md-card" style="margin-bottom: 8px;">
              <div style="font-size: 0.7rem; font-weight: bold; text-transform: uppercase; color: var(--color-text-muted); margin-bottom: 8px;">Role: {msg.role}</div>
              <div class="markdown-body">{@html renderMarkdown(msg.content?.text || msg.content || '')}</div>
            </div>
          {/each}
        </div>
      {/if}

      {#if item.type === 'resource'}
        <div class="drawer-section">
          <div class="section-label">Details</div>
          {#if item.data.uri}
            <div style="font-size: 0.85rem; margin-bottom: 8px;">
               <span style="color: var(--color-text-muted);">URI:</span> <code style="font-size: 0.8rem; background: var(--color-bg); padding: 2px 4px; border-radius: 4px; border: 1px solid var(--color-border);">{item.data.uri}</code>
            </div>
          {/if}
          {#if item.data.mimeType}
            <div style="font-size: 0.85rem;">
               <span style="color: var(--color-text-muted);">MIME Type:</span> <span>{item.data.mimeType}</span>
            </div>
          {/if}
        </div>
      {/if}

    </div>
  </div>
{/if}

<style>
  .drawer-header {
    padding: 20px;
    border-bottom: 1px solid var(--color-border);
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    flex-shrink: 0;
  }

  .drawer-title {
    font-size: 1rem;
    font-weight: 700;
    color: var(--color-text);
    line-height: 1.3;
    word-break: break-all;
  }

  .type-chip {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 8px;
    border-radius: 20px;
    background: rgba(14, 165, 233, 0.1);
    color: #0ea5e9;
  }

  .drawer-body {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 20px;
    overflow-y: auto;
  }

  .drawer-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-label {
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    margin-bottom: 4px;
  }

  .md-card {
    background: rgba(248, 250, 252, 0.8);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 16px;
  }

  :global(.dark) .md-card {
    background: rgba(15, 23, 42, 0.8);
  }
</style>
