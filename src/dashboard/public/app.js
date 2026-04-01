let currentRepo = null;
let currentMemories = [];
let currentPage = 1;
let pageSize = 10;
let totalPages = 1;
let totalItems = 0;
let selectedIds = new Set();
let currentPaginatedData = [];
let charts = {};
let lastSyncTime = Date.now();
let countdownSeconds = 30;
let countdownInterval = null;
let recentActions = [];
let recentActionsPage = 1;
let recentActionsPageSize = 5;
let recentActionsTotalPages = 1;
let recentActionsTotalItems = 0;
let activeEditMemoryId = null;
let currentDrawerMemoryId = null;
let availableRepos = [];
let isRepoSidebarCollapsed = false;
let pinnedRepoOrder = [];
let draggedPinnedRepo = null;
let isGlobalFilterActive = false;

function syncStickyOffsets() {
    const topBar = document.getElementById('mainTopBar');
    const tabNav = document.querySelector('.sticky-tab-nav');
    if (!topBar) return;

    const topBarHeight = Math.ceil(topBar.getBoundingClientRect().height);
    const tabNavHeight = tabNav ? Math.ceil(tabNav.getBoundingClientRect().height) : 0;

    document.documentElement.style.setProperty('--dashboard-header-offset', `${topBarHeight}px`);
    document.documentElement.style.setProperty('--dashboard-tab-offset', `${tabNavHeight}px`);
}

async function loadRecentActions(page = recentActionsPage) {
    try {
        let url = `/api/recent-actions?page=${page}&pageSize=${recentActionsPageSize}`;
        if (currentRepo) url += `&repo=${encodeURIComponent(currentRepo)}`;
        const response = await fetch(url);
        const data = await response.json();
        recentActions = data.actions || [];
        recentActionsPage = data.pagination?.page ?? page;
        recentActionsTotalPages = data.pagination?.totalPages ?? 1;
        recentActionsTotalItems = data.pagination?.totalItems ?? recentActions.length;
        renderRecentActions();
    } catch (err) {
        console.error('Failed to load recent actions:', err);
    }
}

function goToRecentActionsPage(page) {
    if (page < 1 || page > recentActionsTotalPages) return;
    recentActionsPage = page;
    loadRecentActions(page);
}

function formatActionDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return date.toLocaleDateString();
}

function getActionIcon(action) {
    const icons = {
        search: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>',
        read: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path>',
        write: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path>',
        update: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>',
        delete: '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>'
    };
    return icons[action] || icons.search;
}

function getActionColor(action) {
    const colors = {
        search: 'bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400',
        read: 'bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400',
        write: 'bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-400',
        update: 'bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-400',
        delete: 'bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400'
    };
    return colors[action] || colors.search;
}

function getBubbleStyle(action) {
    const styles = {
        search: {
            bubble: 'bg-blue-500 dark:bg-blue-600 text-white',
            label: 'text-blue-100',
            meta:  'text-blue-200',
            align: 'items-start',
            tail:  'left-2 -bottom-1.5 border-r-blue-500 dark:border-r-blue-600',
        },
        read: {
            bubble: 'bg-emerald-500 dark:bg-emerald-600 text-white',
            label: 'text-emerald-100',
            meta:  'text-emerald-200',
            align: 'items-start',
            tail:  'left-2 -bottom-1.5 border-r-emerald-500 dark:border-r-emerald-600',
        },
        write: {
            bubble: 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100',
            label: 'text-gray-500 dark:text-gray-400',
            meta:  'text-gray-400 dark:text-gray-500',
            align: 'items-start',
            tail:  'left-2 -bottom-1.5 border-r-gray-100 dark:border-r-gray-700',
        },
        update: {
            bubble: 'bg-amber-100 dark:bg-amber-900 text-amber-900 dark:text-amber-100',
            label: 'text-amber-600 dark:text-amber-400',
            meta:  'text-amber-500 dark:text-amber-500',
            align: 'items-start',
            tail:  'left-2 -bottom-1.5 border-r-amber-100 dark:border-r-amber-900',
        },
        delete: {
            bubble: 'bg-red-100 dark:bg-red-900 text-red-900 dark:text-red-100',
            label: 'text-red-500 dark:text-red-400',
            meta:  'text-red-400',
            align: 'items-start',
            tail:  'left-2 -bottom-1.5 border-r-red-100 dark:border-r-red-900',
        },
    };
    return styles[action] || styles.search;
}

function renderActionBubble(action) {
    const s = getBubbleStyle(action.action);
    const isRight = false; // Force left alignment

    // Main content line
    let mainText = '';
    let subText = '';

    if (action.action === 'search') {
        mainText = `🔍 "${action.query || ''}"`;
        subText = action.result_count != null ? `${action.result_count} result${action.result_count !== 1 ? 's' : ''} found` : '';
    } else {
        if (action.task_id) {
            mainText = action.task_title || action.task_code || action.task_id.substring(0, 8);
            const verb = { write: '💾 Created Task', update: '🔄 Updated Task', delete: '🗑️ Deleted Task' }[action.action] || action.action;
            subText = action.task_code ? `${verb} [${action.task_code}]` : verb;
        } else {
            mainText = action.memory_title
                ? action.memory_title
                : action.memory_id ? action.memory_id.substring(0, 8) + '…' : '—';
            const typeLabel = action.memory_type ? `[${action.memory_type}]` : '';
            const verb = { write: '💾 Stored', update: '🔄 Updated', delete: '🗑️ Deleted', read: '📖 Read' }[action.action] || action.action;
            subText = [verb, typeLabel].filter(Boolean).join(' ');
        }
    }

    const burst = action.burstCount > 1
        ? `<span class="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-xs font-bold">×${action.burstCount}</span>`
        : '';

    return `
        <div class="flex flex-col ${s.align} mb-4">
            <div class="flex items-center gap-1.5 mb-1 px-1">
                <div class="w-5 h-5 rounded-full ${s.bubble} flex items-center justify-center flex-shrink-0">
                    <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">${getActionIcon(action.action)}</svg>
                </div>
                <span class="text-xs font-semibold capitalize ${s.label.replace('text-', 'text-').replace('100','500').replace('200','500')}">${action.action}${burst}</span>
            </div>
            <div class="relative max-w-[95%]">
                <div class="${s.bubble} rounded-2xl rounded-bl-sm px-3 py-2 shadow-sm">
                    <p class="text-sm font-medium leading-snug break-words">${mainText}</p>
                    ${subText ? `<p class="text-xs mt-0.5 ${s.meta}">${subText}</p>` : ''}
                </div>
            </div>
            <span class="text-[10px] text-gray-400 dark:text-gray-500 mt-1 px-1">${formatActionDate(action.created_at)}</span>
        </div>
    `;
}

function renderRecentActions() {
    const container = document.getElementById('recentQueries');
    const paginationEl = document.getElementById('recentActionsPagination');

    if (recentActions.length === 0 && recentActionsPage === 1) {
        container.innerHTML = '<div class="text-gray-400 text-sm text-center py-6">No recent actions</div>';
        if (paginationEl) paginationEl.innerHTML = '';
        return;
    }

    container.innerHTML = recentActions.map(renderActionBubble).join('');

    if (paginationEl) {
        if (recentActionsTotalPages <= 1) {
            paginationEl.innerHTML = '';
        } else {
            const prevDisabled = recentActionsPage <= 1;
            const nextDisabled = recentActionsPage >= recentActionsTotalPages;
            paginationEl.innerHTML = `
                <div class="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
                    <span class="text-xs text-gray-500">${recentActionsPage} / ${recentActionsTotalPages}</span>
                    <div class="flex gap-1">
                        <button onclick="goToRecentActionsPage(${recentActionsPage - 1})"
                            class="px-2 py-1 rounded text-xs font-medium ${prevDisabled ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}"
                            ${prevDisabled ? 'disabled' : ''}>&#8592;</button>
                        <button onclick="goToRecentActionsPage(${recentActionsPage + 1})"
                            class="px-2 py-1 rounded text-xs font-medium ${nextDisabled ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}"
                            ${nextDisabled ? 'disabled' : ''}>&#8594;</button>
                    </div>
                </div>
            `;
        }
    }
}

function searchFromRecent(query) {
    document.getElementById('searchInput').value = query;
    currentPage = 1;
    loadMemories();
}

