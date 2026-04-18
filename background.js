/**
 * TabClub — Background Service Worker
 * 
 * Core engine that:
 * 1. Automatically groups tabs by domain into "clubs"
 * 2. Manages memory by discarding inactive tabs
 * 3. Provides data to the popup UI via messaging
 */

// ─── Constants ─────────────────────────────────────────────────────────────────

const GROUP_COLORS = ['blue', 'cyan', 'green', 'yellow', 'orange', 'red', 'pink', 'purple', 'grey'];
const INTERNAL_PROTOCOLS = ['about:', 'moz-extension:', 'chrome:', 'data:', 'file:', 'javascript:', 'blob:'];
const MEMORY_CHECK_ALARM = 'memory-check';
const DEFAULT_DISCARD_TIMEOUT_MIN = 5;
const MAX_FAVICON_CACHE = 200; // Prevent unbounded growth

// ─── State ─────────────────────────────────────────────────────────────────────

// domain → groupId mapping for the current session
const domainGroupMap = new Map();
// domain → faviconUrl cache
const faviconCache = new Map();
// tabId → { lastActiveTime, domain }
const tabActivity = new Map();
let globalGroupingQueue = Promise.resolve();
// Total discarded count for this session
let totalDiscardedCount = 0;
// Debounce timer for favicon cache persistence
let faviconPersistTimer = null;

// ─── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Extract the registrable domain from a URL.
 * e.g. "https://mail.google.com/inbox" → "google.com"
 * Falls back to full hostname for IPs and localhost.
 */
function extractDomain(url) {
  try {
    const u = new URL(url);
    // Skip internal pages
    if (INTERNAL_PROTOCOLS.some(p => u.protocol === p)) return null;
    
    const hostname = u.hostname;
    if (!hostname) return null;
    
    // IP addresses and localhost — use as-is
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname === 'localhost') {
      return hostname;
    }
    
    // Use the full hostname (e.g. "mail.google.com" stays as "mail.google.com")
    // but group by eTLD+1 to club subdomains together
    const parts = hostname.split('.');
    if (parts.length <= 2) return hostname;
    // Simple eTLD+1: take last 2 parts (works for .com, .org, .net, etc.)
    // For co.uk etc. take last 3 parts
    const twoPartTLDs = ['co.uk', 'com.au', 'co.in', 'co.jp', 'com.br', 'co.nz', 'co.za'];
    const lastTwo = parts.slice(-2).join('.');
    if (twoPartTLDs.includes(lastTwo)) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  } catch {
    return null;
  }
}

/**
 * Deterministic color from a domain string.
 * Uses a simple hash to map to one of 9 Chrome group colors.
 */
function domainToColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
}

/**
 * Pretty-print a domain for the group title.
 * e.g. "github.com" → "GitHub"
 */
