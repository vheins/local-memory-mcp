<script lang="ts">
  import { api } from '../lib/api';
  import type { Memory, Task } from '../lib/stores';
  import {
    formatDate, getStatusColor, getStatusLabel,
    getPriorityLabel, renderMarkdown, copyToClipboard
  } from '../lib/utils';
  import Icon from '../lib/Icon.svelte';

  // ─── Props ───────────────────────────────────────────────────────────────────
  export let memory: Memory | null = null;
  export let task: Task | null = null;
  export let open = false;
  export let onClose: () => void = () => {};
  export let onTaskUpdated: (task: Task) => void = () => {};
  export let onTaskDeleted: (id: string) => void = () => {};

  // ─── Modes ───────────────────────────────────────────────────────────────────
  $: mode = task ? 'task' : memory ? 'memory' : null;

  // ─── Task editing state ───────────────────────────────────────────────────────
  let editingTitle = false;
  let editingDescription = false;
  let editTitle = '';
  let editDescription = '';

  // Comment state
  let newComment = '';
  let postingComment = false;
  let editingCommentId: string | null = null;
  let editCommentText = '';
  let savingComment = false;

  // Copy state
  let contentCopied = false;
  let descCopied = false;

  async function handleCopyContent(text: string) {
    const success = await copyToClipboard(text);
    if (success) {
      contentCopied = true;
      setTimeout(() => contentCopied = false, 2000);
    }
  }

  async function handleCopyDesc(text: string) {
    const success = await copyToClipboard(text);
    if (success) {
      descCopied = true;
      setTimeout(() => descCopied = false, 2000);
    }
  }

  // ─── Reactive resets ─────────────────────────────────────────────────────────
  $: if (task) {
    editTitle = task.title;
    editDescription = task.description || '';
    editingTitle = false;
    editingDescription = false;
    newComment = '';
    editingCommentId = null;
  }

  // ─── Close ───────────────────────────────────────────────────────────────────
  function handleOverlayClick() {
    onClose();
  }

  function handlePanelClick(e: MouseEvent) {
    e.stopPropagation();
  }

  // ─── Status helpers ───────────────────────────────────────────────────────────
  const STATUS_FLOW: Record<string, { next: string; label: string; color: string }[]> = {
    backlog:     [{ next: 'pending',     label: 'Move to To Do',     color: '#0ea5e9' }],
    pending:     [{ next: 'in_progress', label: 'Start Progress',    color: '#a855f7' }],
    in_progress: [{ next: 'completed',   label: 'Mark Complete',     color: '#10b981' }, { next: 'blocked', label: 'Mark Blocked', color: '#ef4444' }],
    blocked:     [{ next: 'in_progress', label: 'Resume Progress',   color: '#a855f7' }],
    completed:   [],
    canceled:    [],
  };

  // ─── Task API actions ─────────────────────────────────────────────────────────
  async function saveField(field: string, value: any) {
    if (!task) return;
    try {
      await api.updateTask(task.id, { [field]: value });
      task = { ...task, [field]: value } as Task;
      onTaskUpdated(task);
    } catch (e) {
      console.error('Failed to update task:', e);
    }
  }

  async function saveTitle() {
    if (!editTitle.trim()) return;
    await saveField('title', editTitle.trim());
    editingTitle = false;
  }

  async function saveDescription() {
    await saveField('description', editDescription);
    editingDescription = false;
  }

  async function advanceStatus(next: string) {
    await saveField('status', next);
  }

  async function postComment() {
    if (!task || !newComment.trim()) return;
    postingComment = true;
    try {
      // Use updateTask with comment field as per API
      await api.updateTask(task.id, { comment: newComment.trim() });
      const refreshed = await api.taskById(task.id);
      task = refreshed;
      onTaskUpdated(task!);
      newComment = '';
    } catch (e) {
      console.error('Failed to post comment:', e);
    } finally {
      postingComment = false;
    }
  }

  async function saveEditComment() {
    if (!editingCommentId || !editCommentText.trim()) return;
    savingComment = true;
    try {
      await api.updateTaskComment(editingCommentId, editCommentText.trim());
      // Refresh task
      if (task) {
        const refreshed = await api.taskById(task.id);
        task = refreshed;
        onTaskUpdated(task!);
      }
      editingCommentId = null;
    } catch (e) {
      console.error('Failed to update comment:', e);
    } finally {
      savingComment = false;
    }
  }

  async function deleteComment(commentId: string) {
    if (!confirm('Delete this comment?')) return;
    try {
      await api.deleteTaskComment(commentId);
      if (task) {
        const refreshed = await api.taskById(task.id);
        if (refreshed) {
          task = refreshed;
          onTaskUpdated(task!);
        }
      }
    } catch (e) {
      console.error('Failed to delete comment:', e);
    }
  }

  function startEditComment(c: any) {
    editingCommentId = c.id;
    editCommentText = c.comment;
  }

  function cancelEditComment() {
    editingCommentId = null;
    editCommentText = '';
  }