function getRepoInitials(repo) {
    return repo
        .split(/[\/\-_.]/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join('')
        .slice(0, 2) || 'RP';
}

function getRepoLastUpdatedLabel(repoMeta) {
    if (!repoMeta?.last_updated_at) return 'No updates yet';
    return `Updated ${formatDate(repoMeta.last_updated_at)}`;
}

function applyRepoSidebarState() {
    const layout = document.getElementById('appLayout');
    const icon = document.getElementById('repoSidebarCollapseIcon');
    const button = document.getElementById('repoSidebarCollapseToggle');
    if (!layout || !icon || !button) return;

    layout.classList.toggle('repo-sidebar-collapsed', isRepoSidebarCollapsed);
    icon.style.transform = isRepoSidebarCollapsed ? 'rotate(180deg)' : 'rotate(0deg)';
    button.title = isRepoSidebarCollapsed ? 'Expand repositories' : 'Collapse repositories';
    button.setAttribute('aria-label', button.title);
}

function toggleRepoSidebarCollapse() {
    isRepoSidebarCollapsed = !isRepoSidebarCollapsed;
    localStorage.setItem('repoSidebarCollapsed', isRepoSidebarCollapsed ? '1' : '0');
    applyRepoSidebarState();
    renderRepoSidebar();
}

function updateCollapsedRepoSummary() {
    const initials = document.getElementById('repoCollapsedSummaryInitials');
    const count = document.getElementById('repoCollapsedSummaryCount');
    const button = document.getElementById('repoCollapsedSummaryButton');
    if (!initials || !count || !button) return;

    const activeRepo = availableRepos.find((item) => item.repo === currentRepo);
    initials.textContent = getRepoInitials(currentRepo || 'RP');
    count.textContent = String(activeRepo?.memory_count ?? 0);
    button.title = activeRepo
        ? `${activeRepo.repo} • ${activeRepo.memory_count} memories`
        : 'Active repository';
}

function persistPinnedRepos() {
    localStorage.setItem('pinnedRepos', JSON.stringify(pinnedRepoOrder));
}

function initPinnedRepos() {
    try {
        const raw = localStorage.getItem('pinnedRepos');
        const parsed = raw ? JSON.parse(raw) : [];
        pinnedRepoOrder = Array.isArray(parsed) ? parsed : [];
    } catch {
        pinnedRepoOrder = [];
    }
}

function isRepoPinned(repo) {
    return pinnedRepoOrder.includes(repo);
}

function getOrderedPinnedRepos(repos) {
    return repos
        .filter((item) => isRepoPinned(item.repo))
        .sort((a, b) => pinnedRepoOrder.indexOf(a.repo) - pinnedRepoOrder.indexOf(b.repo));
}

function togglePinnedRepo(repo, event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }

    if (!repo) return;

    if (isRepoPinned(repo)) pinnedRepoOrder = pinnedRepoOrder.filter((item) => item !== repo);
    else pinnedRepoOrder.push(repo);

    persistPinnedRepos();
    renderRepoSidebar();
}

function startPinnedRepoDrag(repo, event) {
    if (!isRepoPinned(repo)) return;
    draggedPinnedRepo = repo;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', repo);
    event.currentTarget.classList.add('dragging');
}

function overPinnedRepoDrag(repo, event) {
    if (!draggedPinnedRepo || draggedPinnedRepo === repo || !isRepoPinned(repo)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-target');
}

function leavePinnedRepoDrag(event) {
    event.currentTarget.classList.remove('drag-target');
}

function dropPinnedRepo(repo, event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-target');

    const draggedRepo = draggedPinnedRepo || event.dataTransfer.getData('text/plain');
    if (!draggedRepo || draggedRepo === repo || !isRepoPinned(draggedRepo) || !isRepoPinned(repo)) return;

    const nextOrder = pinnedRepoOrder.filter((item) => item !== draggedRepo);
    const targetIndex = nextOrder.indexOf(repo);
    nextOrder.splice(targetIndex, 0, draggedRepo);
    pinnedRepoOrder = nextOrder;
    draggedPinnedRepo = null;
    persistPinnedRepos();
    renderRepoSidebar();
}

function endPinnedRepoDrag(event) {
    draggedPinnedRepo = null;
    event.currentTarget.classList.remove('dragging');
    document.querySelectorAll('.repo-item.drag-target').forEach((el) => el.classList.remove('drag-target'));
}

function renderRepoSidebar() {
    const desktopQuery = document.getElementById('repoSearchInput')?.value?.trim().toLowerCase() || '';
    const mobileQuery = document.getElementById('repoSearchInputMobile')?.value?.trim().toLowerCase() || '';
    const query = desktopQuery || mobileQuery;
    const repos = availableRepos.filter((item) => item.repo.toLowerCase().includes(query));
    const pinnedItems = getOrderedPinnedRepos(repos);
    const unpinnedItems = repos.filter((item) => !isRepoPinned(item.repo));

    const renderItems = (items) => items.map((item) => `
        <div class="repo-item ${item.repo === currentRepo ? 'active' : ''} ${isRepoPinned(item.repo) ? 'pinned-item' : ''}" onclick="setCurrentRepo('${item.repo.replace(/'/g, "\\'")}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); setCurrentRepo('${item.repo.replace(/'/g, "\\'")}')}" title="${item.repo} • ${item.memory_count} memories" role="button" tabindex="0" ${isRepoPinned(item.repo) ? `draggable="true" ondragstart="startPinnedRepoDrag('${item.repo.replace(/'/g, "\\'")}', event)" ondragover="overPinnedRepoDrag('${item.repo.replace(/'/g, "\\'")}', event)" ondragleave="leavePinnedRepoDrag(event)" ondrop="dropPinnedRepo('${item.repo.replace(/'/g, "\\'")}', event)" ondragend="endPinnedRepoDrag(event)"` : ''}>
            <span class="repo-avatar">${getRepoInitials(item.repo)}${isRepoPinned(item.repo) ? '<span class="repo-pinned-mark">★</span>' : ''}</span>
            <span class="repo-item-copy min-w-0 flex-1">
                <span class="flex items-center justify-between gap-3">
                    <span class="flex items-center gap-2 min-w-0">
                        ${isRepoPinned(item.repo) ? `
                            <span class="repo-drag-handle" title="Drag to reorder pinned repositories" aria-hidden="true">
                                <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                    <path d="M7 4a1.5 1.5 0 110 3 1.5 1.5 0 010-3Zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3ZM7 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3Zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3ZM7 13a1.5 1.5 0 110 3 1.5 1.5 0 010-3Zm6 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3Z"/>
                                </svg>
                            </span>
                        ` : ''}
                        <span class="block truncate text-sm font-semibold text-gray-900 dark:text-gray-100">${item.repo}</span>
                    </span>
                    <span class="text-[11px] font-semibold text-sky-700 dark:text-sky-200">${item.memory_count}</span>
                </span>
                <span class="block truncate text-xs text-gray-500 dark:text-gray-400">${item.repo === currentRepo ? 'Active repository' : getRepoLastUpdatedLabel(item)}</span>
            </span>
            <button class="repo-item-pin ${isRepoPinned(item.repo) ? 'pinned' : ''}" onclick="togglePinnedRepo('${item.repo.replace(/'/g, "\\'")}', event)" title="${isRepoPinned(item.repo) ? 'Unpin repository' : 'Pin repository'}" aria-label="${isRepoPinned(item.repo) ? 'Unpin repository' : 'Pin repository'}">
                <svg class="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M12.586 2.586a2 2 0 0 1 2.828 0l2 2a2 2 0 0 1 0 2.828l-1.793 1.793-.914 4.57a1 1 0 0 1-.271.51l-1.414 1.414a1 1 0 0 1-1.414 0l-2.122-2.121-4.172 4.171a1 1 0 1 1-1.414-1.414l4.171-4.172-2.12-2.12a1 1 0 0 1 0-1.415l1.413-1.414a1 1 0 0 1 .51-.27l4.57-.915 1.792-1.793Z"/>
                </svg>
            </button>
            ${item.repo === currentRepo ? '<span class="repo-active-dot"></span>' : ''}
        </div>
    `).join('');

    const renderGroups = () => {
        const groups = [];
        if (pinnedItems.length > 0) {
            groups.push(`
                <section class="repo-group">
                    <div class="repo-group-label">Pinned</div>
                    <div class="space-y-2">${renderItems(pinnedItems)}</div>
                </section>
            `);
        }
        if (unpinnedItems.length > 0) {
            groups.push(`
                <section class="repo-group">
                    <div class="repo-group-label">${pinnedItems.length > 0 ? 'All Repositories' : 'Repositories'}</div>
                    <div class="space-y-2">${renderItems(unpinnedItems)}</div>
                </section>
            `);
        }
        return groups.join('');
    };

    document.getElementById('repoCountBadge').textContent = String(availableRepos.length);
    document.getElementById('currentRepoLabel').textContent = currentRepo || 'No repository';
    updateCollapsedRepoSummary();

    if (repos.length === 0) {
        document.getElementById('repoSidebarList').innerHTML = '<div class="text-sm text-gray-500 dark:text-gray-400 px-3 py-4">No repositories found.</div>';
        const mobile = document.getElementById('repoSidebarListMobile');
        if (mobile) mobile.innerHTML = '<div class="text-sm text-gray-500 dark:text-gray-400 px-3 py-4">No repositories found.</div>';
        return;
    }

    document.getElementById('repoSidebarList').innerHTML = renderGroups();
    const mobile = document.getElementById('repoSidebarListMobile');
    if (mobile) mobile.innerHTML = renderGroups();
    syncStickyOffsets();
}

async function setCurrentRepo(repo) {
    if (!repo || repo === currentRepo) return;
    currentRepo = repo;
    currentPage = 1;
    recentActionsPage = 1;
    selectedIds.clear();
    localStorage.setItem('selectedRepo', currentRepo);
    renderRepoSidebar();
    closeRepoSidebarDrawer();
    await Promise.all([
        loadStats(),
        loadMemories(),
        loadRecentActions(),
    ]);
    syncStickyOffsets();
}

function openRepoSidebarDrawer() {
    document.getElementById('repoSidebarDrawer').classList.remove('hidden');
    document.body.classList.add('drawer-open');
}

function closeRepoSidebarDrawer() {
    document.getElementById('repoSidebarDrawer').classList.add('hidden');
    if (!document.getElementById('memoryDrawer') || document.getElementById('memoryDrawer').classList.contains('hidden')) {
        document.body.classList.remove('drawer-open');
    }
}

function initTheme() {
    const saved = localStorage.getItem('theme') || 'light';
    document.documentElement.classList.toggle('dark', saved === 'dark');
}

function initRepoSidebarState() {
    isRepoSidebarCollapsed = localStorage.getItem('repoSidebarCollapsed') === '1';
    applyRepoSidebarState();
}

function startCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownSeconds = 30;
    updateCountdown();
    
    countdownInterval = setInterval(() => {
        countdownSeconds--;
        if (countdownSeconds <= 0) {
            countdownSeconds = 30;
            loadData();
        }
        updateCountdown();
    }, 1000);
}