function domainToTitle(domain) {
  // Remove TLD, capitalize
  const name = domain.split('.')[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Get the user's discard timeout setting (in minutes).
 */
async function getDiscardTimeout() {
  try {
    const result = await chrome.storage.local.get('discardTimeoutMin');
    return result.discardTimeoutMin || DEFAULT_DISCARD_TIMEOUT_MIN;
  } catch {
    return DEFAULT_DISCARD_TIMEOUT_MIN;
  }
}

/**
 * Get all user settings.
 */
async function getUserSettings() {
  try {
    const result = await chrome.storage.local.get({
      discardTimeoutMin: DEFAULT_DISCARD_TIMEOUT_MIN,
      protectPinned: true,
      protectAudio: true,
      autoCollapse: true,
      groupSingleTabs: true
    });
    return result;
  } catch {
    return {
      discardTimeoutMin: DEFAULT_DISCARD_TIMEOUT_MIN,
      protectPinned: true,
      protectAudio: true,
      autoCollapse: true,
      groupSingleTabs: true
    };
  }
}

/**
 * Debounced persist of the favicon cache to storage.
 * Prevents excessive storage writes when many tabs load at once.
 * Also prunes the cache if it grows too large.
 */
function persistFaviconCache() {
  if (faviconPersistTimer) clearTimeout(faviconPersistTimer);
  faviconPersistTimer = setTimeout(async () => {
    try {
      // Prune cache if it exceeds max size (keep most recent entries)
      if (faviconCache.size > MAX_FAVICON_CACHE) {
        const entries = [...faviconCache.entries()];
        const toRemove = entries.slice(0, entries.length - MAX_FAVICON_CACHE);
        for (const [key] of toRemove) {
          faviconCache.delete(key);
        }
      }
      const cacheObj = Object.fromEntries(faviconCache);
      await chrome.storage.local.set({ faviconCache: cacheObj });
    } catch (e) {
      console.warn('[TabClub] Failed to persist favicon cache:', e.message);
    }
  }, 1000);
}

// ─── Tab Grouping Engine ───────────────────────────────────────────────────────

/**
 * Group a single tab into the appropriate domain club.
 * Creates the group if it doesn't exist.
 * Uses a per-tab promise chain so concurrent calls queue instead of being dropped.
 */
function groupTab(tab) {
  const activeUrl = tab.url || tab.pendingUrl;
  if (!tab || !activeUrl || !tab.id) return Promise.resolve();
  
  const domain = extractDomain(activeUrl);
  if (!domain) return Promise.resolve();
  
  // Chain onto the global queue to prevent race conditions across tabs
  globalGroupingQueue = globalGroupingQueue
    .then(() => _doGroupTab(tab.id, domain, tab))
    .catch(e => {
      if (e.message && e.message.includes('dragging a tab')) {
        // Suppress the console error and quietly retry after the drag finishes
        setTimeout(() => groupTab(tab), 1000);
      } else {
        console.error('[TabClub] Grouping error:', e);
      }
    });
    
  return globalGroupingQueue;
}

/**
 * Internal: actually perform the grouping for a tab.
 * Re-fetches the tab to get the freshest state.
 */
async function _doGroupTab(tabId, domain, originalTab) {
  // Re-fetch the tab to get the latest URL / groupId
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return; // Tab was closed
  }
  
  const freshUrl = tab.url || tab.pendingUrl;
  const freshDomain = extractDomain(freshUrl);
  // Use the freshest domain available
  const effectiveDomain = freshDomain || domain;
  if (!effectiveDomain) return;
  
  // Cache the favicon
  if (tab.favIconUrl) {
    faviconCache.set(effectiveDomain, tab.favIconUrl);
    persistFaviconCache();
  }
  
  // Track activity
  tabActivity.set(tab.id, {
    lastActiveTime: tab.active ? Date.now() : (tabActivity.get(tab.id)?.lastActiveTime || Date.now()),
    domain: effectiveDomain
  });
  
  // Check if tab is already in a group
  if (tab.groupId && tab.groupId !== -1) {
    const existingGroupId = domainGroupMap.get(effectiveDomain);
    if (existingGroupId === tab.groupId) {
      return; // Already correctly grouped
    } else {
      // Tab is in the WRONG group (e.g., opened from a link in another club)
      // We must ungroup it first so it doesn't get stuck there
      try {
        await chrome.tabs.ungroup(tab.id);
        tab.groupId = -1; // Update local state
      } catch { /* ignore */ }
    }
  }
  
  const color = domainToColor(effectiveDomain);
  const title = domainToTitle(effectiveDomain);
  
  // Check if we already have a group for this domain
  let groupId = domainGroupMap.get(effectiveDomain);
  
  if (groupId != null) {
    // Verify the group still exists
    try {
      await chrome.tabGroups.get(groupId);
    } catch {
      domainGroupMap.delete(effectiveDomain);
      groupId = null;
    }
  }
  
  if (groupId != null) {
    // Group exists — join this tab + sweep any other ungrouped siblings into the group
    const allTabs = await chrome.tabs.query({});
    const ungroupedSiblings = allTabs.filter(t => {
      if (t.id === tab.id) return false;
      if (t.groupId === groupId) return false; // already in this group
      const d = extractDomain(t.url || t.pendingUrl);
      return d === effectiveDomain && (!t.groupId || t.groupId === -1);
    });
    const tabIdsToGroup = [tab.id, ...ungroupedSiblings.map(s => s.id)];
    await chrome.tabs.group({ tabIds: tabIdsToGroup, groupId });
  } else {
    // No group yet — only create one if there are 2+ tabs from this domain
    const sameDomainTabs = await chrome.tabs.query({});
    const siblings = sameDomainTabs.filter(t => {
      const d = extractDomain(t.url || t.pendingUrl);
      return d === effectiveDomain && t.id !== tab.id;
    });
    
    if (siblings.length === 0) {
      // Only 1 tab from this domain — don't create a group
      return;
    }
    
    // 2+ tabs: group them all together
    const allTabIds = [tab.id, ...siblings.map(s => s.id)];
    const newGroupId = await chrome.tabs.group({ tabIds: allTabIds });
    groupId = newGroupId;
    domainGroupMap.set(effectiveDomain, groupId);
    
    await chrome.tabGroups.update(groupId, {
      title: title,
      color: color,
      collapsed: !tab.active
    });
  }
}

/**
 * Scan all existing tabs and group them.
 * Called on extension load / browser startup.
 * 
 * Step 1: Ungroup ALL tabs first — this clears Chrome's "saved tab groups"
 *         that appear as chips on the bookmarks toolbar after a restart.
 * Step 2: Re-group tabs by domain into fresh clubs.
 */
async function groupAllExistingTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    
    // ── Step 1: Ungroup every tab to clear stale saved groups from the toolbar ──
    const groupedTabIds = tabs
      .filter(t => t.groupId != null && t.groupId !== -1)
      .map(t => t.id);
    
    if (groupedTabIds.length > 0) {
      try {
        await chrome.tabs.ungroup(groupedTabIds);
      } catch (e) {
        console.warn('[TabClub] Failed to ungroup restored tabs:', e.message);
        // Try one-by-one as fallback
        for (const id of groupedTabIds) {
          try { await chrome.tabs.ungroup(id); } catch { /* skip */ }
        }
      }
    }
    
    // Small delay to let Chrome clean up the removed groups
    await new Promise(r => setTimeout(r, 300));
    
    // ── Step 2: Re-group tabs by domain ──
    const domainTabs = new Map();
    // Re-query tabs to get fresh state after ungrouping
    const freshTabs = await chrome.tabs.query({});
    
    for (const tab of freshTabs) {
      const domain = extractDomain(tab.url);
      if (!domain) continue;
      if (!domainTabs.has(domain)) domainTabs.set(domain, []);
      domainTabs.get(domain).push(tab);
      
      // Cache favicons
      if (tab.favIconUrl) {
        faviconCache.set(domain, tab.favIconUrl);
      }
      
      // Track activity
      tabActivity.set(tab.id, {
        lastActiveTime: tab.active ? Date.now() : Date.now() - 60000,
        domain
      });
    }
    
    // Create fresh groups — only for domains with 2+ tabs
    for (const [domain, domTabs] of domainTabs) {
      if (domTabs.length < 2) continue; // Skip single-tab domains
      
      const tabIds = domTabs.map(t => t.id);
      const color = domainToColor(domain);
      const title = domainToTitle(domain);
      const hasActiveTab = domTabs.some(t => t.active);
      
      try {
        const groupId = await chrome.tabs.group({ tabIds });
        domainGroupMap.set(domain, groupId);
        
        await chrome.tabGroups.update(groupId, {
          title,
          color,
          collapsed: !hasActiveTab
        });
      } catch (e) {
        console.warn(`[TabClub] Failed to group domain ${domain}:`, e.message);
      }
    }
    
    // Persist favicon cache (debounced)
    persistFaviconCache();
    
  } catch (e) {
    console.error('[TabClub] Failed to group existing tabs:', e);
  }
}