</script>

{#if open && mode}
  <!-- svelte-ignore a11y-click-events-have-key-events tabindex-no-interactive-non-semantic-element -->
  <div class="drawer-overlay" on:click={handleOverlayClick} role="button" tabindex="0"></div>

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="drawer-panel animate-fade-in" on:click={handlePanelClick} role="dialog" aria-modal="true" tabindex="-1">

    <!-- ─── HEADER ─────────────────────────────────────────────────────────── -->
    <div class="drawer-header">
      {#if mode === 'memory' && memory}
        <div>
          <span class="type-chip type-{memory.type}" style="margin-bottom:8px;display:inline-flex;">{memory.type}</span>
          <div class="drawer-title">{memory.title}</div>
        </div>
      {:else if mode === 'task' && task}
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span class="status-chip {getStatusColor(task.status)}">{getStatusLabel(task.status)}</span>
            <span style="font-size:0.7rem;font-weight:700;color:var(--color-text-muted);">{task.task_code}</span>
          </div>
          {#if editingTitle}
            <div style="display:flex;gap:6px;align-items:center;">
              <!-- svelte-ignore a11y-autofocus -->
              <input
                autofocus
                class="form-input"
                bind:value={editTitle}
                style="font-size:0.95rem;font-weight:700;flex:1;"
                on:keydown={e => { if (e.key === 'Enter') saveTitle(); if (e.key === 'Escape') editingTitle = false; }}
              />
              <button class="btn btn-accent" style="padding:4px 10px;font-size:0.75rem;" on:click={saveTitle}>Save</button>
              <button class="btn btn-ghost" style="padding:4px 10px;font-size:0.75rem;" on:click={() => editingTitle = false}>✕</button>
            </div>
          {:else}
            <!-- svelte-ignore a11y-click-events-have-key-events tabindex-no-interactive-non-semantic-element -->
            <div class="drawer-title editable-title" on:click={() => { editingTitle = true; editTitle = task?.title || ''; }} title="Click to edit title" role="button" tabindex="0">
              {task.title}
              <span class="edit-hint">✏️</span>
            </div>
          {/if}
        </div>
      {/if}

      <button class="btn btn-ghost btn-icon" on:click={onClose} aria-label="Close" style="flex-shrink:0;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>

    <!-- ─── BODY ───────────────────────────────────────────────────────────── -->
    <div class="drawer-body">

      <!-- ══ MEMORY MODE ══ -->
      {#if mode === 'memory' && memory}
        <!-- Meta grid -->
        <div class="meta-grid" style="margin-bottom:16px;">
          {#each [
            {label:'Importance', val: memory.importance},
            {label:'Hit Count',  val: memory.hit_count ?? 0},
            {label:'Created',    val: formatDate(memory.created_at)},
            {label:'Updated',    val: formatDate(memory.updated_at)},
          ] as m}
            <div class="meta-cell">
              <div class="meta-label">{m.label}</div>
              <div class="meta-value">{m.val}</div>
            </div>
          {/each}
        </div>

        <!-- Tags -->
        {#if memory.tags?.length}
          <div style="margin-bottom:16px;">
            <div class="section-label">Tags</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;">
              {#each memory.tags as tag}
                <span class="tag-chip">{tag}</span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- Content -->
        <div>
          <div class="section-label" style="display:flex; justify-content:space-between; align-items:center;">
            <span>Content</span>
            <button 
              class="btn btn-ghost btn-icon" 
              on:click={() => handleCopyContent(memory?.content || '')} 
              title="Copy to clipboard" 
              style="width:20px; height:20px; padding:0; border:none; background:transparent;"
            >
              <Icon name={contentCopied ? 'check' : 'copy'} size={12} strokeWidth={2} className={contentCopied ? 'text-success' : ''} />
            </button>
          </div>
          <div class="markdown-body md-card">{@html renderMarkdown(memory.content)}</div>
        </div>

        <!-- Metadata JSON -->
        {#if memory.metadata && Object.keys(memory.metadata).length > 0}
          <div style="margin-top:16px;">
            <div class="section-label">Metadata</div>
            <pre class="json-pre">{JSON.stringify(memory.metadata, null, 2)}</pre>
          </div>
        {/if}
      {/if}

      <!-- ══ TASK MODE ══ -->
      {#if mode === 'task' && task}

        <!-- Status action buttons -->
        {#if STATUS_FLOW[task.status]?.length}
          <div style="margin-bottom:16px;display:flex;flex-wrap:wrap;gap:8px;">
            {#each STATUS_FLOW[task.status] as action}
              <button
                class="btn"
                style="background:{action.color};color:#fff;border:none;padding:6px 14px;font-size:0.78rem;font-weight:700;border-radius:8px;cursor:pointer;"
                on:click={() => advanceStatus(action.next)}
              >
                {action.label}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Status dropdown -->
        <div style="margin-bottom:16px;">
          <div class="section-label">Status</div>
          <div style="display:flex; justify-content:space-between; align-items:center;">
             <span class="status-chip {getStatusColor(task?.status || 'pending')}" style="font-size:0.85rem; padding: 4px 10px;">{getStatusLabel(task?.status || '')}</span>
             
             {#if task?.status !== 'completed'}
             <button class="btn btn-ghost" style="color: #ef4444;" on:click={async () => {
                if (!task) return;
                if (confirm('Are you sure you want to delete this task?')) {
                  try {
                    await api.deleteTask(task.id);
                    onTaskDeleted(task.id);
                    onClose();
                  } catch (e: any) {
                    alert('Error deleting task: ' + e.message);
                  }
                }
             }}>
               <svg style="margin-right:4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                 <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
               </svg>
               Delete Task
             </button>
             {/if}
          </div>
        </div>

        <!-- Meta grid -->
        <div class="meta-grid" style="margin-bottom:16px;">
          {#each [
            {label:'Priority', val: getPriorityLabel(task.priority)},
            {label:'Phase',    val: task.phase || '—'},
            {label:'Agent',    val: task.agent || '—'},
            {label:'Updated',  val: formatDate(task.updated_at)},
          ] as m}
            <div class="meta-cell">
              <div class="meta-label">{m.label}</div>
              <div class="meta-value">{m.val}</div>
            </div>
          {/each}
        </div>

        <!-- Description -->
        <div style="margin-bottom:16px;">
          <div class="section-label" style="display:flex;align-items:center;gap:6px;width:100%;">
            <span style="flex:1;">Description</span>
            <button 
              class="btn btn-ghost btn-icon" 
              on:click={() => handleCopyDesc(task?.description || '')} 
              title="Copy to clipboard" 
              style="width:20px; height:20px; padding:0; border:none; background:transparent; margin-right:4px;"
            >
              <Icon name={descCopied ? 'check' : 'copy'} size={12} strokeWidth={2} className={descCopied ? 'text-success' : ''} />
            </button>
            {#if !editingDescription}
              <button
                class="btn btn-ghost"
                style="padding:1px 6px;font-size:0.68rem;border-radius:4px;"
                on:click={() => { editingDescription = true; editDescription = task?.description || ''; }}
              >Edit</button>
            {/if}
          </div>
          {#if editingDescription}
            <textarea
              class="form-textarea"
              bind:value={editDescription}
              rows="8"
              style="font-size:0.82rem;font-family:'JetBrains Mono',monospace;"
            ></textarea>
            <div style="display:flex;gap:6px;margin-top:6px;">
              <button class="btn btn-accent" style="font-size:0.78rem;" on:click={saveDescription}>Save</button>
              <button class="btn btn-ghost" style="font-size:0.78rem;" on:click={() => editingDescription = false}>Cancel</button>
            </div>
          {:else if task.description}
            <div class="markdown-body md-card">{@html renderMarkdown(task.description)}</div>
          {:else}
            <div style="color:var(--color-text-muted);font-size:0.82rem;font-style:italic;">No description yet. Click Edit to add one.</div>
          {/if}
        </div>

        <!-- ─── Comments / Activity ─────────────────────────────────────────── -->
        <div>
          <div class="section-label">Activity ({task.comments?.length ?? 0})</div>

          <!-- Add comment -->
          <div class="comment-compose" style="margin-bottom:16px;">
            <textarea
              class="form-textarea"
              placeholder="Add a comment or status note…"
              bind:value={newComment}
              rows="2"
              style="font-size:0.82rem;resize:vertical;"
              on:keydown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) postComment(); }}
            ></textarea>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
              <span style="font-size:0.65rem;color:var(--color-text-muted);">Ctrl+Enter to submit</span>
              <button
                class="btn btn-accent"
                style="font-size:0.78rem;"
                disabled={postingComment || !newComment.trim()}
                on:click={postComment}
              >{postingComment ? 'Posting…' : 'Post Comment'}</button>
            </div>
          </div>

          <!-- Comment list -->
          {#if task.comments?.length}
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:12px;">
              {#each task.comments as c (c.id)}
                <div class="comment-card">
                  <!-- Comment header -->
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                    <div style="display:flex;align-items:center;gap:6px;">
                      <div class="comment-avatar">{(c.agent || 'U').charAt(0).toUpperCase()}</div>
                      <span style="font-size:0.72rem;font-weight:600;color:var(--color-text);">{c.agent || 'Unknown'}</span>
                      {#if c.previous_status && c.next_status}
                        <span style="font-size:0.65rem;color:var(--color-text-muted);">
                          {getStatusLabel(c.previous_status)} → {getStatusLabel(c.next_status)}
                        </span>
                      {/if}
                    </div>
                    <div style="display:flex;align-items:center;gap:8px;">
                      <span style="font-size:0.65rem;color:var(--color-text-muted);">{formatDate(c.created_at)}</span>
                      {#if c.id}
                        <button
                          class="btn btn-ghost"
                          style="padding:1px 5px;font-size:0.65rem;"
                          on:click={() => startEditComment(c)}
                          title="Edit comment"
                        >✏️</button>
                        <button
                          class="btn btn-ghost"
                          style="padding:1px 5px;font-size:0.65rem;color:#ef4444;"
                          on:click={() => deleteComment(c.id)}
                          title="Delete comment"
                        >🗑</button>
                      {/if}
                    </div>
                  </div>

                  <!-- Comment body: edit mode or read mode -->
                  {#if editingCommentId === c.id}
                    <textarea
                      class="form-textarea"
                      bind:value={editCommentText}
                      rows="3"
                      style="font-size:0.8rem;margin-bottom:6px;"
                    ></textarea>
                    <div style="display:flex;gap:6px;">
                      <button
                        class="btn btn-accent"
                        style="font-size:0.75rem;"
                        disabled={savingComment}
                        on:click={saveEditComment}
                      >{savingComment ? 'Saving…' : 'Save'}</button>
                      <button class="btn btn-ghost" style="font-size:0.75rem;" on:click={cancelEditComment}>Cancel</button>
                    </div>
                  {:else}
                    <div style="font-size:0.78rem;color:var(--color-text);line-height:1.5;">{c.comment}</div>
                  {/if}
                </div>
              {/each}
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
  }

  .editable-title {
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 6px;
    border-radius: 6px;
    padding: 2px 4px;
    margin: -2px -4px;
    transition: background 0.15s;
  }

  .editable-title:hover {
    background: rgba(99, 102, 241, 0.07);
  }

  .edit-hint {
    font-size: 0.7rem;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .editable-title:hover .edit-hint {
    opacity: 1;
  }

  .drawer-body {
    padding: 20px;
    flex: 1;
    overflow-y: auto;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }

  .meta-cell {
    padding: 10px;
    background: rgba(241, 245, 249, 0.8);
    border-radius: 10px;
    border: 1px solid var(--color-border);
  }

  :global(.dark) .meta-cell {
    background: rgba(30, 41, 59, 0.8);
  }

  .meta-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    margin-bottom: 2px;
  }

  .meta-value {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--color-text);
  }

  .section-label {
    font-size: 0.65rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-muted);
    margin-bottom: 8px;
  }

  .tag-chip {
    font-size: 0.72rem;
    background: rgba(99, 102, 241, 0.1);
    color: #6366f1;
    border: 1px solid rgba(99, 102, 241, 0.2);
    padding: 2px 10px;
    border-radius: 9999px;
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

  .json-pre {
    font-size: 0.75rem;
    background: rgba(248, 250, 252, 0.8);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    padding: 12px;
    overflow-x: auto;
    color: var(--color-text);
    font-family: 'JetBrains Mono', monospace;
  }

  :global(.dark) .json-pre {
    background: rgba(15, 23, 42, 0.8);
  }

  .comment-card {
    padding: 10px 14px;
    border: 1px solid var(--color-border);
    border-radius: 10px;
    background: rgba(241, 245, 249, 0.5);
  }

  :global(.dark) .comment-card {
    background: rgba(30, 41, 59, 0.5);
  }

  .comment-avatar {
    width: 20px;
    height: 20px;
    border-radius: 9999px;
    background: linear-gradient(135deg, #6366f1, #0ea5e9);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    color: white;
    font-weight: 700;
  }

  .comment-compose {
    padding: 12px;
    background: rgba(241, 245, 249, 0.5);
    border: 1px solid var(--color-border);
    border-radius: 10px;
  }

  :global(.dark) .comment-compose {
    background: rgba(30, 41, 59, 0.4);
  }
</style>