function updateCountdown() {
    const fill = document.getElementById('countdownFill');
    const status = document.getElementById('syncStatus');
    const percent = (countdownSeconds / 30) * 100;
    fill.style.width = percent + '%';
    
    if (countdownSeconds <= 5) {
        fill.style.background = '#ef4444';
    } else if (countdownSeconds <= 10) {
        fill.style.background = '#f97316';
    } else {
        fill.style.background = '#3b82f6';
    }
    
    status.textContent = `Synced ${countdownSeconds}s ago`;
}

['themeToggle', 'themeToggleMobile'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
        btn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
});

document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    if (e.key === 'Escape') closeDrawer();
    else if (e.key === 'r' || e.key === 'R') loadData();
    else if (e.key === '/') {
        e.preventDefault();
        document.getElementById('searchInput')?.focus();
    }
});

async function checkStatus() {
    try {
        const response = await fetch('/api/health');
        const data = await response.json();
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        
        if (data.connected) {
            dot.classList.remove('bg-gray-400');
            dot.classList.add('bg-green-500');
            text.textContent = 'Connected';
        } else {
            dot.classList.remove('bg-green-500');
            dot.classList.add('bg-gray-400');
            text.textContent = 'Disconnected';
        }

        const dbPathLabel = document.getElementById('dbPathLabel');
        if (dbPathLabel && data.dbPath) {
            dbPathLabel.textContent = data.dbPath.split(/[/\\]/).pop() || data.dbPath;
            dbPathLabel.title = data.dbPath;
        }

        const appVersion = document.getElementById('appVersion');
        if (appVersion && data.version) {
            appVersion.textContent = `v${data.version}`;
        }

        const summary = document.getElementById('memorySummaryLabel');
        if (summary) {
            summary.textContent = `${data.memoryCount || 0} memories indexed`;
        }
    } catch (err) {
        console.error('Status check failed:', err);
        const dot = document.getElementById('statusDot');
        dot.classList.remove('bg-green-500');
        dot.classList.add('bg-gray-400');
        document.getElementById('statusText').textContent = 'Error';
    }
}

async function loadRepos() {
    try {
        const response = await fetch('/api/repos');
        const data = await response.json();
        if (data.repos && data.repos.length > 0) {
            availableRepos = data.repos;
            const savedRepo = localStorage.getItem('selectedRepo');
            const repoNames = availableRepos.map((item) => item.repo);
            if (savedRepo && repoNames.includes(savedRepo)) {
                currentRepo = savedRepo;
            } else if (!currentRepo) {
                currentRepo = availableRepos[0].repo;
            }
            localStorage.setItem('selectedRepo', currentRepo);
            renderRepoSidebar();
        } else {
            availableRepos = [];
            currentRepo = null;
            renderRepoSidebar();
        }
    } catch (err) {
        console.error('Failed to load repos:', err);
        availableRepos = [];
        document.getElementById('repoSidebarList').innerHTML = '<div class="text-sm text-red-500 px-3 py-4">Failed to load repositories.</div>';
    }
}

async function loadStats() {
    try {
        const url = currentRepo ? `/api/stats?repo=${encodeURIComponent(currentRepo)}` : '/api/stats';
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Stats request failed with ${response.status}`);
        }
        const data = await response.json();

        document.getElementById('totalCount').textContent = data.total;
        document.getElementById('avgImportance').textContent = data.avgImportance || '0';
        document.getElementById('totalHits').textContent = data.totalHitCount || '0';
        document.getElementById('expiringSoon').textContent = data.expiringSoon || '0';
        document.getElementById('codeFactCount').textContent = data.byType?.code_fact || 0;
        document.getElementById('decisionCount').textContent = data.byType?.decision || 0;
        document.getElementById('mistakeCount').textContent = data.byType?.mistake || 0;
        document.getElementById('patternCount').textContent = data.byType?.pattern || 0;

        // Fill Task stats
        if (data.taskStats) {
            document.getElementById('totalTasks').textContent = data.taskStats.total || 0;
            document.getElementById('todoTasksCount').textContent = data.taskStats.todo || 0;
            document.getElementById('inProgressTasksCount').textContent = data.taskStats.inProgress || 0;
            document.getElementById('completedTasksCount').textContent = data.taskStats.completed || 0;
            
            document.getElementById('todoStatCount').textContent = data.taskStats.todo || 0;
            document.getElementById('inProgressStatCount').textContent = data.taskStats.inProgress || 0;
            document.getElementById('completedStatCount').textContent = data.taskStats.completed || 0;
            document.getElementById('blockedStatCount').textContent = data.taskStats.blocked || 0;
            
            updateTaskStatusChart(data.taskStats);
        }

        updateTypeChart(data.byType);
        updateTimeSeriesChart(data.timeSeries || {});
        updateScatterChart(data.scatterData || []);
        updateTopMemoriesChart(data.topMemories);
        syncStickyOffsets();
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

function updateTypeChart(byType) {
    const ctx = document.getElementById('typeChart');
    if (!window.Chart || !ctx) return;
    if (charts.typeChart) charts.typeChart.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const counts = [
        byType?.decision || 0,
        byType?.mistake || 0,
        byType?.code_fact || 0,
        byType?.pattern || 0
    ];

    charts.typeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Decision', 'Mistake', 'Code Fact', 'Pattern'],
            datasets: [{
                data: counts,
                backgroundColor: ['#fb7185', '#c084fc', '#38bdf8', '#34d399'],
                borderWidth: 2,
                borderColor: isDark ? '#1e293b' : '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    titleColor: isDark ? '#f8fafc' : '#1e293b',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 10
                }
            }
        }
    });
}

function updateTaskStatusChart(taskStats) {
    const ctx = document.getElementById('taskStatusChart');
    if (!window.Chart || !ctx) return;
    if (charts.taskStatusChart) charts.taskStatusChart.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const counts = [
        taskStats?.todo || 0,
        taskStats?.inProgress || 0,
        taskStats?.completed || 0,
        taskStats?.blocked || 0
    ];

    charts.taskStatusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['To Do', 'In Progress', 'Completed', 'Blocked'],
            datasets: [{
                data: counts,
                backgroundColor: ['#94a3b8', '#38bdf8', '#10b981', '#fb7185'],
                borderWidth: 2,
                borderColor: isDark ? '#1e293b' : '#ffffff',
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    titleColor: isDark ? '#f8fafc' : '#1e293b',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 10,
                    cornerRadius: 10
                }
            }
        }
    });
}

function updateTopMemoriesChart(memories = []) {
    const ctx = document.getElementById('topMemoriesChart');
    if (!window.Chart) {
        ctx.parentElement.innerHTML = '<div class="p-4 text-center text-gray-500 text-xs">Chart.js not available</div>';
        return;
    }
    if (charts.topMemoriesChart) charts.topMemoriesChart.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    charts.topMemoriesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: memories.map((m, i) => `#${i + 1}`),
            datasets: [{
                label: 'Hit Count',
                data: memories.map(m => m.hit_count || m.importance),
                backgroundColor: isDark
                    ? 'rgba(56,189,248,0.45)'
                    : 'rgba(37,99,235,0.55)',
                borderColor: isDark ? '#38bdf8' : '#2563eb',
                borderWidth: 1,
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    titleColor: isDark ? '#f8fafc' : '#1e293b',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 8,
                    cornerRadius: 8
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)', drawBorder: false },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
}

function updateTimeSeriesChart(timeSeries) {
    const ctx = document.getElementById('timeSeriesChart');
    if (!window.Chart || !ctx) return;
    if (charts.timeSeriesChart) charts.timeSeriesChart.destroy();

    const labels = Object.keys(timeSeries);
    const creationData = labels.map(k => (typeof timeSeries[k] === 'object' ? timeSeries[k].write : timeSeries[k]) || 0);
    const readData = labels.map(k => (typeof timeSeries[k] === 'object' ? timeSeries[k].read : 0) || 0);
    const searchData = labels.map(k => (typeof timeSeries[k] === 'object' ? timeSeries[k].search : 0) || 0);

    const isDark = document.documentElement.classList.contains('dark');

    charts.timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels.map(l => l.split('-').slice(1).join('/')),
            datasets: [
                {
                    label: 'Created',
                    data: creationData,
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.4,
                    fill: true
                },
                {
                    label: 'Read',
                    data: readData,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.4,
                    borderDash: [5, 5]
                },
                {
                    label: 'Search',
                    data: searchData,
                    borderColor: '#6366f1',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 3,
                    tension: 0.4,
                    borderDash: [2, 2]
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { 
                        color: isDark ? '#94a3b8' : '#64748b', 
                        usePointStyle: true, 
                        boxWidth: 6,
                        font: { size: 10, weight: 'bold' }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)', drawBorder: false },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 }, stepSize: 1 }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 }, maxRotation: 0 }
                }
            }
        }
    });
}