// ─── Memory Manager ────────────────────────────────────────────────────────────

/**
 * Discard tabs that have been inactive for longer than the configured timeout.
 * Respects user settings for protectPinned and protectAudio.
 */
async function discardInactiveTabs() {
  const settings = await getUserSettings();
  const timeoutMs = settings.discardTimeoutMin * 60 * 1000;
  const now = Date.now();
  
  try {
    const tabs = await chrome.tabs.query({});
    
    for (const tab of tabs) {
      // Never discard: active tab, already discarded
      if (tab.active || tab.discarded) continue;
      
      // Respect user settings for pinned and audio protection
      if (settings.protectPinned && tab.pinned) continue;
      if (settings.protectAudio && tab.audible) continue;
      
      // Skip internal pages
      const domain = extractDomain(tab.url);
      if (!domain) continue;
      
      const activity = tabActivity.get(tab.id);
      const lastActive = activity?.lastActiveTime || 0;
      
      if (now - lastActive > timeoutMs) {
        try {
          await chrome.tabs.discard(tab.id);
          totalDiscardedCount++;
        } catch (e) {
          // Tab may have been closed between query and discard
          console.warn(`[TabClub] Failed to discard tab ${tab.id}:`, e.message);
        }
      }
    }
    
    // Persist stats
    await chrome.storage.local.set({ totalDiscardedCount });
    
    // Clean up stale entries from tabActivity (tabs that no longer exist)
    const existingTabIds = new Set(tabs.map(t => t.id));
    for (const tabId of tabActivity.keys()) {
      if (!existingTabIds.has(tabId)) {
        tabActivity.delete(tabId);
      }
    }
    
    // Clean up stale entries from domainGroupMap (groups that no longer exist)
    const existingGroupIds = new Set();
    try {
      const groups = await chrome.tabGroups.query({});
      for (const g of groups) existingGroupIds.add(g.id);
    } catch { /* ignore */ }
    for (const [domain, gId] of domainGroupMap) {
      if (!existingGroupIds.has(gId)) {
        domainGroupMap.delete(domain);
      }
    }
    
    // (Queue is now global, no stale processingTabs map to clean)
    
  } catch (e) {
    console.error('[TabClub] Memory check failed:', e);
  }
}

