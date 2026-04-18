# Privacy Policy — TabClub Memory Manager

**Last updated:** April 18, 2026
**Developer:** YuvaTech
**Extension:** TabClub Memory Manager (Chrome Web Store)

---

## Overview

TabClub Memory Manager ("the Extension") is a Chrome browser extension that automatically organizes your open tabs by website domain into color-coded groups and saves memory by putting inactive tabs to sleep. This Privacy Policy explains what information the Extension accesses, how it is used, and what we do (and do not) do with it.

---

## Information We Access

To provide its core functionality, the Extension accesses the following data **locally within your browser**:

### Tab Information
- **Tab URLs** — used solely to extract the website domain (e.g., `github.com`) for grouping purposes.
- **Tab titles** — displayed in the popup dashboard to help you identify your tabs.
- **Tab favicons** — cached locally to display website icons in the popup.
- **Tab state** — whether a tab is active, pinned, audible, or already discarded, used to apply memory management rules.

### User Settings
- Your preferences (sleep timeout, theme, protection toggles) are saved using Chrome's `storage.local` API and remain on your device.

### Saved Groups
- If you use the "Save" feature, tab URLs and titles are saved to `chrome.storage.local` on your device so you can restore them later.

---

## Information We Do NOT Collect

The Extension does **not** collect, transmit, or share any of the following:

- Personal information (name, email, address, age)
- Browsing history or web history sent to any server
- Page content, text, images, or any website data
- Keystrokes, mouse movements, or clicks
- Authentication credentials or passwords
- Financial or payment information
- Health information
- Location data or IP addresses
- Any analytics, telemetry, or usage statistics

---

## How Your Data Is Used

All data accessed by the Extension is used **exclusively** to provide tab grouping and memory management features.

| Data | Purpose |
|---|---|
| Tab URLs | Extract domain for grouping |
| Tab titles | Display in popup dashboard |
| Tab favicons | Display website icons in popup |
| Tab state | Determine which tabs are eligible for discarding |
| Settings | Persist your preferences across sessions |
| Saved groups | Allow you to restore previously saved tab sessions |

No data is used for advertising, profiling, analytics, or any purpose unrelated to tab management.

---

## Data Storage

All data is stored **locally on your device** using Chrome's `chrome.storage.local` API. This includes your settings and preferences, the favicon cache (limited to 200 entries, automatically pruned), and saved tab group sessions.

**This data never leaves your device.** It is not synced to any external server, cloud service, or third party. It is not accessible to YuvaTech or anyone else.

---

## Data Sharing

We do **not** sell, trade, rent, or otherwise transfer any data to third parties. There are no third-party SDKs, analytics libraries, advertising networks, or tracking scripts included in the Extension.

---

## Remote Code

The Extension does not load or execute any remote code. All JavaScript, HTML, and CSS is bundled locally within the Extension package. There are no calls to external APIs, CDNs, or servers at runtime.

---

## Permissions Explanation

| Permission | Why it is needed |
|---|---|
| `tabs` | To read tab URLs, titles, favicons, and state for grouping and memory management |
| `tabGroups` | To create, update, and manage Chrome's built-in tab groups |
| `storage` | To save settings, favicon cache, and saved groups locally on your device |
| `alarms` | To run a periodic background check (every 1 minute) that discards inactive tabs |

---

## Children's Privacy

The Extension does not knowingly collect any information from children under the age of 13. The Extension does not collect any personal information from any user of any age.

---

## Changes to This Policy

If we make any material changes to this Privacy Policy, we will update the "Last updated" date at the top of this page.

---

## Contact

**YuvaTech**
GitHub: [https://github.com/sxmishra17](https://github.com/sxmishra17)

---

*TabClub Memory Manager operates entirely within your local browser environment. Your privacy is fully respected.*