function showAddMemoryModal() {
    if (!currentRepo) {
        showToast('Please select a repository first', 'error');
        return;
    }
    document.getElementById('addMemoryModal').classList.remove('hidden');
    document.body.classList.add('drawer-open');
}

function hideAddMemoryModal() {
    document.getElementById('addMemoryModal').classList.add('hidden');
    document.body.classList.remove('drawer-open');
    document.getElementById('addMemoryForm').reset();
}

function showAddTaskModal() {
    if (!currentRepo) {
        showToast('Please select a repository first', 'error');
        return;
    }
    document.getElementById('addTaskModal').classList.remove('hidden');
    document.body.classList.add('drawer-open');
}

function hideAddTaskModal() {
    document.getElementById('addTaskModal').classList.add('hidden');
    document.body.classList.remove('drawer-open');
    document.getElementById('addTaskForm').reset();
}

async function handleMemorySubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    data.repo = currentRepo;
    data.is_global = event.target.is_global.checked;
    // agent and model are already in data from FormData entries

    try {
        const res = await fetch('/api/memories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showToast('Memory added successfully', 'success');
            hideAddMemoryModal();
            loadData();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to add memory', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

async function handleTaskSubmit(event) {
    event.preventDefault();
    const formData = new FormData(event.target);
    const data = Object.fromEntries(formData.entries());
    data.repo = currentRepo;

    try {
        const res = await fetch('/api/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (res.ok) {
            showToast('Task created successfully', 'success');
            hideAddTaskModal();
            loadTasks();
            loadRecentActions();
        } else {
            const err = await res.json();
            showToast(err.error || 'Failed to create task', 'error');
        }
    } catch (err) {
        showToast('Network error', 'error');
    }
}

window.showAddMemoryModal = showAddMemoryModal;
window.hideAddMemoryModal = hideAddMemoryModal;
window.showAddTaskModal = showAddTaskModal;
window.hideAddTaskModal = hideAddTaskModal;
window.handleMemorySubmit = handleMemorySubmit;
window.handleTaskSubmit = handleTaskSubmit;

function updateScatterChart(scatterData) {
    const ctx = document.getElementById('scatterChart');
    if (!window.Chart) return;
    if (charts.scatterChart) charts.scatterChart.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    charts.scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Memories',
                data: scatterData,
                backgroundColor: isDark ? 'rgba(129,140,248,0.55)' : 'rgba(96,165,250,0.7)',
                borderColor: isDark ? '#818cf8' : '#6366f1',
                borderWidth: 1,
                pointRadius: 5,
                pointHoverRadius: 7
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#1e293b' : '#ffffff',
                    titleColor: isDark ? '#f8fafc' : '#1e293b',
                    bodyColor: isDark ? '#94a3b8' : '#64748b',
                    borderColor: isDark ? '#334155' : '#e2e8f0',
                    borderWidth: 1,
                    padding: 8,
                    cornerRadius: 8
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Importance', color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } },
                    min: 0, max: 6,
                    grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } }
                },
                y: {
                    title: { display: true, text: 'Hit Count', color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } },
                    beginAtZero: true,
                    grid: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
                    ticks: { color: isDark ? '#64748b' : '#94a3b8', font: { size: 10 } }
                }
            }
        }
    });
}

async function loadMemories() {
    if (!currentRepo) {
        document.getElementById('tableContainer').innerHTML = '<div class="text-gray-500 py-12">Please select a repository</div>';
        return;
    }

    try {
        renderTableSkeleton();
        const typeFilter = document.getElementById('typeFilter').value;
        const search = document.getElementById('searchInput').value.trim();
        const minImportance = document.getElementById('minImportanceFilter').value;
        const maxImportance = document.getElementById('maxImportanceFilter').value;

        let url = `/api/memories?repo=${encodeURIComponent(currentRepo)}&page=${currentPage}&pageSize=${pageSize}&sortBy=${encodeURIComponent(sortColumn)}&sortOrder=${encodeURIComponent(sortOrder)}`;
        if (typeFilter) url += `&type=${typeFilter}`;
        if (search) url += `&search=${encodeURIComponent(search)}`;
        if (minImportance) url += `&minImportance=${encodeURIComponent(minImportance)}`;
        if (maxImportance) url += `&maxImportance=${encodeURIComponent(maxImportance)}`;

        const response = await fetch(url);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load memories');
        currentMemories = data.memories;
        currentPaginatedData = currentMemories;
        totalItems = data.pagination?.totalItems || currentMemories.length;
        totalPages = data.pagination?.totalPages || 1;
        updatePaginationControls(totalItems);
        renderTable(currentMemories);
    } catch (err) {
        console.error('Failed to load memories:', err);
        document.getElementById('errorMessage').innerHTML = `<div class="p-4 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 rounded mb-4">Failed to load memories: ${err.message}</div>`;
    }
}

