/**
 * TabClub — Popup Script
 * 
 * Renders club cards, handles interactions, communicates with the background service worker.
 */

// ─── DOM References ────────────────────────────────────────────────────────────

const $clubsList = document.getElementById('clubs-list');
const $emptyState = document.getElementById('empty-state');
const $headerSubtitle = document.getElementById('header-subtitle');
const $statTotal = document.getElementById('stat-total');
const $statActive = document.getElementById('stat-active');
const $statDiscarded = document.getElementById('stat-discarded');
const $statSaved = document.getElementById('stat-saved');
const $btnDiscardAll = document.getElementById('btn-discard-all');
const $btnSettings = document.getElementById('btn-settings');
const $memoryUsageValue = document.getElementById('memory-usage-value');
const $memoryBarFill = document.getElementById('memory-bar-fill');
const $memoryBarSaved = document.getElementById('memory-bar-saved');
const $savedSection = document.getElementById('saved-section');
const $savedHeader = document.getElementById('saved-header');
const $savedCount = document.getElementById('saved-count');
const $savedList = document.getElementById('saved-list');

// ─── SVG Icons ─────────────────────────────────────────────────────────────────

const CHEVRON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" class="club-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;

const SLEEP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

const CLOSE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

const SAVE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;

// ─── State ─────────────────────────────────────────────────────────────────────

let expandedClubs = new Set();
let savedExpanded = false;
let toastTimeout = null;
let currentSavedGroups = [];

// ─── Initialize ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await applyStoredTheme();
  await loadData();
  bindGlobalEvents();
});

// ─── Theme ─────────────────────────────────────────────────────────────────────