// ─── Event Listeners ───────────────────────────────────────────────────────────

// Tab created — group it once it loads
chrome.tabs.onCreated.addListener((tab) => {
  const activeUrl = tab.url || tab.pendingUrl;
  if (activeUrl && activeUrl !== 'about:blank' && activeUrl !== 'chrome://newtab/') {
    groupTab(tab);
  } else {
    // URL may not be available yet — re-check shortly
    setTimeout(async () => {
      try {
        const freshTab = await chrome.tabs.get(tab.id);
        const url = freshTab.url || freshTab.pendingUrl;
        if (url && url !== 'about:blank' && url !== 'chrome://newtab/' && (!freshTab.groupId || freshTab.groupId === -1)) {
          groupTab(freshTab);
        }
      } catch { /* tab may have been closed */ }
    }, 500);
  }
});

// Tab updated — re-evaluate grouping on ANY status change (loading/complete) or URL change
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const activeUrl = tab.url || tab.pendingUrl;
  
  // Trigger on url change, status change (loading or complete), or pendingUrl appearing
  const shouldCheck = changeInfo.url || changeInfo.status === 'loading' || changeInfo.status === 'complete';
  
  if (shouldCheck && activeUrl && activeUrl !== 'about:blank' && activeUrl !== 'chrome://newtab/') {
    const oldActivity = tabActivity.get(tabId);
    const newDomain = extractDomain(activeUrl);
    
    if (newDomain) {
      const domainChanged = oldActivity && oldActivity.domain !== newDomain;
      
      if (domainChanged) {
        // Domain changed — ungroup from old group first, then re-group
        if (tab.groupId && tab.groupId !== -1) {
          try {
            await chrome.tabs.ungroup(tabId);
          } catch {
            // May already be ungrouped
          }
        }
        await groupTab(tab);
      } else if (!tab.groupId || tab.groupId === -1) {
        // Not grouped yet — always try to group (will only create if 2+ tabs)
        await groupTab(tab);
      }
    }
    
    // Update favicon on complete
    if (newDomain && changeInfo.status === 'complete' && tab.favIconUrl) {
      faviconCache.set(newDomain, tab.favIconUrl);
      persistFaviconCache();
    }
  }
  
  // Update favicon when it changes
  if (changeInfo.favIconUrl) {
    const domain = extractDomain(activeUrl);
    if (domain) {
      faviconCache.set(domain, changeInfo.favIconUrl);
      persistFaviconCache();
    }
  }
});