function renderTableSkeleton() {
    const container = document.getElementById('tableContainer');
    container.innerHTML = `
        <div class="overflow-x-auto max-h-[68vh]">
            <table class="w-full border-collapse sticky-table-header table-animate">
                <thead>
                    <tr class="border-b-2 border-gray-200 dark:border-gray-700">
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold"></th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Memory</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Source</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Type</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Priority</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Usage</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Freshness</th>
                        <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold sticky-actions">Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${Array.from({ length: Math.min(pageSize, 6) }).map(() => `
                        <tr class="border-b border-gray-100 dark:border-gray-700">
                            <td class="p-3"><div class="skeleton h-4 w-4"></div></td>
                            <td class="p-3"><div class="skeleton h-4 w-52 mb-2"></div><div class="skeleton h-3 w-36"></div></td>
                            <td class="p-3"><div class="skeleton h-4 w-20 mb-2"></div><div class="skeleton h-3 w-16"></div></td>
                            <td class="p-3"><div class="skeleton h-6 w-20"></div></td>
                            <td class="p-3"><div class="skeleton h-6 w-12 mb-2"></div><div class="skeleton h-3 w-12"></div></td>
                            <td class="p-3"><div class="skeleton h-4 w-16 mb-2"></div><div class="skeleton h-3 w-14"></div></td>
                            <td class="p-3"><div class="skeleton h-4 w-14 mb-2"></div><div class="skeleton h-3 w-12"></div></td>
                            <td class="p-3 sticky-actions"><div class="flex gap-2"><div class="skeleton h-7 w-14"></div><div class="skeleton h-7 w-14"></div></div></td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function renderMarkdown(text) {
    if (!text) return '';
    if (typeof marked === 'undefined') {
        // Fallback if marked.js didn't load
        const div = document.createElement('div');
        div.textContent = text;
        return `<pre style="white-space:pre-wrap;font-size:0.85rem;line-height:1.7">${div.innerHTML}</pre>`;
    }
    try {
        marked.setOptions({ breaks: true, gfm: true });
        return marked.parse(text);
    } catch (e) {
        const div = document.createElement('div');
        div.textContent = text;
        return `<pre style="white-space:pre-wrap">${div.innerHTML}</pre>`;
    }
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - date) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function renderTable(memories) {
    const container = document.getElementById('tableContainer');
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    const paginated = memories;

    if (paginated.length === 0) {
        container.innerHTML = '<div class="text-gray-500 py-12">No memories found matching your filters</div>';
        return;
    }

    function highlightText(text, query) {
        if (!query) return escapeHtml(text);
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return escapeHtml(text).replace(regex, '<mark>$1</mark>');
    }

    const table = document.createElement('div');
    table.className = 'overflow-x-auto max-h-[68vh]';
    table.innerHTML = `
        <table class="w-full border-collapse sticky-table-header table-animate">
            <thead>
                <tr class="border-b-2 border-gray-200 dark:border-gray-700">
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold"><input type="checkbox" id="selectAll" onchange="toggleSelectAll()"></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('title')" data-sort="title">Memory <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('agent')" data-sort="agent">Source <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('type')" data-sort="type">Type <span class="sort-icon"></span></th>

                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('importance')" data-sort="importance">Priority <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('hit_count')" data-sort="hit_count">Usage <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('created_at')" data-sort="created_at">Freshness <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${paginated.map(m => `
                    <tr id="row-${m.id}" class="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 ${m.status === 'archived' ? 'opacity-60 grayscale-[0.5]' : ''}">
                        <td class="p-3"><input type="checkbox" class="row-checkbox" value="${m.id}" ${selectedIds.has(m.id) ? 'checked' : ''} onchange="toggleSelect('${m.id}')"></td>
                        <td class="p-3 min-w-[18rem]">
                            <div class="flex items-center gap-2">
                                <button onclick="openDrawer('${m.id}')" class="text-left font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">${highlightText(getDisplayTitle(m), searchQuery)}</button>
                                ${m.is_global ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase">Global</span>' : ''}
                                ${m.status === 'archived' ? '<span class="px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-[10px] font-bold text-gray-500 uppercase">Archived</span>' : ''}
                            </div>
                            <div class="mt-1 flex flex-wrap gap-1">
                                ${m.tags && Array.isArray(m.tags) ? m.tags.map(tag => `<span class="text-[9px] px-1 bg-gray-100 dark:bg-gray-800 text-gray-500 rounded border border-gray-200 dark:border-gray-700">#${tag}</span>`).join('') : ''}
                            </div>                            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                <span class="font-mono">${m.id.substring(0, 8)}</span>
                                <span class="mx-1">•</span>
                                <span>${m.scope?.repo || 'Unknown repo'}</span>
                            </div>
                        </td>
                        <td class="p-3">
                            <div class="flex flex-col">
                                <span class="text-[10px] font-bold text-sky-600 dark:text-sky-400 truncate max-w-[100px]" title="${m.agent || 'unknown'}">${m.agent || 'unknown'}</span>
                                <span class="text-[9px] font-medium text-slate-500 dark:text-slate-400 truncate max-w-[100px]" title="${m.role || 'unknown'}">${m.role || 'unknown'}</span>
                                <span class="text-[9px] text-gray-400 dark:text-gray-500 truncate max-w-[100px]" title="${m.model || 'unknown'}">${m.model || 'unknown'}</span>
                            </div>
                        </td>
                        <td class="p-3"><span class="table-chip type-${m.type}">${formatTypeLabel(m.type)}</span></td>
                        <td class="p-3">
                            <div class="metric-badge ${getImportanceBadgeClass(m.importance)}">${m.importance}/5</div>
                            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">${getImportanceLabel(m.importance)}</div>
                        </td>
                        <td class="p-3">
                            <div class="font-semibold">${formatUsageCount(m.hit_count)}</div>
                            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">${formatRecallRate(m.recall_rate)}</div>
                        </td>
                        <td class="p-3">
                            <div class="font-medium">${formatDate(m.created_at)}</div>
                            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">Updated ${formatDate(m.updated_at)}</div>
                        </td>
                        <td class="p-3 sticky-actions">
                            <div class="flex flex-wrap gap-1.5">
                                <button onclick="openDrawer('${m.id}')" class="btn-open">Open</button>
                                <button onclick="startInlineEdit('${m.id}')" class="btn-edit-light">Edit</button>
                            </div>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;

    container.innerHTML = '';
    container.appendChild(table);
}

let searchDebounce = null;
document.getElementById('searchInput').addEventListener('input', () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
        currentPage = 1;
        loadMemories();
    }, 300);
});

['typeFilter', 'minImportanceFilter', 'maxImportanceFilter'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        currentPage = 1;
        loadMemories();
    });
});

function changePageSize() {
    pageSize = parseInt(document.getElementById('pageSizeSelect').value);
    currentPage = 1;
    loadMemories();
}

function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    loadMemories();
}

function updatePaginationControls(totalItems) {
    totalPages = Math.max(1, totalPages || Math.ceil(totalItems / pageSize) || 1);
    if (currentPage > totalPages) currentPage = totalPages;
    
    document.getElementById('firstPageBtn').disabled = currentPage <= 1;
    document.getElementById('prevPageBtn').disabled = currentPage <= 1;
    document.getElementById('nextPageBtn').disabled = currentPage >= totalPages;
    document.getElementById('lastPageBtn').disabled = currentPage >= totalPages;
    
    const start = totalItems > 0 ? ((currentPage - 1) * pageSize) + 1 : 0;
    const end = Math.min(currentPage * pageSize, totalItems);
    document.getElementById('paginationInfo').textContent = totalItems > 0 ? `Showing ${start}-${end} of ${totalItems}` : 'No results';
}

let sortColumn = 'hit_count';
let sortOrder = 'desc';

function formatTypeLabel(type) {
    return type.replace('_', ' ');
}

function getDisplayTitle(memory) {
    if (memory.title && memory.title.trim()) {
        return memory.title.trim();
    }
    return memory.content.length > 80 ? `${memory.content.substring(0, 77)}...` : memory.content;
}

function getContentPreview(memory) {
    const text = memory.content.replace(/\s+/g, ' ').trim();
    return text.length > 220 ? `${text.substring(0, 217)}...` : text;
}

function getImportanceLabel(importance) {
    if (importance >= 5) return 'Critical';
    if (importance >= 4) return 'High';
    if (importance >= 3) return 'Medium';
    if (importance >= 2) return 'Low';
    return 'Minor';
}

function getImportanceBadgeClass(importance) {
    if (importance >= 5) return 'bg-gradient-to-r from-red-500/10 to-rose-500/10 text-red-700 dark:text-red-300 border-red-400/30';
    if (importance >= 4) return 'bg-gradient-to-r from-orange-500/10 to-amber-500/10 text-orange-700 dark:text-orange-300 border-orange-400/30';
    if (importance >= 3) return 'bg-gradient-to-r from-amber-400/10 to-yellow-400/10 text-amber-700 dark:text-amber-300 border-amber-400/30';
    if (importance >= 2) return 'bg-gradient-to-r from-sky-400/10 to-blue-400/10 text-sky-700 dark:text-sky-300 border-sky-400/30';
    return 'bg-gradient-to-r from-slate-300/10 to-gray-300/10 text-slate-600 dark:text-slate-400 border-slate-300/30';
}

function formatUsageCount(hitCount) {
    const value = hitCount || 0;
    if (value === 0) return 'Unused';
    if (value === 1) return '1 hit';
    return `${value} hits`;
}

function formatRecallRate(recallRate) {
    if (!recallRate) return 'Not recalled yet';
    return `${(recallRate * 100).toFixed(1)}% recall`;
}