async function applyStoredTheme() {
  try {
    const stored = await chrome.storage.local.get('theme');
    let theme = stored.theme || 'system';
    
    if (theme === 'system') {
      theme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // Default to dark
  }
}

// ─── Data Loading ──────────────────────────────────────────────────────────────

async function loadData() {
  try {
    const [clubsResponse, statsResponse, savedGroupsResponse] = await Promise.all([
      chrome.runtime.sendMessage({ type: 'getClubs' }),
      chrome.runtime.sendMessage({ type: 'getMemoryStats' }),
      chrome.runtime.sendMessage({ type: 'getSavedClubs' })
    ]);
    
    currentSavedGroups = savedGroupsResponse?.savedGroups || [];
    renderSavedGroups(currentSavedGroups);
    
    renderMemoryStats(statsResponse);
    renderClubs(clubsResponse.clubs || []);
  } catch (e) {
    console.error('[TabClub Popup] Failed to load data:', e);
    $headerSubtitle.textContent = 'Error loading clubs';
  }
}

// ─── Render Memory Stats ───────────────────────────────────────────────────────

function renderMemoryStats(stats) {
  if (!stats || stats.error) return;
  
  $statTotal.textContent = stats.total;
  $statActive.textContent = stats.active;
  $statDiscarded.textContent = stats.discarded;
  $statSaved.textContent = formatMB(stats.estimatedSavingsMB);
  
  $headerSubtitle.textContent = `${stats.total} tabs • ${stats.discarded} sleeping • ${stats.timeoutMin}m timeout`;
  
  // ── Chrome Memory Usage Bar ──
  const BASE_BROWSER_MB = 300;
  const MB_PER_ACTIVE = 80;
  const MB_PER_DISCARDED = 2;
  
  const currentUsageMB = BASE_BROWSER_MB + (stats.active * MB_PER_ACTIVE) + (stats.discarded * MB_PER_DISCARDED);
  const savedMB = stats.estimatedSavingsMB;
  const wouldBeUsageMB = currentUsageMB + savedMB;
  
  $memoryUsageValue.textContent = formatMB(currentUsageMB);
  
  const maxMB = Math.max(wouldBeUsageMB, currentUsageMB, 500);
  const activePct = Math.min((currentUsageMB / maxMB) * 100, 100);
  const savedPct = Math.min((savedMB / maxMB) * 100, 100 - activePct);
  
  $memoryBarFill.style.width = `${activePct}%`;
  $memoryBarSaved.style.width = `${savedPct}%`;
}

function formatMB(mb) {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

// ─── Render Clubs ──────────────────────────────────────────────────────────────

function renderClubs(clubs) {
  $clubsList.textContent = '';
  
  if (clubs.length === 0) {
    $emptyState.style.display = 'flex';
    $headerSubtitle.textContent = 'No clubs yet';
    return;
  }
  
  $emptyState.style.display = 'none';
  $headerSubtitle.textContent = `${clubs.length} club${clubs.length !== 1 ? 's' : ''} active`;
  
  for (const club of clubs) {
    const card = createClubCard(club);
    $clubsList.appendChild(card);
  }
}

function createClubCard(club) {
  const card = document.createElement('div');
  card.className = 'club-card';
  card.dataset.color = club.color;
  card.dataset.groupId = club.groupId;
  
  if (expandedClubs.has(club.groupId)) {
    card.classList.add('expanded');
  }
  
  // ─── Header ───
  const header = document.createElement('div');
  header.className = 'club-header';
  
  // Favicon
  let faviconEl;
  if (club.favicon) {
    faviconEl = document.createElement('img');
    faviconEl.className = 'club-favicon';
    faviconEl.src = club.favicon;
    faviconEl.alt = '';
    faviconEl.onerror = function() {
      this.replaceWith(createFaviconPlaceholder(club));
    };
  } else {
    faviconEl = createFaviconPlaceholder(club);
  }
  
  // Info
  const info = document.createElement('div');
  info.className = 'club-info';
  
  const titleDiv = document.createElement('div');
  titleDiv.className = 'club-title';
  titleDiv.textContent = club.title;
  
  const domainDiv = document.createElement('div');
  domainDiv.className = 'club-domain';
  domainDiv.textContent = club.domain || '';
  
  info.appendChild(titleDiv);
  info.appendChild(domainDiv);
  
  // Meta
  const meta = document.createElement('div');
  meta.className = 'club-meta';
  
  // Tab count badge
  const badge = document.createElement('span');
  badge.className = 'club-badge';
  badge.dataset.color = club.color;
  badge.textContent = `${club.tabCount} tab${club.tabCount !== 1 ? 's' : ''}`;
  
  // Save button
  const saveBtn = document.createElement('button');
  saveBtn.className = 'club-save-btn';
  saveBtn.title = 'Save group';
  saveBtn.appendChild(createSvgNode(SAVE_SVG));
  
  const isSaved = currentSavedGroups.some(g => (club.domain && g.domain === club.domain) || (!club.domain && g.title === club.title));
  if (isSaved) {
    saveBtn.style.color = 'var(--color-green)';
  }

  saveBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await chrome.runtime.sendMessage({ type: 'saveClub', groupId: club.groupId });
    if (result.success) {
      showToast(`💾 ${result.savedCount} tab${result.savedCount !== 1 ? 's' : ''} saved`);
      await loadData();
    }
  });
  
  // Discard button for this club
  const discardBtn = document.createElement('button');
  discardBtn.className = 'club-discard-btn';
  discardBtn.title = 'Free memory for this club';
  discardBtn.appendChild(createSvgNode(SLEEP_SVG));
  
  const activeCount = club.tabs.filter(t => !t.discarded).length;
  if (activeCount > 0) {
    const intensity = Math.min(1, 0.4 + (activeCount * 0.15));
    discardBtn.style.color = `rgba(var(--glow-red), ${intensity})`;
  }

  discardBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const result = await chrome.runtime.sendMessage({ type: 'discardClub', groupId: club.groupId });
    if (result.success) {
      showToast(`💤 ${result.discarded} tab${result.discarded !== 1 ? 's' : ''} put to sleep`);
      await loadData();
    }
  });
  
  // Chevron
  const chevron = document.createElement('span');
  chevron.appendChild(createSvgNode(CHEVRON_SVG));
  
  meta.appendChild(badge);
  meta.appendChild(saveBtn);
  meta.appendChild(discardBtn);
  meta.appendChild(chevron);
  
  header.appendChild(faviconEl);
  header.appendChild(info);
  header.appendChild(meta);
  
  // Click handler for expand/collapse
  header.addEventListener('click', () => {
    const isExpanded = card.classList.toggle('expanded');
    
    if (isExpanded) {
      expandedClubs.add(club.groupId);
      chrome.runtime.sendMessage({ type: 'expandClub', groupId: club.groupId });
    } else {
      expandedClubs.delete(club.groupId);
      chrome.runtime.sendMessage({ type: 'collapseClub', groupId: club.groupId });
    }
  });
  
  // ─── Tabs List ───
  const tabsContainer = document.createElement('div');
  tabsContainer.className = 'club-tabs';
  
  const tabsInner = document.createElement('div');
  tabsInner.className = 'club-tabs-inner';
  
  for (const tab of club.tabs) {
    const tabItem = createTabItem(tab, club.color);
    tabsInner.appendChild(tabItem);
  }
  
  tabsContainer.appendChild(tabsInner);
  
  card.appendChild(header);
  card.appendChild(tabsContainer);
  
  return card;
}

