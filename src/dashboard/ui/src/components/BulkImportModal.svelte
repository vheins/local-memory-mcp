<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { fade, scale } from 'svelte/transition';
  import { api } from '../lib/api';
  import Icon from '../lib/Icon.svelte';

  export let repo: string;
  export let importTarget: 'memories' | 'tasks' = 'memories';
  export let isOpen = false;

  const dispatch = createEventDispatcher();

  let file: File | null = null;
  let csvData: any[] = [];
  let headers: string[] = [];
  let fileName = '';
  let errorMsg = '';
  let isSubmitting = false;

  const templates = {
    memories: 'title,type,content,importance\nExample Memory,fact,This is an example memory content,3',
    tasks: 'task_code,title,phase,description,status,priority\nTSK-001,Example Task,Phase 1,Example task description,todo,3'
  };

  function close() {
    isOpen = false;
    file = null;
    csvData = [];
    headers = [];
    fileName = '';
    errorMsg = '';
    dispatch('close');
  }

  function parseCSV(text: string) {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    if (lines.length === 0) return { headers: [], rows: [] };

    const splitLine = (line: string) => {
      const result = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (char === '"') inQuotes = !inQuotes;
        else if (char === ',' && !inQuotes) { result.push(cur.trim()); cur = ""; }
        else cur += char;
      }
      result.push(cur.trim());
      return result;
    };

    const rawHeaders = splitLine(lines[0]);
    const filteredHeaders = rawHeaders.filter(h => h !== '');
    
    const rows = lines.slice(1).map(splitLine).map(row => {
      const obj: any = {};
      filteredHeaders.forEach((h, i) => {
        const key = h.toLowerCase().replace(/[^a-z0-9_]/g, '_');
        obj[key] = row[i];
      });
      return obj;
    });

    return { headers: filteredHeaders, rows };
  }

  async function handleFileSelect(e: Event) {
    const target = e.target as HTMLInputElement;
    const selectedFile = target.files?.[0];
    if (selectedFile) processFile(selectedFile);
  }

  function handleFileDrop(e: DragEvent) {
    e.preventDefault();
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) processFile(droppedFile);
  }

  function processFile(selectedFile: File) {
    errorMsg = '';
    if (!selectedFile.name.endsWith('.csv')) {
      errorMsg = 'Please select a valid .csv file.';
      return;
    }
    
    file = selectedFile;
    fileName = selectedFile.name;
    
    const reader = new FileReader();
    reader.onload = (re) => {
      const text = re.target?.result as string;
      const parsed = parseCSV(text);
      headers = parsed.headers;
      csvData = parsed.rows;
      if (csvData.length === 0) {
        errorMsg = 'CSV file appears to be empty or missing headers.';
      }
    };
    reader.readAsText(selectedFile);
  }

  function downloadExample() {
    const csvContent = templates[importTarget];
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `example_${importTarget}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function handleImport() {
    errorMsg = '';
    if (csvData.length === 0) {
      errorMsg = 'No data to import.';
      return;
    }

    isSubmitting = true;
    try {
      let count = 0;
      if (importTarget === 'memories') {
        const res = await api.bulkImportMemories(repo, csvData);
        count = res.count;
      } else {
        const res = await api.bulkImportTasks(repo, csvData);
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
</script>

{#if isOpen}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="modal-backdrop" transition:fade={{ duration: 200 }} on:click={close}>
    <div class="modal-content" transition:scale={{ duration: 200, start: 0.95 }} on:click|stopPropagation>
      
      <div class="modal-header">
        <div class="flex items-center gap-2">
          <div class="header-icon">
            <Icon name="upload-cloud" size={18} color="#0ea5e9" />
          </div>
          <h3>Bulk Import {importTarget === 'memories' ? 'Memories' : 'Tasks'}</h3>
        </div>
        <button class="btn btn-ghost btn-sm close-btn" on:click={close}>
          <Icon name="x" size={18} strokeWidth={2} />
        </button>
      </div>

      <div class="modal-body">
        <div class="p-6">
          {#if !file}
            <div 
              class="drop-zone"
              on:dragover|preventDefault
              on:drop={handleFileDrop}
            >
              <div class="drop-zone-content">
                <Icon name="file-up" size={48} strokeWidth={1} color="var(--color-text-muted)" />
                <p>Drag and drop your <strong>.csv</strong> file here</p>
                <span class="text-xs text-slate-500 mb-4">or click to browse from your computer</span>
                
                <label class="btn btn-primary btn-md cursor-pointer">
                  Select CSV File
                  <input type="file" accept=".csv" class="hidden" on:change={handleFileSelect} />
                </label>
              </div>
            </div>

            <div class="mt-6 flex flex-col items-center">
              <p class="text-[0.8rem] text-slate-400 mb-2">Need a starting point?</p>
              <button class="btn btn-ghost btn-sm" on:click={downloadExample}>
                <Icon name="download" size={14} className="mr-2" />
                Download Example {importTarget === 'memories' ? 'Memories' : 'Tasks'} CSV
              </button>
            </div>
          {:else}
            <div class="file-info flex items-center justify-between p-3 bg-blue-500/5 border border-blue-500/20 rounded-lg mb-4">
              <div class="flex items-center gap-3">
                <Icon name="file-type-2" size={24} color="#0ea5e9" />
                <div>
                  <div class="text-sm font-semibold">{fileName}</div>
                  <div class="text-[0.7rem] text-slate-400">{csvData.length} rows found</div>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm text-red-500" on:click={() => { file = null; csvData = []; }}>
                Change File
              </button>
            </div>

            <div class="preview-container">
              <div class="preview-header">
                <span>Data Preview (First 5 rows)</span>
              </div>
              <div class="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      {#each headers as h}
                        <th>{h}</th>
                      {/each}
                    </tr>
                  </thead>
                  <tbody>
                    {#each csvData.slice(0, 5) as row}
                      <tr>
                        {#each headers as h}
                          <td>{row[h.toLowerCase().replace(/[^a-z0-9_]/g, '_')] || ''}</td>
                        {/each}
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}

          {#if errorMsg}
            <div class="error-msg flex items-center gap-2">
              <Icon name="alert-circle" size={16} />
              <span>{errorMsg}</span>
            </div>
          {/if}
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-ghost" on:click={close} disabled={isSubmitting}>Cancel</button>
        <button class="btn btn-primary" on:click={handleImport} disabled={isSubmitting || csvData.length === 0}>
          {#if isSubmitting}
            <div class="spinner"></div>
            Importing...
          {:else}
            <Icon name="check" size={16} className="mr-2" />
            Start Import
          {/if}
        </button>
      </div>

    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.6);
    backdrop-filter: blur(8px);
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-content {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 20px;
    width: 700px;
    max-width: 95vw;
    max-height: 90vh;
    box-shadow: 0 30px 60px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px 24px;
    border-bottom: 1px solid var(--color-border);
    background: linear-gradient(to right, rgba(14, 165, 233, 0.08), transparent);
  }

  .header-icon {
    width: 32px;
    height: 32px;
    background: rgba(14, 165, 233, 0.1);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-header h3 {
    margin: 0;
    font-size: 1.15rem;
    font-weight: 700;
    color: var(--color-text);
  }

  .close-btn {
    opacity: 0.6;
    transition: opacity 0.2s;
  }
  .close-btn:hover { opacity: 1; }

  .drop-zone {
    width: 100%;
    height: 240px;
    border: 2px dashed var(--color-border);
    border-radius: 16px;
    background: rgba(241, 245, 249, 0.03);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.3s ease;
  }

  .drop-zone:hover {
    border-color: #0ea5e9;
    background: rgba(14, 165, 233, 0.03);
  }

  .drop-zone-content {
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .drop-zone-content p {
    margin: 0;
    font-size: 0.95rem;
    color: var(--color-text);
  }

  .preview-container {
    border: 1px solid var(--color-border);
    border-radius: 12px;
    overflow: hidden;
    background: var(--color-bg-secondary);
  }

  .preview-header {
    padding: 8px 12px;
    background: rgba(0,0,0,0.05);
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--color-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--color-border);
  }

  .table-wrapper {
    max-height: 200px;
    overflow-y: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.75rem;
  }

  th {
    text-align: left;
    padding: 8px 12px;
    background: rgba(0,0,0,0.02);
    font-weight: 600;
    color: var(--color-text-muted);
    border-bottom: 1px solid var(--color-border);
    position: sticky;
    top: 0;
    z-index: 1;
  }

  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    white-space: nowrap;
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  tr:last-child td { border-bottom: none; }

  .modal-footer {
    display: flex;
    gap: 12px;
    justify-content: flex-end;
    padding: 16px 24px;
    background: rgba(0,0,0,0.02);
    border-top: 1px solid var(--color-border);
  }

  .error-msg {
    margin-top: 16px;
    padding: 10px 14px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    color: #f87171;
    font-size: 0.8rem;
    font-weight: 500;
    border-radius: 8px;
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { 100% { transform: rotate(360deg); } }
  
  .hidden { display: none; }
</style>