function sortTable(column) {
    if (sortColumn === column) {
        sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortOrder = 'desc';
    }

    document.querySelectorAll('th[data-sort]').forEach(th => {
        th.classList.remove('sorted-asc', 'sorted-desc');
        if (th.dataset.sort === column) {
            th.classList.add(sortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
        }
    });

    currentPage = 1;
    loadMemories();
}

document.querySelectorAll('th[data-sort]').forEach(th => {
    if (th.dataset.sort === sortColumn) {
        th.classList.add(sortOrder === 'asc' ? 'sorted-asc' : 'sorted-desc');
    }
});

function toggleSelectAll() {
    const checked = document.getElementById('selectAll').checked;
    currentPaginatedData.forEach(m => {
        if (checked) selectedIds.add(m.id);
        else selectedIds.delete(m.id);
    });
    updateBulkBar();
    renderTable(currentMemories);
}

function toggleSelect(id) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    updateBulkBar();
}

function updateBulkBar() {
    const bar = document.getElementById('bulkActionBar');
    if (selectedIds.size > 0) {
        bar.classList.remove('hidden');
        document.getElementById('selectedCount').textContent = `${selectedIds.size} selected`;
    } else {
        bar.classList.add('hidden');
    }
}

function clearSelection() {
    selectedIds.clear();
    updateBulkBar();
    renderTable(currentMemories);
}

function renderDetailPanel(data) {
    const isEditing = activeEditMemoryId === data.id;
    return `
        <div class="space-y-5">
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">Summary</div>
                <p class="text-sm leading-6 text-gray-700 dark:text-gray-300">${escapeHtml(getContentPreview(data))}</p>
            </div>
            <div class="grid gap-4 md:grid-cols-3">
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Memory Info</div>
                    <div class="space-y-2 text-sm">
                        <div><strong>Type:</strong> ${formatTypeLabel(data.type)}</div>
                        <div><strong>ID:</strong> <span class="font-mono text-[10px]">${data.id}</span></div>
                        <div><strong>Priority:</strong> ${data.importance}/5</div>
                        <div><strong>Status:</strong> <span class="capitalize px-1.5 py-0.5 rounded ${data.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400'}">${data.status}</span></div>
                    </div>
                </div>
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Source Info</div>
                    <div class="space-y-2 text-sm">
                        <div><strong>Agent:</strong> ${escapeHtml(data.agent || 'unknown')}</div>
                        <div><strong>Model:</strong> ${escapeHtml(data.model || 'unknown')}</div>
                        <div><strong>Repo:</strong> ${escapeHtml(data.scope?.repo || 'N/A')}</div>
                    </div>
                </div>
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Usage</div>
                    <div class="space-y-2 text-sm">
                        <div><strong>Hit Count:</strong> ${data.hit_count || 0}</div>
                        <div><strong>Recall Rate:</strong> ${formatRecallRate(data.recall_rate)}</div>
                        <div><strong>Last Used:</strong> ${data.last_used_at ? new Date(data.last_used_at).toLocaleDateString() : 'Never'}</div>
                    </div>
                </div>
            </div>

            ${data.supersedes ? `
                <div class="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-900/20 p-4">
                    <div class="text-xs uppercase tracking-wide text-blue-500 dark:text-blue-400 mb-2">Supersedes</div>
                    <div class="flex items-center gap-2">
                        <svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                        <button onclick="openDrawer('${data.supersedes}')" class="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline">Replaced memory ${data.supersedes.substring(0, 8)}…</button>
                    </div>
                </div>
            ` : ''}
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Timeline</div>
                <div class="space-y-2 text-sm">
                    <div><strong>Created:</strong> ${new Date(data.created_at).toLocaleString()}</div>
                    <div><strong>Updated:</strong> ${data.updated_at ? new Date(data.updated_at).toLocaleString() : 'N/A'}</div>
                    <div><strong>Expires:</strong> ${data.expires_at ? new Date(data.expires_at).toLocaleString() : 'Never'}</div>
                </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div class="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-900/60 border-b border-gray-200 dark:border-gray-700">
                    <div class="text-xs uppercase tracking-wide font-bold text-gray-500 dark:text-gray-400">Full Content</div>
                    <span class="text-[10px] text-gray-400 dark:text-gray-500 flex items-center gap-1">
                        <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>
                        Markdown
                    </span>
                </div>
                <div class="p-4 md:p-5 markdown-body">${renderMarkdown(data.content)}</div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div class="flex items-center justify-between mb-3">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">Quick Edit</div>
                    ${isEditing
                        ? '<button onclick="cancelDrawerEdit()" class="text-xs px-3 py-1.5 rounded bg-gray-200 dark:bg-gray-700">Cancel</button>'
                        : `<button onclick="startDrawerEdit('${data.id}')" class="text-xs px-3 py-1.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">Edit</button>`}
                </div>
                ${isEditing ? renderDrawerEditForm(data) : `<p class="text-sm text-gray-500 dark:text-gray-400">Edit title, content, and priority from this panel without leaving the current table context.</p>`}
            </div>
        </div>
    `;
}

function renderDrawerEditForm(data) {
    return `
        <div class="space-y-3">
            <input id="drawer-edit-title" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700" value="${escapeHtml(data.title || '')}" placeholder="Memory title">
            <textarea id="drawer-edit-content" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700" rows="6">${escapeHtml(data.content)}</textarea>
            <div class="flex items-center gap-3">
                <label class="text-sm text-gray-600 dark:text-gray-400">Priority</label>
                <input type="number" id="drawer-edit-importance" value="${data.importance}" min="1" max="5" class="w-20 p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700">
            </div>
            <div class="flex gap-2">
                <button onclick="saveDrawerEdit('${data.id}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm">Save</button>
                <button onclick="cancelDrawerEdit()" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 rounded text-sm">Cancel</button>
            </div>
        </div>
    `;
}

async function openDrawer(id) {
    try {
        currentDrawerMemoryId = id;
        document.getElementById('drawerTitle').textContent = 'Loading...';
        document.getElementById('drawerBody').innerHTML = `
            <div class="space-y-4">
                <div class="skeleton h-20 w-full"></div>
                <div class="grid gap-4 md:grid-cols-2">
                    <div class="skeleton h-36 w-full"></div>
                    <div class="skeleton h-36 w-full"></div>
                </div>
                <div class="skeleton h-24 w-full"></div>
                <div class="skeleton h-64 w-full"></div>
            </div>
        `;
        document.getElementById('memoryDrawer').classList.remove('hidden');
        document.body.classList.add('drawer-open');
        
        // Trigger slide-in animation
        setTimeout(() => {
            const aside = document.getElementById('drawerAside');
            if (aside) {
                aside.classList.remove('translate-x-full');
                aside.classList.add('translate-x-0');
            }
        }, 10);

        const response = await fetch(`/api/memories/${id}?repo=${encodeURIComponent(currentRepo)}`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to load memory');
        document.getElementById('drawerTitle').textContent = getDisplayTitle(data);
        document.getElementById('drawerBody').innerHTML = renderDetailPanel(data);
    } catch (err) {
        closeDrawer();
        showToast('Failed to load details: ' + err.message, 'error');
    }
}

function closeDrawer() {
    const aside = document.getElementById('drawerAside');
    if (aside) {
        aside.classList.remove('translate-x-0');
        aside.classList.add('translate-x-full');
    }

    // Delay hiding the container until animation completes
    setTimeout(() => {
        document.getElementById('memoryDrawer').classList.add('hidden');
        if (!document.getElementById('repoSidebarDrawer') || document.getElementById('repoSidebarDrawer').classList.contains('hidden')) {
            document.body.classList.remove('drawer-open');
        }
    }, 500);

    activeEditMemoryId = null;
    currentDrawerMemoryId = null;
}

function startDrawerEdit(id) {
    activeEditMemoryId = id;
    openDrawer(id);
}

function cancelDrawerEdit() {
    const id = currentDrawerMemoryId;
    activeEditMemoryId = null;
    if (id) {
        openDrawer(id);
    } else {
        closeDrawer();
    }
}

async function saveDrawerEdit(id) {
    const title = document.getElementById('drawer-edit-title').value.trim();
    const content = document.getElementById('drawer-edit-content').value;
    const importance = parseInt(document.getElementById('drawer-edit-importance').value, 10);

    try {
        const response = await fetch(`/api/memories/${id}?repo=${encodeURIComponent(currentRepo)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, importance })
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || 'Failed to update');
        }

        showToast('Memory updated successfully', 'success');
        activeEditMemoryId = null;
        await Promise.all([loadMemories(), loadStats(), loadRecentActions()]);
        await openDrawer(id);
    } catch (err) {
        showToast('Failed to update: ' + err.message, 'error');
    }
}

async function startInlineEdit(id) {
    activeEditMemoryId = id;
    await openDrawer(id);
}

async function saveInlineEdit(id) {
    await saveDrawerEdit(id);
}

function cancelInlineEdit(id) {
    cancelDrawerEdit();
}

async function bulkUpdateImportance() {
    const importance = parseInt(document.getElementById('bulkImportanceSelect').value);
    const ids = Array.from(selectedIds);

    try {
        await Promise.all(ids.map(id => 
            fetch(`/api/memories/${id}?repo=${encodeURIComponent(currentRepo)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ importance })
            })
        ));
        
        showToast(`Updated ${ids.length} memories`, 'success');
        clearSelection();
        loadData();
    } catch (err) {
        showToast('Bulk update failed: ' + err.message, 'error');
    }
}

