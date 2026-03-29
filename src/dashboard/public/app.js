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
let activeEditMemoryId = null;
let currentDrawerMemoryId = null;
let availableRepos = [];
let isRepoSidebarCollapsed = false;
let pinnedRepoOrder = [];
let draggedPinnedRepo = null;

async function loadRecentActions() {
    try {
        const url = currentRepo 
            ? `/api/recent-actions?repo=${encodeURIComponent(currentRepo)}&limit=50`
            : '/api/recent-actions?limit=50';
        const response = await fetch(url);
        const data = await response.json();
        recentActions = data.actions || [];
        renderRecentActions();
    } catch (err) {
        console.error('Failed to load recent actions:', err);
    }
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

function renderRecentActions() {
    const container = document.getElementById('recentQueries');
    if (recentActions.length === 0) {
        container.innerHTML = '<div class="text-gray-500 text-sm">No recent actions</div>';
        return;
    }
    container.innerHTML = recentActions.map((action) => `
        <div class="recent-action-item flex items-start gap-3 p-3 rounded-xl transition-colors">
            <div class="w-8 h-8 rounded-full ${getActionColor(action.action)} flex items-center justify-center flex-shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    ${getActionIcon(action.action)}
                </svg>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <p class="text-sm font-medium text-gray-800 dark:text-gray-200 capitalize">${action.action}</p>
                    ${action.burstCount > 1 ? `<span class="px-2 py-0.5 rounded-full bg-gray-200 dark:bg-gray-600 text-xs font-semibold text-gray-700 dark:text-gray-200">×${action.burstCount}</span>` : ''}
                </div>
                <p class="text-xs text-gray-500 truncate">${action.query || (action.memory_id ? 'Memory: ' + action.memory_id.substring(0, 8) : '-')}</p>
                <p class="text-xs text-gray-400">${formatActionDate(action.created_at)}</p>
            </div>
        </div>
    `).join('');
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
}

async function setCurrentRepo(repo) {
    if (!repo || repo === currentRepo) return;
    currentRepo = repo;
    currentPage = 1;
    selectedIds.clear();
    localStorage.setItem('selectedRepo', currentRepo);
    renderRepoSidebar();
    closeRepoSidebarDrawer();
    await Promise.all([
        loadStats(),
        loadMemories(),
        loadRecentActions(),
    ]);
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
    document.getElementById('themeToggle').textContent = saved === 'dark' ? '☀️' : '🌙';
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

document.getElementById('themeToggle').addEventListener('click', () => {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    document.getElementById('themeToggle').textContent = isDark ? '☀️' : '🌙';
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
            dbPathLabel.textContent = data.dbPath;
            dbPathLabel.title = data.dbPath;
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
        const data = await response.json();

        document.getElementById('totalCount').textContent = data.total;
        document.getElementById('avgImportance').textContent = data.avgImportance || '0';
        document.getElementById('totalHits').textContent = data.totalHitCount || '0';
        document.getElementById('expiringSoon').textContent = data.expiringSoon || '0';
        document.getElementById('codeFactCount').textContent = data.byType?.code_fact || 0;
        document.getElementById('decisionCount').textContent = data.byType?.decision || 0;
        document.getElementById('mistakeCount').textContent = data.byType?.mistake || 0;
        document.getElementById('patternCount').textContent = data.byType?.pattern || 0;

        updateTypeChart(data.byType);
        updateTimeSeriesChart(data.timeSeries || {});
        updateScatterChart(data.scatterData || []);
        updateTopMemoriesChart(data.topMemories);
    } catch (err) {
        console.error('Failed to load stats:', err);
    }
}

function updateTypeChart(byType) {
    const ctx = document.getElementById('typeChart');
    if (!window.Chart) {
        ctx.parentElement.innerHTML = '<div class="p-8 text-center text-gray-500">Chart.js not available</div>';
        return;
    }
    if (charts.typeChart) charts.typeChart.destroy();

    const types = Object.keys(byType || {});
    const counts = Object.values(byType || {});

    charts.typeChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: types.map(t => t.replace('_', ' ')),
            datasets: [{
                data: counts,
                backgroundColor: ['#38bdf8', '#fb7185', '#a78bfa', '#34d399'],
                borderColor: 'rgba(255,255,255,0.72)',
                borderWidth: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: true }
    });
}

function updateTopMemoriesChart(memories = []) {
    const ctx = document.getElementById('topMemoriesChart');
    if (!window.Chart) {
        ctx.parentElement.innerHTML = '<div class="p-8 text-center text-gray-500">Chart.js not available</div>';
        return;
    }
    if (charts.topMemoriesChart) charts.topMemoriesChart.destroy();

    charts.topMemoriesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: memories.map((m, i) => `#${i + 1}`),
            datasets: [{
                label: 'Hit Count',
                data: memories.map(m => m.hit_count || m.importance),
                backgroundColor: ['#38bdf8', '#60a5fa', '#22d3ee', '#7dd3fc', '#93c5fd', '#67e8f9', '#38bdf8', '#60a5fa', '#22d3ee', '#7dd3fc'],
                borderRadius: 10
            }]
        },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { beginAtZero: true } } }
    });
}

