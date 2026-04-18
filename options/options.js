/**
 * TabClub — Options Page Script
 * 
 * Manages settings persistence, theme switching, and UI interactions.
 */

// ─── DOM References ────────────────────────────────────────────────────────────

const $discardTimeout = document.getElementById('discard-timeout');
const $timeoutValue = document.getElementById('timeout-value');
const $protectPinned = document.getElementById('protect-pinned');
const $protectAudio = document.getElementById('protect-audio');
const $autoCollapse = document.getElementById('auto-collapse');
const $groupSingleTabs = document.getElementById('group-single-tabs');
const $saveToast = document.getElementById('save-toast');
const $totalDiscarded = document.getElementById('about-total-discarded');
const $themeSwitcher = document.getElementById('theme-switcher');

// ─── Default Settings ──────────────────────────────────────────────────────────

const DEFAULTS = {
  discardTimeoutMin: 5,
  protectPinned: true,
  protectAudio: true,
  autoCollapse: true,
  groupSingleTabs: true,
  theme: 'system'     // 'dark' | 'light' | 'system'
};

let saveToastTimer = null;

// ─── Initialize ────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  await loadTheme(); // Apply theme immediately before anything renders
  await loadSettings();
  bindEvents();
  await loadStats();
});

// ─── Theme Management ──────────────────────────────────────────────────────────

/**
 * Load and apply the stored theme preference.
 */
async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get('theme');
    const theme = stored.theme || DEFAULTS.theme;
    applyTheme(theme);
    updateThemeButtons(theme);
  } catch {
    applyTheme('dark');
  }
}

/**
 * Apply a theme to the document.
 * @param {'dark'|'light'|'system'} theme
 */
function applyTheme(theme) {
  let resolvedTheme = theme;
  
  if (theme === 'system') {
    resolvedTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  
  document.documentElement.setAttribute('data-theme', resolvedTheme);
  
  // Update range fill color based on theme
  updateRangeFill();
}

/**
 * Highlight the active theme button.
 */
function updateThemeButtons(activeTheme) {
  const buttons = $themeSwitcher.querySelectorAll('.theme-btn');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === activeTheme);
  });
}

/**
 * Save and apply theme selection.
 */
async function setTheme(theme) {
  try {
    await chrome.storage.local.set({ theme });
    applyTheme(theme);
    updateThemeButtons(theme);
    showSaveToast();
  } catch (e) {
    console.error('[TabClub Options] Failed to save theme:', e);
  }
}

// Listen for system theme changes when in 'system' mode
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', async () => {
  try {
    const stored = await chrome.storage.local.get('theme');
    if (stored.theme === 'system') {
      applyTheme('system');
    }
  } catch { /* ignore */ }
});

// ─── Load Settings ─────────────────────────────────────────────────────────────

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
    
    const settings = { ...DEFAULTS, ...stored };
    
    $discardTimeout.value = settings.discardTimeoutMin;
    $timeoutValue.textContent = `${settings.discardTimeoutMin} min`;
    $protectPinned.checked = settings.protectPinned;
    $protectAudio.checked = settings.protectAudio;
    $autoCollapse.checked = settings.autoCollapse;
    $groupSingleTabs.checked = settings.groupSingleTabs;
    
    // Update range fill
    updateRangeFill();
  } catch (e) {
    console.error('[TabClub Options] Failed to load settings:', e);
  }
}

// ─── Load Stats ────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const stored = await chrome.storage.local.get('totalDiscardedCount');
    $totalDiscarded.textContent = stored.totalDiscardedCount || 0;
  } catch {
    $totalDiscarded.textContent = '0';
  }
}

// ─── Save Settings ─────────────────────────────────────────────────────────────

async function saveSettings() {
  try {
    await chrome.storage.local.set({
      discardTimeoutMin: parseInt($discardTimeout.value, 10),
      protectPinned: $protectPinned.checked,
      protectAudio: $protectAudio.checked,
      autoCollapse: $autoCollapse.checked,
      groupSingleTabs: $groupSingleTabs.checked
    });
    
    showSaveToast();
  } catch (e) {
    console.error('[TabClub Options] Failed to save settings:', e);
  }
}

// ─── Event Bindings ────────────────────────────────────────────────────────────

function bindEvents() {
  // Theme switcher buttons
  $themeSwitcher.addEventListener('click', (e) => {
    const btn = e.target.closest('.theme-btn');
    if (btn) {
      setTheme(btn.dataset.theme);
    }
  });
  
  // Range slider — live update display + auto-save
  $discardTimeout.addEventListener('input', () => {
    $timeoutValue.textContent = `${$discardTimeout.value} min`;
    updateRangeFill();
  });
  
  $discardTimeout.addEventListener('change', saveSettings);
  
  // Toggle switches — auto-save on change
  $protectPinned.addEventListener('change', saveSettings);
  $protectAudio.addEventListener('change', saveSettings);
  $autoCollapse.addEventListener('change', saveSettings);
  $groupSingleTabs.addEventListener('change', saveSettings);
}

// ─── Range Fill Visual ─────────────────────────────────────────────────────────

function updateRangeFill() {
  const min = parseInt($discardTimeout.min);
  const max = parseInt($discardTimeout.max);
  const val = parseInt($discardTimeout.value);
  const pct = ((val - min) / (max - min)) * 100;
  
  // Use theme-aware colors
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const fillColor = isLight ? '#0e8a93' : '#56d4dd';
  const trackColor = isLight ? '#d0d7de' : '#161b22';
  
  $discardTimeout.style.background = `linear-gradient(to right, ${fillColor} ${pct}%, ${trackColor} ${pct}%)`;
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function showSaveToast() {
  $saveToast.classList.add('show');
  
  if (saveToastTimer) clearTimeout(saveToastTimer);
  saveToastTimer = setTimeout(() => {
    $saveToast.classList.remove('show');
  }, 1500);
}
