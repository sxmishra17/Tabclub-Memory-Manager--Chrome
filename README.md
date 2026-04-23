# 🎯 TabClub Memory Manager

A Firefox extension that automatically groups your browser tabs by website into color-coded **clubs**, manages memory by discarding inactive tabs, and provides a stunning dashboard with real-time memory monitoring.

![Firefox 139+](https://img.shields.io/badge/Firefox-139%2B-orange?logo=firefox)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue)
![License](https://img.shields.io/badge/License-Proprietary-red)
![No Data Collection](https://img.shields.io/badge/Privacy-No%20Data%20Collection-brightgreen)

## ✨ Features

### 🗂️ Automatic Tab Grouping
- Tabs from the same website are automatically clubbed together
- Deterministic color assignment — same domain always gets the same color
- Non-disruptive: clubs merge silently without disturbing your workflow
- Previous club auto-collapses when you switch to a different club

### 💤 Smart Memory Management  
- Inactive tabs are automatically discarded after a configurable timeout (default: 5 minutes)
- Discarded tabs stay in the tab bar but release RAM
- Protected tabs: active, pinned, and audio-playing tabs are never discarded (configurable)
- Memory savings dashboard with estimated Firefox memory usage
- Visual progress bar showing active vs. saved memory

### 🎨 Stunning UI
- Premium dark & light mode with glassmorphism effects
- Color-coded club cards with website favicons
- Smooth expand/collapse animations
- Real-time memory statistics and usage bar
- Toast notifications for actions
- Powered by YuvaTech branding

### ⚙️ Configurable Settings
- Auto-sleep timeout: 1–60 minutes
- Dark / Light / System theme
- Protect pinned tabs toggle
- Protect audio tabs toggle
- Auto-collapse inactive clubs
- Group single tabs option

### 🔒 Privacy First
- **Zero data collection** — no analytics, no tracking, no telemetry
- **Zero external requests** — no CDNs, no third-party fonts, no network calls
- All data stored locally via `browser.storage.local`
- No content scripts — never touches your page content

## 📦 Installation

### From Source (Development)

1. Open Firefox and navigate to `about:debugging`
2. Click **"This Firefox"** in the sidebar
3. Click **"Load Temporary Add-on..."**
4. Select the `manifest.json` file from this directory

### Requirements

- **Firefox 139+** (required for the `tabGroups` API)

## 🏗️ Architecture

```
Club_my_Tabs/
├── manifest.json          # MV3 manifest
├── background.js          # Service worker — grouping + memory management
├── popup/
│   ├── popup.html         # Toolbar popup
│   ├── popup.css          # Premium dark/light mode styles
│   └── popup.js           # Popup rendering & interactions
├── options/
│   ├── options.html       # Settings page
│   ├── options.css        # Settings styles
│   └── options.js         # Settings logic + theme switching
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-128.png
│   └── yuvatech_logo.png
└── README.md
```

## 🔧 How It Works

1. **Tab Monitoring**: The background service worker listens for tab creation, navigation, and removal events
2. **Domain Extraction**: URLs are parsed to extract the registrable domain (eTLD+1), clubbing subdomains together
3. **Grouping**: Uses Firefox's native `tabs.group()` and `tabGroups.update()` APIs to create and style groups
4. **Auto-Collapse**: When you switch to a different club, the previous club collapses automatically
5. **Memory Management**: An alarm fires every minute to check for tabs inactive beyond the configured timeout, discarding them via `tabs.discard()`
6. **Memory Dashboard**: Estimates Firefox memory usage based on active/discarded tab counts and displays a visual bar
7. **Popup Dashboard**: Communicates with the background worker via `runtime.sendMessage()` to display clubs, stats, and handle user actions

## 📝 License

All Rights Reserved — Powered by YuvaTech