// Tab removed — clean up tracking
chrome.tabs.onRemoved.addListener((tabId) => {
  tabActivity.delete(tabId);
  
  // Clean up domainGroupMap if the group was emptied
  // (Chrome auto-removes empty groups, but we track it)
  // We'll lazily clean this up when we try to use a stale groupId
});

// Track the previously active tab's groupId so we can collapse it on switch
let previousActiveGroupId = null;

// Tab activated — update activity timestamp, collapse previous club, expand new club
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  const { tabId } = activeInfo;
  
  try {
    let tab = await chrome.tabs.get(tabId);
    
    // Auto-group if ungrouped — _doGroupTab handles the 2+ tab check safely
    if (!tab.groupId || tab.groupId === -1) {
      await groupTab(tab);
      tab = await chrome.tabs.get(tabId); // Refresh state
    }
    
    const activeUrl = tab.url || tab.pendingUrl;
    const domain = extractDomain(activeUrl);
    
    // Update last active time
    if (domain) {
      tabActivity.set(tabId, {
        lastActiveTime: Date.now(),
        domain
      });
    }
    
    const currentGroupId = (tab.groupId && tab.groupId !== -1) ? tab.groupId : null;
    
    // ── Always collapse the previous club when user leaves it ──
    // This is the core "club" behavior: leaving a club = it closes behind you
    if (previousActiveGroupId != null && previousActiveGroupId !== currentGroupId) {
      try {
        await chrome.tabGroups.update(previousActiveGroupId, { collapsed: true });
      } catch {
        // Previous group may have been removed
      }
    }
    
    // ── Expand the new active tab's group ──
    if (currentGroupId) {
      try {
        await chrome.tabGroups.update(currentGroupId, { collapsed: false });
      } catch { /* ignore */ }
      
      // If autoCollapse is on, also collapse ALL other groups (not just previous)
      const settings = await getUserSettings();
      if (settings.autoCollapse) {
        const allGroups = await chrome.tabGroups.query({});
        for (const group of allGroups) {
          if (group.id !== currentGroupId) {
            try {
              await chrome.tabGroups.update(group.id, { collapsed: true });
            } catch {
              // Group may have been removed
            }
          }
        }
      }
    }
    
    // Remember this group for next switch
    previousActiveGroupId = currentGroupId;
    
  } catch {
    // Tab may have been closed
  }
});

// Group removed — clean up domain mapping
chrome.tabGroups.onRemoved.addListener((group) => {
  for (const [domain, gId] of domainGroupMap) {
    if (gId === group.id) {
      domainGroupMap.delete(domain);
      break;
    }
  }
});

// ─── Alarm-based Memory Management ────────────────────────────────────────────

chrome.alarms.create(MEMORY_CHECK_ALARM, {
  delayInMinutes: 1,
  periodInMinutes: 1
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === MEMORY_CHECK_ALARM) {
    discardInactiveTabs();
  }
});