async function showBulkDeleteConfirm() {
    if (!confirm(`Delete ${selectedIds.size} selected memories? This cannot be undone.`)) return;
    
    const ids = Array.from(selectedIds);
    try {
        await Promise.all(ids.map(id => 
            fetch(`/api/memories/${id}?repo=${encodeURIComponent(currentRepo)}`, { method: 'DELETE' })
        ));
        
        showToast(`Deleted ${ids.length} memories`, 'success');
        clearSelection();
        loadData();
    } catch (err) {
        showToast('Bulk delete failed: ' + err.message, 'error');
    }
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-blue-600' };
    toast.className = `${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg max-w-xs`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function exportData(format) {
    const data = currentMemories.map(m => ({
        id: m.id,
        type: m.type,
        content: m.content,
        importance: m.importance,
        hit_count: m.hit_count,
        created_at: m.created_at
    }));

    let content, filename, type;
    if (format === 'json') {
        content = JSON.stringify(data, null, 2);
        filename = 'memories.json';
        type = 'application/json';
    } else {
        const headers = ['id', 'type', 'content', 'importance', 'hit_count', 'created_at'];
        content = [headers.join(','), ...data.map(m => headers.map(h => `"${(m[h] || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
        filename = 'memories.csv';
        type = 'text/csv';
    }

    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported as ${format.toUpperCase()}`, 'success');
}

async function archiveExpired() {
    try {
        const response = await fetch('/api/archive-expired', { method: 'POST' });
        const data = await response.json();
        showToast(`Archived ${data.archived || 0} expired memories`, 'success');
        loadData();
    } catch (err) {
        showToast('Archive failed: ' + err.message, 'error');
    }
}

function exportHandbook() {
    if (!currentRepo) {
        showToast('Please select a repository first', 'info');
        return;
    }
    window.location.href = `/api/export/handbook/${encodeURIComponent(currentRepo)}`;
}

async function loadData() {
    await loadRepos();
    await Promise.all([
        loadStats(),
        loadMemories(),
        loadTasks(),
        checkStatus(),
        loadRecentActions(),
    ]);
}

let currentTasks = [];

async function loadTasks() {
    if (!currentRepo) return;
    try {
        const response = await fetch(`/api/tasks?repo=${encodeURIComponent(currentRepo)}`);
        const data = await response.json();
        currentTasks = data.tasks || [];
        renderTasks();
    } catch (err) {
        console.error('Failed to load tasks:', err);
    }
}

function renderTasks() {
    if (!document.getElementById('todoTasks')) return;
    
    const todoTasks = currentTasks
        .filter(t => t.status === 'pending' || t.status === 'blocked')
        .sort((a, b) => (b.priority - a.priority) || new Date(a.created_at) - new Date(b.created_at));
        
    const inProgressTasks = currentTasks
        .filter(t => t.status === 'in_progress')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
    const completedTasks = currentTasks
        .filter(t => t.status === 'completed')
        .sort((a, b) => new Date(b.finished_at || b.updated_at) - new Date(a.finished_at || a.updated_at));

    document.getElementById('todoCount').textContent = todoTasks.length;
    document.getElementById('inProgressCount').textContent = inProgressTasks.length;
    document.getElementById('completedCount').textContent = completedTasks.length;

    renderTaskColumn('todoTasks', todoTasks);
    renderTaskColumn('inProgressTasks', inProgressTasks);
    renderTaskColumn('completedTasks', completedTasks);
}

function renderTaskColumn(id, tasks) {
    const container = document.getElementById(id);
    if (!container) return;
    
    if (!tasks || tasks.length === 0) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400 text-xs italic bg-gray-50/50 dark:bg-gray-900/20 rounded-xl border border-dashed border-gray-200 dark:border-gray-700">No tasks</div>';
        return;
    }

    container.innerHTML = tasks.map(t => `
        <div class="bg-white dark:bg-gray-700 p-4 rounded-xl shadow-sm border border-gray-100 dark:border-gray-600 hover:shadow-md transition-all group">
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-2">
                    <span class="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-[10px] font-bold text-gray-600 dark:text-gray-400 font-mono border border-gray-200 dark:border-gray-700">${t.task_code}</span>
                    <span class="text-[10px] font-bold uppercase tracking-wider text-gray-400">${t.phase}</span>
                </div>
                <div class="flex items-center gap-1">
                    ${t.priority >= 4 ? '<span class="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span>' : ''}
                    <span class="text-[10px] font-bold ${getPriorityColor(t.priority)}">P${t.priority}</span>
                </div>
            </div>
            <h4 class="font-bold text-sm text-gray-900 dark:text-gray-100 mb-1">${escapeHtml(t.title)}</h4>
            <p class="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">${escapeHtml(t.description || '')}</p>
            
            <div class="flex items-center gap-2 mb-3">
                <div class="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-900/30 border border-sky-100 dark:border-sky-800 flex items-center gap-1">
                    <span class="text-[9px] font-bold text-sky-600 dark:text-sky-400">${escapeHtml(t.agent || 'unknown')}</span>
                    <span class="text-[8px] text-sky-400 dark:text-sky-600">|</span>
                    <span class="text-[9px] font-medium text-sky-500 dark:text-sky-500">${escapeHtml(t.role || 'unknown')}</span>
                </div>
            </div>

            ${t.depends_on ? `
                <div class="mt-2 pt-2 border-t border-gray-50 dark:border-gray-600 flex items-center gap-1.5">
                    <svg class="w-3 h-3 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6"></path></svg>
                    <span class="text-[10px] font-medium text-amber-600 dark:text-amber-400">Depends on: ${t.depends_on.substring(0, 8)}</span>
                </div>
            ` : ''}
            <div class="mt-3 flex items-center justify-between">
                <span class="text-[10px] font-mono text-gray-400">${t.id.substring(0, 8)}</span>
                <span class="text-[10px] text-gray-400">${t.status === 'completed' && t.finished_at ? 'Done ' + formatDate(t.finished_at) : formatDate(t.created_at)}</span>
            </div>
        </div>
    `).join('');
}

function getPriorityColor(p) {
    if (p >= 5) return 'text-red-600 dark:text-red-400';
    if (p >= 4) return 'text-orange-600 dark:text-orange-400';
    if (p >= 3) return 'text-amber-600 dark:text-amber-400';
    return 'text-gray-500 dark:text-gray-400';
}

let currentTab = localStorage.getItem('activeTab') || 'dashboard';

function switchTab(tab) {
    const dashTab = document.getElementById('dashboardTabBtn');
    const memTab = document.getElementById('memoriesTabBtn');
    const taskTab = document.getElementById('tasksTabBtn');
    const refTab = document.getElementById('referenceTabBtn');
    const indicator = document.getElementById('tabIndicator');

    const dashContent = document.getElementById('dashboardContent');
    const memContent = document.getElementById('memoriesContent');
    const taskContent = document.getElementById('tasksContent');
    const refContent = document.getElementById('referenceContent');

    currentTab = tab;
    localStorage.setItem('activeTab', tab);

    const tabs = [dashTab, memTab, taskTab, refTab];
    const contents = [dashContent, memContent, taskContent, refContent];    const targetId = tab + 'TabBtn';
    const targetContentId = tab + 'Content';

    // Update indicator
    if (indicator) {
        if (tab === 'dashboard') indicator.style.transform = 'translateX(0)';
        if (tab === 'memories') indicator.style.transform = 'translateX(100%)';
        if (tab === 'tasks') indicator.style.transform = 'translateX(200%)';
        if (tab === 'reference') indicator.style.transform = 'translateX(300%)';
    }

    // Update button states
    tabs.forEach(t => {
        if (t) {
            if (t.id === targetId) {
                t.classList.add('text-white');
                t.classList.remove('text-gray-500', 'dark:text-gray-400');
            } else {
                t.classList.remove('text-white');
                t.classList.add('text-gray-500', 'dark:text-gray-400');
            }
        }
    });

    // Update content visibility
    contents.forEach(c => {
        if (c) {
            if (c.id === targetContentId) {
                c.classList.remove('hidden');
            } else {
                c.classList.add('hidden');
            }
        }
    });

    // Trigger data loads if needed
    if (tab === 'tasks') loadTasks();
    if (tab === 'dashboard') loadStats();
    if (tab === 'memories') loadMemories();
    if (tab === 'reference') loadCapabilities();
    syncStickyOffsets();
}

window.loadTasks = loadTasks;
window.switchTab = switchTab;
window.charts = charts;

const safeAddEventListener = (id, event, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, handler);
};

safeAddEventListener('repoSearchInput', 'input', () => {
    renderRepoSidebar();
});

safeAddEventListener('repoSearchInput', 'keydown', (e) => {
    if (e.key === 'Enter') {
        const firstMatch = availableRepos.find((item) => item.repo.toLowerCase().includes(e.target.value.trim().toLowerCase()));
        if (firstMatch) {
            setCurrentRepo(firstMatch.repo);
        }
    }
});

safeAddEventListener('repoSearchInputMobile', 'input', () => {
    renderRepoSidebar();
});

safeAddEventListener('repoSearchInputMobile', 'keydown', (e) => {
    if (e.key === 'Enter') {
        const firstMatch = availableRepos.find((item) => item.repo.toLowerCase().includes(e.target.value.trim().toLowerCase()));
        if (firstMatch) {
            setCurrentRepo(firstMatch.repo);
        }
    }
});

safeAddEventListener('repoNavToggle', 'click', () => {
    openRepoSidebarDrawer();
});

safeAddEventListener('repoSidebarCollapseToggle', 'click', () => {
    toggleRepoSidebarCollapse();
});

safeAddEventListener('repoCollapsedSummaryButton', 'click', () => {
    if (isRepoSidebarCollapsed) {
        toggleRepoSidebarCollapse();
    }
});

window.addEventListener('resize', syncStickyOffsets);

let currentCapabilities = { tools: [], resources: [], prompts: [] };

async function loadCapabilities() {
    const toolsList = document.getElementById('toolsList');
    const resourcesList = document.getElementById('resourcesList');
    const promptsList = document.getElementById('promptsList');
    
    if (!toolsList) return;
    
    toolsList.innerHTML = '<div class="text-center py-4 text-gray-400 text-xs">Loading capabilities...</div>';
    
    try {
        const response = await fetch('/api/capabilities');
        const data = await response.json();
        
        currentCapabilities.tools = Array.isArray(data.tools) ? data.tools : [];
        currentCapabilities.resources = Array.isArray(data.resources) ? data.resources : [];
        currentCapabilities.prompts = Array.isArray(data.prompts) ? data.prompts : [];

        toolsList.innerHTML = currentCapabilities.tools.map(t => `
            <div onclick="showCapabilityDetail('tools', '${t.name}')" class="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-lg cursor-pointer hover:border-sky-500/50 transition-all group">
                <div class="font-bold text-xs text-sky-600 dark:text-sky-400 mb-1 group-hover:text-sky-500">${escapeHtml(t.name)}</div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(t.description)}</p>
            </div>
        `).join('') || '<div class="text-center py-4 text-gray-400 text-xs">No tools available</div>';
        
        resourcesList.innerHTML = currentCapabilities.resources.map(r => `
            <div onclick="showCapabilityDetail('resources', '${r.name}')" class="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-lg cursor-pointer hover:border-indigo-500/50 transition-all group">
                <div class="font-bold text-xs text-indigo-600 dark:text-indigo-400 mb-1 group-hover:text-indigo-500">${escapeHtml(r.name)}</div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(r.description || 'No description')}</p>
                <div class="text-[8px] font-mono text-gray-400 mt-1 truncate">${escapeHtml(r.uri)}</div>
            </div>
        `).join('') || '<div class="text-center py-4 text-gray-400 text-xs">No resources available</div>';
        
        promptsList.innerHTML = currentCapabilities.prompts.map(p => `
            <div onclick="showCapabilityDetail('prompts', '${p.name}')" class="p-3 bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-lg cursor-pointer hover:border-emerald-500/50 transition-all group">
                <div class="font-bold text-xs text-emerald-600 dark:text-emerald-400 mb-1 group-hover:text-emerald-500">${escapeHtml(p.name)}</div>
                <p class="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-2">${escapeHtml(p.description || 'No description')}</p>
            </div>
        `).join('') || '<div class="text-center py-4 text-gray-400 text-xs">No prompts available</div>';
        
    } catch (err) {
        console.error('Failed to load capabilities:', err);
        toolsList.innerHTML = `<div class="text-center py-4 text-red-400 text-xs">Error: ${err.message}</div>`;
    }
}

async function handleCsvImport(event) {
    const file = event.target.files[0];
    if (!file || !currentRepo) return;
    
    const reader = new FileReader();
    reader.onload = async (e) => {
        const csvData = e.target.result;
        try {
            const response = await fetch('/api/tasks/import-csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ repo: currentRepo, csvData })
            });
            const result = await response.json();
            if (result.success) {
                showToast(`Successfully imported ${result.count} tasks`, 'success');
                loadTasks();
                loadStats();
            } else {
                showToast(result.error || 'Failed to import CSV', 'error');
            }
        } catch (err) {
            showToast('Import failed: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = ''; 
}

function downloadCsvTemplate() {
    const headers = "task_code,phase,title,description,priority,status,agent,role";
    const example = "TASK-001,research,Integrate CSV,Add import feature to dashboard,4,pending,Gemini CLI,expert";
    const csv = `${headers}\n${example}`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'task_template.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function showCapabilityDetail(type, name) {
    const item = currentCapabilities[type].find(i => i.name === name);
    if (!item) return;

    const drawer = document.getElementById('memoryDrawer');
    const title = document.getElementById('drawerTitle');
    const body = document.getElementById('drawerBody');

    title.textContent = `${type.charAt(0).toUpperCase() + type.slice(1)}: ${name}`;
    
    let contentHtml = `
        <div class="space-y-6">
            <div class="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Description</h4>
                <p class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(item.description || 'No description')}</p>
            </div>
    `;

    if (type === 'tools' && item.inputSchema) {
        contentHtml += `
            <div class="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Input Schema</h4>
                <pre class="text-[10px] font-mono text-sky-600 dark:text-sky-400 overflow-x-auto">${JSON.stringify(item.inputSchema, null, 2)}</pre>
            </div>
        `;
    }

    if (type === 'resources' && item.uri) {
        contentHtml += `
            <div class="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">URI</h4>
                <code class="text-xs font-mono text-indigo-600 dark:text-indigo-400">${escapeHtml(item.uri)}</code>
            </div>
        `;
    }

    if (type === 'prompts' && item.arguments) {
        contentHtml += `
            <div class="p-4 bg-slate-50 dark:bg-slate-900/50 rounded-xl border border-slate-100 dark:border-slate-800">
                <h4 class="text-xs font-bold text-slate-400 uppercase mb-2">Arguments</h4>
                <div class="space-y-3">
                    ${item.arguments.map(arg => `
                        <div class="border-l-2 border-emerald-500 pl-3 py-1">
                            <div class="text-xs font-bold text-emerald-600 dark:text-emerald-400">${escapeHtml(arg.name)} ${arg.required ? '<span class="text-[8px] bg-emerald-500 text-white px-1 rounded">REQUIRED</span>' : ''}</div>
                            <div class="text-[10px] text-gray-500 dark:text-gray-400">${escapeHtml(arg.description || '')}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    contentHtml += `</div>`;
    body.innerHTML = contentHtml;
    
    drawer.classList.remove('hidden');
    document.body.classList.add('drawer-open');
    setTimeout(() => document.getElementById('drawerAside').classList.remove('translate-x-full'), 10);
}

window.handleCsvImport = handleCsvImport;
window.downloadCsvTemplate = downloadCsvTemplate;
window.loadCapabilities = loadCapabilities;
window.showCapabilityDetail = showCapabilityDetail;

initTheme();
initRepoSidebarState();
initPinnedRepos();
renderRecentActions();
loadData();
switchTab(currentTab);
syncStickyOffsets();
startCountdown();
setInterval(checkStatus, 30000);