function updateTimeSeriesChart(timeSeries) {
    const ctx = document.getElementById('timeSeriesChart');
    if (!window.Chart) return;
    if (charts.timeSeriesChart) charts.timeSeriesChart.destroy();

    const labels = Object.keys(timeSeries).slice(-14);
    const data = Object.values(timeSeries).slice(-14);

    charts.timeSeriesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Memories Created',
                data,
                borderColor: '#22d3ee',
                backgroundColor: 'rgba(34, 211, 238, 0.16)',
                pointBackgroundColor: '#7dd3fc',
                pointBorderColor: '#e0f2fe',
                fill: true,
                tension: 0.35
            }]
        },
        options: { responsive: true, maintainAspectRatio: true, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
}

function updateScatterChart(scatterData) {
    const ctx = document.getElementById('scatterChart');
    if (!window.Chart) return;
    if (charts.scatterChart) charts.scatterChart.destroy();

    charts.scatterChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Memories',
                data: scatterData,
                backgroundColor: 'rgba(96, 165, 250, 0.85)',
                borderColor: '#a78bfa',
                pointRadius: 4.5,
                pointHoverRadius: 6
            }]
        },
        options: { responsive: true, maintainAspectRatio: true, scales: { x: { title: { display: true, text: 'Importance' }, min: 0, max: 6 }, y: { title: { display: true, text: 'Hit Count' }, beginAtZero: true } } }
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
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('type')" data-sort="type">Type <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('importance')" data-sort="importance">Priority <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('hit_count')" data-sort="hit_count">Usage <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold cursor-pointer" onclick="sortTable('created_at')" data-sort="created_at">Freshness <span class="sort-icon"></span></th>
                    <th class="text-left p-3 bg-gray-50 dark:bg-gray-700 font-semibold">Actions</th>
                </tr>
            </thead>
            <tbody>
                ${paginated.map(m => `
                    <tr id="row-${m.id}" class="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                        <td class="p-3"><input type="checkbox" class="row-checkbox" value="${m.id}" ${selectedIds.has(m.id) ? 'checked' : ''} onchange="toggleSelect('${m.id}')"></td>
                        <td class="p-3 min-w-[18rem]">
                            <button onclick="openDrawer('${m.id}')" class="text-left font-semibold text-gray-900 dark:text-gray-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">${highlightText(getDisplayTitle(m), searchQuery)}</button>
                            <div class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                <span class="font-mono">${m.id.substring(0, 8)}</span>
                                <span class="mx-1">•</span>
                                <span>${m.scope?.repo || 'Unknown repo'}</span>
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
                            <div class="flex flex-wrap gap-2">
                                <button onclick="openDrawer('${m.id}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium">Open</button>
                                <button onclick="startInlineEdit('${m.id}')" class="px-3 py-1.5 bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 rounded hover:bg-amber-200 dark:hover:bg-amber-900/60 text-xs font-medium">Edit</button>
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
    if (importance >= 5) return 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-200';
    if (importance >= 4) return 'bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-200';
    if (importance >= 3) return 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-200';
    if (importance >= 2) return 'bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-200';
    return 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200';
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
            <div class="grid gap-4 md:grid-cols-2">
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Memory Info</div>
                    <div class="space-y-2 text-sm">
                        <div><strong>Type:</strong> ${formatTypeLabel(data.type)}</div>
                        <div><strong>ID:</strong> <span class="font-mono">${data.id}</span></div>
                        <div><strong>Repo:</strong> ${escapeHtml(data.scope?.repo || 'N/A')}</div>
                        <div><strong>Priority:</strong> ${data.importance}/5 (${getImportanceLabel(data.importance)})</div>
                    </div>
                </div>
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                    <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Usage</div>
                    <div class="space-y-2 text-sm">
                        <div><strong>Hit Count:</strong> ${data.hit_count || 0}</div>
                        <div><strong>Recall Count:</strong> ${data.recall_count || 0}</div>
                        <div><strong>Recall Rate:</strong> ${formatRecallRate(data.recall_rate)}</div>
                        <div><strong>Last Used:</strong> ${data.last_used_at ? new Date(data.last_used_at).toLocaleString() : 'Never'}</div>
                    </div>
                </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Timeline</div>
                <div class="space-y-2 text-sm">
                    <div><strong>Created:</strong> ${new Date(data.created_at).toLocaleString()}</div>
                    <div><strong>Updated:</strong> ${data.updated_at ? new Date(data.updated_at).toLocaleString() : 'N/A'}</div>
                    <div><strong>Expires:</strong> ${data.expires_at ? new Date(data.expires_at).toLocaleString() : 'Never'}</div>
                </div>
            </div>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <div class="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-3">Full Content</div>
                <pre class="whitespace-pre-wrap text-sm leading-6">${escapeHtml(data.content)}</pre>
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
    document.getElementById('memoryDrawer').classList.add('hidden');
    if (!document.getElementById('repoSidebarDrawer') || document.getElementById('repoSidebarDrawer').classList.contains('hidden')) {
        document.body.classList.remove('drawer-open');
    }
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

async function loadData() {
    await loadRepos();
    await Promise.all([
        loadStats(),
        loadMemories(),
        checkStatus(),
        loadRecentActions(),
    ]);
}

document.getElementById('repoSearchInput').addEventListener('input', () => {
    renderRepoSidebar();
});

window.setCurrentRepo = setCurrentRepo;
window.closeRepoSidebarDrawer = closeRepoSidebarDrawer;
window.togglePinnedRepo = togglePinnedRepo;
window.startPinnedRepoDrag = startPinnedRepoDrag;
window.overPinnedRepoDrag = overPinnedRepoDrag;
window.leavePinnedRepoDrag = leavePinnedRepoDrag;
window.dropPinnedRepo = dropPinnedRepo;
window.endPinnedRepoDrag = endPinnedRepoDrag;

document.getElementById('repoSearchInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const firstMatch = availableRepos.find((item) => item.repo.toLowerCase().includes(e.target.value.trim().toLowerCase()));
        if (firstMatch) {
            setCurrentRepo(firstMatch.repo);
        }
    }
});

document.getElementById('repoSearchInputMobile').addEventListener('input', () => {
    renderRepoSidebar();
});

document.getElementById('repoSearchInputMobile').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const firstMatch = availableRepos.find((item) => item.repo.toLowerCase().includes(e.target.value.trim().toLowerCase()));
        if (firstMatch) {
            setCurrentRepo(firstMatch.repo);
        }
    }
});

document.getElementById('repoNavToggle').addEventListener('click', () => {
    openRepoSidebarDrawer();
});

document.getElementById('repoSidebarCollapseToggle').addEventListener('click', () => {
    toggleRepoSidebarCollapse();
});

document.getElementById('repoCollapsedSummaryButton').addEventListener('click', () => {
    if (isRepoSidebarCollapsed) {
        toggleRepoSidebarCollapse();
    }
});

initTheme();
initRepoSidebarState();
initPinnedRepos();
renderRecentActions();
loadData();
startCountdown();
setInterval(checkStatus, 30000);
