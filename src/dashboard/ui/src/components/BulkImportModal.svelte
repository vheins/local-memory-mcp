<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { api } from '../lib/api';
  import Icon from '../lib/Icon.svelte';

  export let repo: string;
  export let importTarget: 'memories' | 'tasks' = 'memories';
  export let isOpen = false;

  const dispatch = createEventDispatcher();

  let inputText = '';
  let errorMsg = '';
  let isSubmitting = false;

  function close() {
    isOpen = false;
    inputText = '';
    errorMsg = '';
    dispatch('close');
  }

  async function handleImport() {
    errorMsg = '';
    
    if (!inputText.trim()) {
      errorMsg = 'Please enter or paste JSON data.';
      return;
    }

    let parsedData: any[];
    try {
      parsedData = JSON.parse(inputText);
      if (!Array.isArray(parsedData)) {
        throw new Error('Root element must be a JSON array []');
      }
    } catch (err: any) {
      errorMsg = 'Invalid JSON: ' + err.message;
      return;
    }

    if (parsedData.length === 0) {
      errorMsg = 'JSON array is empty.';
      return;
    }

    isSubmitting = true;
    try {
      let count = 0;
      if (importTarget === 'memories') {
        const res = await api.bulkImportMemories(repo, parsedData);
        count = res.count;
      } else {
        const res = await api.bulkImportTasks(repo, parsedData);
        count = res.count;
      }
      
      alert(`Imported ${count} ${importTarget} successfully.`);
      dispatch('success');
      close();
    } catch (err: any) {
      errorMsg = err.message || 'Import failed';
    } finally {
      isSubmitting = false;
    }
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (re) => {
      inputText = re.target?.result as string;
    };
    reader.readAsText(file);
  }
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" transition:fade={{ duration: 200 }} on:click={close}>
    <div class="modal-content" transition:scale={{ duration: 200, start: 0.95 }} on:click|stopPropagation>
      
      <div class="modal-header">
        <h3>Bulk Import {importTarget === 'memories' ? 'Memories' : 'Tasks'}</h3>
        <button class="btn btn-ghost btn-sm close-btn" on:click={close}>
          <Icon name="x" size={18} strokeWidth={2} />
        </button>
      </div>

      <div class="modal-body p-4" style="padding:16px;">
        <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:12px;">
          Paste a JSON array of objects below, or drag and drop a <code>.json</code> file into the text area.
        </p>

        <div 
          class="drop-zone"
          on:dragover|preventDefault
          on:drop={handleFileDrop}
        >
          <textarea
            bind:value={inputText}
            placeholder="[&#10;  &#123; &quot;title&quot;: &quot;Example&quot;, &quot;content&quot;: &quot;...&quot; &#125;&#10;]"
            spellcheck="false"
          ></textarea>
        </div>

        {#if errorMsg}
          <div class="error-msg">{errorMsg}</div>
        {/if}
      </div>

      <div class="modal-footer flex gap-2 justify-end p-4 border-t" style="padding:16px;border-top:1px solid var(--color-border);display:flex;gap:8px;justify-content:flex-end;">
        <button class="btn btn-ghost" on:click={close} disabled={isSubmitting}>Cancel</button>
        <button class="btn btn-primary" on:click={handleImport} disabled={isSubmitting || !inputText.trim()}>
          {#if isSubmitting}
            <div class="spinner"></div>
          {/if}
          Import
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    backdrop-filter: blur(4px);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-content {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 16px;
    width: 600px;
    max-width: 90vw;
    box-shadow: 0 20px 40px rgba(0,0,0,0.4);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--color-border);
    background: rgba(14, 165, 233, 0.05);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .close-btn {
    padding: 4px;
    margin: -8px;
  }

  .drop-zone {
    width: 100%;
    height: 300px;
    position: relative;
    border-radius: 8px;
    background: var(--color-bg-secondary);
  }

  textarea {
    width: 100%;
    height: 100%;
    border: 1px dashed var(--color-border);
    border-radius: 8px;
    background: transparent;
    padding: 16px;
    color: var(--color-text);
    font-family: monospace;
    font-size: 0.8rem;
    resize: none;
    outline: none;
    transition: border-color 0.2s ease;
  }

  textarea:focus {
    border-color: #0ea5e9;
  }

  .error-msg {
    margin-top: 12px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid #ef4444;
    color: #ef4444;
    font-size: 0.8rem;
    border-radius: 4px;
  }

  .spinner {
    display: inline-block;
    width: 14px;
    height: 14px;
    margin-right: 6px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { 100% { transform: rotate(360deg); } }
</style>