function createTabItem(tab, clubColor) {
  const item = document.createElement('div');
  item.className = 'tab-item';
  if (tab.active) item.classList.add('tab-active');
  if (tab.discarded) item.classList.add('tab-discarded');
  item.dataset.tabId = tab.id;
  
  // Favicon
  let favicon;
  if (tab.favIconUrl) {
    favicon = document.createElement('img');
    favicon.className = 'tab-favicon';
    favicon.src = tab.favIconUrl;
    favicon.alt = '';
    favicon.onerror = function() {
      const dot = document.createElement('div');
      dot.className = 'tab-favicon-dot';
      this.replaceWith(dot);
    };
  } else {
    favicon = document.createElement('div');
    favicon.className = 'tab-favicon-dot';
  }
  
  // Info
  const info = document.createElement('div');
  info.className = 'tab-info';
  
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title;
  
  const url = document.createElement('div');
  url.className = 'tab-url';
  try {
    const u = new URL(tab.url);
    url.textContent = u.pathname.length > 1 ? u.pathname : u.hostname;
  } catch {
    url.textContent = tab.url;
  }
  
  info.appendChild(title);
  info.appendChild(url);
  
  // Status badge
  const status = document.createElement('span');
  status.className = 'tab-status';
  if (tab.active) {
    status.className += ' tab-status-active';
    status.textContent = 'Active';
  } else if (tab.discarded) {
    status.className += ' tab-status-sleeping';
    status.textContent = 'Sleeping';
  }
  
  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'tab-close-btn';
  closeBtn.title = 'Close tab';
  closeBtn.appendChild(createSvgNode(CLOSE_SVG));
  closeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await chrome.runtime.sendMessage({ type: 'closeTab', tabId: tab.id });
    item.style.opacity = '0';
    item.style.height = '0';
    item.style.padding = '0';
    item.style.margin = '0';
    item.style.overflow = 'hidden';
    item.style.transition = 'all 200ms ease';
    setTimeout(() => {
      item.remove();
      loadData();
    }, 200);
  });
  
  // Click to activate tab
  item.addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'activateTab', tabId: tab.id });
    window.close();
  });
  
  item.appendChild(favicon);
  item.appendChild(info);
  if (tab.active || tab.discarded) item.appendChild(status);
  item.appendChild(closeBtn);
  
  return item;
}

function createFaviconPlaceholder(club) {
  const el = document.createElement('div');
  el.className = 'club-favicon-placeholder';
  el.dataset.color = club.color;
  el.textContent = (club.domain || club.title || '?')[0].toUpperCase();
  return el;
}

// ─── Saved Groups ──────────────────────────────────────────────────────────────