// ─── Message Handler (Popup ↔ Background) ──────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'getClubs':
      return await getClubsData();
    
    case 'getMemoryStats':
      return await getMemoryStats();
    
    case 'expandClub': {
      try {
        await chrome.tabGroups.update(message.groupId, { collapsed: false });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'collapseClub': {
      try {
        await chrome.tabGroups.update(message.groupId, { collapsed: true });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'activateTab': {
      try {
        await chrome.tabs.update(message.tabId, { active: true });
        const tab = await chrome.tabs.get(message.tabId);
        await chrome.windows.update(tab.windowId, { focused: true });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'closeTab': {
      try {
        await chrome.tabs.remove(message.tabId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'discardClub': {
      try {
        const settings = await getUserSettings();
        const tabs = await chrome.tabs.query({ groupId: message.groupId });
        let discarded = 0;
        for (const tab of tabs) {
          if (tab.active || tab.discarded) continue;
          if (settings.protectPinned && tab.pinned) continue;
          if (settings.protectAudio && tab.audible) continue;
          try {
            await chrome.tabs.discard(tab.id);
            discarded++;
            totalDiscardedCount++;
          } catch { /* skip */ }
        }
        await chrome.storage.local.set({ totalDiscardedCount });
        return { success: true, discarded };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'discardAll': {
      try {
        const settings = await getUserSettings();
        const tabs = await chrome.tabs.query({});
        let discarded = 0;
        for (const tab of tabs) {
          if (tab.active || tab.discarded) continue;
          if (settings.protectPinned && tab.pinned) continue;
          if (settings.protectAudio && tab.audible) continue;
          try {
            await chrome.tabs.discard(tab.id);
            discarded++;
            totalDiscardedCount++;
          } catch { /* skip */ }
        }
        await chrome.storage.local.set({ totalDiscardedCount });
        return { success: true, discarded };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'saveClub': {
      try {
        const tabs = await chrome.tabs.query({ groupId: message.groupId });
        if (tabs.length === 0) return { success: false, error: 'No tabs in group' };
        
        // Get group info
        let groupInfo;
        try {
          groupInfo = await chrome.tabGroups.get(message.groupId);
        } catch {
          groupInfo = { title: 'Saved Group', color: 'grey' };
        }
        
        // Find domain for this group
        let domain = null;
        for (const [d, gId] of domainGroupMap) {
          if (gId === message.groupId) { domain = d; break; }
        }
        if (!domain && tabs.length > 0) {
          domain = extractDomain(tabs[0].url) || 'unknown';
        }
        
        const savedGroup = {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          title: groupInfo.title || domainToTitle(domain || 'unknown'),
          domain: domain,
          color: groupInfo.color || 'grey',
          favicon: faviconCache.get(domain) || null,
          savedAt: Date.now(),
          tabs: tabs.map(t => ({
            title: t.title || 'Untitled',
            url: t.url,
            favIconUrl: t.favIconUrl || null
          }))
        };
        
        // Load existing saved groups and append
        const stored = await chrome.storage.local.get('savedGroups');
        const savedGroups = stored.savedGroups || [];
        savedGroups.push(savedGroup);
        await chrome.storage.local.set({ savedGroups });
        
        // Keep tabs open and group intact
        return { success: true, savedCount: tabs.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'getSavedClubs': {
      try {
        const stored = await chrome.storage.local.get('savedGroups');
        return { savedGroups: stored.savedGroups || [] };
      } catch (e) {
        return { savedGroups: [], error: e.message };
      }
    }
    
    case 'restoreClub': {
      try {
        const stored = await chrome.storage.local.get('savedGroups');
        const savedGroups = stored.savedGroups || [];
        const group = savedGroups.find(g => g.id === message.savedId);
        if (!group) return { success: false, error: 'Saved group not found' };
        
        // Open all tabs
        const openedTabs = [];
        for (const tab of group.tabs) {
          try {
            const newTab = await chrome.tabs.create({ url: tab.url, active: false });
            openedTabs.push(newTab);
          } catch { /* skip invalid URLs */ }
        }
        
        // Activate the first tab
        if (openedTabs.length > 0) {
          await chrome.tabs.update(openedTabs[0].id, { active: true });
        }
        
        // Keep saved group in storage — user must explicitly delete with ✕
        return { success: true, restored: openedTabs.length };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    case 'deleteSavedClub': {
      try {
        const stored = await chrome.storage.local.get('savedGroups');
        const savedGroups = stored.savedGroups || [];
        const idx = savedGroups.findIndex(g => g.id === message.savedId);
        if (idx === -1) return { success: false, error: 'Not found' };
        
        savedGroups.splice(idx, 1);
        await chrome.storage.local.set({ savedGroups });
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    }
    
    default:
      return { error: 'Unknown message type' };
  }
}

/**
 * Build the clubs data structure for the popup.
 */
async function getClubsData() {
  try {
    const tabs = await chrome.tabs.query({});
    const groups = await chrome.tabGroups.query({});
    
    // Load persisted favicon cache
    const stored = await chrome.storage.local.get('faviconCache');
    if (stored.faviconCache) {
      for (const [k, v] of Object.entries(stored.faviconCache)) {
        if (!faviconCache.has(k)) faviconCache.set(k, v);
      }
    }
    
    // Build clubs from groups
    const clubs = [];
    
    for (const group of groups) {
      const groupTabs = tabs.filter(t => t.groupId === group.id);
      if (groupTabs.length === 0) continue;
      
      // Find the domain for this group
      let domain = null;
      for (const [d, gId] of domainGroupMap) {
        if (gId === group.id) {
          domain = d;
          break;
        }
      }
      
      // Fallback: extract domain from first tab
      if (!domain && groupTabs.length > 0) {
        domain = extractDomain(groupTabs[0].url) || 'unknown';
      }
      
      const favicon = faviconCache.get(domain) || null;
      const discardedCount = groupTabs.filter(t => t.discarded).length;
      const activeCount = groupTabs.filter(t => !t.discarded).length;
      
      clubs.push({
        groupId: group.id,
        domain: domain,
        title: group.title || domainToTitle(domain || 'unknown'),
        color: group.color || 'grey',
        collapsed: group.collapsed || false,
        favicon: favicon,
        tabCount: groupTabs.length,
        activeCount,
        discardedCount,
        tabs: groupTabs.map(t => ({
          id: t.id,
          title: t.title || 'Untitled',
          url: t.url,
          active: t.active,
          discarded: t.discarded,
          favIconUrl: t.favIconUrl || favicon
        }))
      });
    }
    
    // Also include ungrouped tabs
    const ungroupedTabs = tabs.filter(t => !t.groupId || t.groupId === -1);
    const ungroupedByDomain = new Map();
    
    for (const tab of ungroupedTabs) {
      const domain = extractDomain(tab.url);
      if (!domain) continue; // Skip internal pages
      if (!ungroupedByDomain.has(domain)) ungroupedByDomain.set(domain, []);
      ungroupedByDomain.get(domain).push(tab);
    }
    
    // If there are ungrouped tabs from valid domains, group them now
    for (const [domain, domTabs] of ungroupedByDomain) {
      if (domTabs.length > 0) {
        // Auto-group these stragglers
        for (const tab of domTabs) {
          await groupTab(tab);
        }
      }
    }
    
    // Sort clubs: active tab's club first, then by tab count descending
    clubs.sort((a, b) => {
      const aHasActive = a.tabs.some(t => t.active);
      const bHasActive = b.tabs.some(t => t.active);
      if (aHasActive && !bHasActive) return -1;
      if (bHasActive && !aHasActive) return 1;
      return b.tabCount - a.tabCount;
    });
    
    return { clubs };
  } catch (e) {
    console.error('[TabClub] getClubsData failed:', e);
    return { clubs: [], error: e.message };
  }
}

/**
 * Get memory management statistics.
 */
async function getMemoryStats() {
  try {
    const tabs = await chrome.tabs.query({});
    const total = tabs.length;
    const discarded = tabs.filter(t => t.discarded).length;
    const active = total - discarded;
    const pinned = tabs.filter(t => t.pinned).length;
    const audible = tabs.filter(t => t.audible).length;
    
    // Estimate: ~50MB per active tab, ~1MB per discarded tab
    const estimatedSavingsMB = discarded * 49;
    
    const stored = await chrome.storage.local.get('totalDiscardedCount');
    const totalEverDiscarded = stored.totalDiscardedCount || totalDiscardedCount;
    
    const timeout = await getDiscardTimeout();
    
    return {
      total,
      active,
      discarded,
      pinned,
      audible,
      estimatedSavingsMB,
      totalEverDiscarded,
      timeoutMin: timeout
    };
  } catch (e) {
    return { error: e.message };
  }
}

// ─── Initialization ────────────────────────────────────────────────────────────

(async function init() {
  // Load persisted data
  const stored = await chrome.storage.local.get(['faviconCache', 'totalDiscardedCount']);
  
  if (stored.faviconCache) {
    for (const [k, v] of Object.entries(stored.faviconCache)) {
      faviconCache.set(k, v);
    }
  }
  
  if (stored.totalDiscardedCount) {
    totalDiscardedCount = stored.totalDiscardedCount;
  }
  
  // Give browser a moment to restore tabs on startup
  setTimeout(() => {
    groupAllExistingTabs();
  }, 2000);
})();