function renderSavedGroups(groups) {
  if (groups.length === 0) {
    $savedSection.style.display = 'none';
    return;
  }
  
  $savedSection.style.display = 'block';
  $savedCount.textContent = groups.length;
  
  $savedList.textContent = '';
  for (const group of groups) {
    $savedList.appendChild(createSavedCard(group));
  }
}

function createSavedCard(group) {
  const card = document.createElement('div');
  card.className = 'saved-card';
  
  // Favicon placeholder
  let faviconEl;
  if (group.favicon) {
    faviconEl = document.createElement('img');
    faviconEl.className = 'club-favicon';
    faviconEl.src = group.favicon;
    faviconEl.alt = '';
    faviconEl.onerror = function() {
      const placeholder = document.createElement('div');
      placeholder.className = 'club-favicon-placeholder';
      placeholder.dataset.color = group.color || 'grey';
      placeholder.textContent = (group.domain || group.title || '?')[0].toUpperCase();
      this.replaceWith(placeholder);
    };
  } else {
    faviconEl = document.createElement('div');
    faviconEl.className = 'club-favicon-placeholder';
    faviconEl.dataset.color = group.color || 'grey';
    faviconEl.textContent = (group.domain || group.title || '?')[0].toUpperCase();
  }
  
  // Info
  const info = document.createElement('div');
  info.className = 'saved-card-info';
  
  const title = document.createElement('div');
  title.className = 'saved-card-title';
  title.textContent = group.title;
  
  const meta = document.createElement('div');
  meta.className = 'saved-card-meta';
  
  const tabCount = group.tabs ? group.tabs.length : 0;
  const savedAgo = timeAgo(group.savedAt);
  
  const span1 = document.createElement('span');
  span1.textContent = `${tabCount} tab${tabCount !== 1 ? 's' : ''}`;
  const span2 = document.createElement('span');
  span2.textContent = '•';
  const span3 = document.createElement('span');
  span3.textContent = savedAgo;
  
  meta.appendChild(span1);
  meta.appendChild(span2);
  meta.appendChild(span3);
  
  info.appendChild(title);
  info.appendChild(meta);
  
  // Actions
  const actions = document.createElement('div');
  actions.className = 'saved-card-actions';
  
  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'saved-btn saved-btn-restore';
  restoreBtn.textContent = 'Restore';
  restoreBtn.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'restoreClub', savedId: group.id });
    if (result.success) {
      showToast(`🔄 Restored ${result.restored} tab${result.restored !== 1 ? 's' : ''}`);
      await loadData();
    }
  });
  
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'saved-btn saved-btn-delete';
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Delete saved group';
  deleteBtn.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'deleteSavedClub', savedId: group.id });
    if (result.success) {
      card.style.opacity = '0';
      card.style.height = '0';
      card.style.padding = '0';
      card.style.overflow = 'hidden';
      card.style.transition = 'all 200ms ease';
      setTimeout(() => {
        card.remove();
        loadData();
      }, 200);
    }
  });
  
  actions.appendChild(restoreBtn);
  actions.appendChild(deleteBtn);
  
  card.appendChild(faviconEl);
  card.appendChild(info);
  card.appendChild(actions);
  
  return card;
}

function timeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ─── Global Event Bindings ─────────────────────────────────────────────────────

function bindGlobalEvents() {
  // Discard all inactive tabs
  $btnDiscardAll.addEventListener('click', async () => {
    const result = await chrome.runtime.sendMessage({ type: 'discardAll' });
    if (result.success) {
      showToast(`💤 ${result.discarded} tab${result.discarded !== 1 ? 's' : ''} put to sleep`);
      await loadData();
    }
  });
  
  // Open settings
  $btnSettings.addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
  
  // Toggle saved groups section
  $savedHeader.addEventListener('click', () => {
    savedExpanded = !savedExpanded;
    $savedSection.classList.toggle('expanded', savedExpanded);
  });
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2000);
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function createSvgNode(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  return doc.documentElement;
}
