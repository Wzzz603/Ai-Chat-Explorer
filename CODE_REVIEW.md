# Ai Chat Explorer 1.0 — Release Review

## Branding
- Public product name is now **Ai Chat Explorer**.
- Manifest version is **1.0**; the panel displays **v1.0**.
- Internal `cgptExplorer*` storage keys and DOM IDs are intentionally retained for backward compatibility with existing workspaces and browser storage.

## Author / GitHub
- Panel header shows a clickable **@Wzzz603** link.
- The destination is `https://github.com/wzzz603`, but the raw URL is not shown in the UI.
- Settings > About repeats the clickable author link.

## Copyright / third-party notice
- Settings > About contains an All Rights Reserved notice and a no-license-by-publication statement.
- `COPYRIGHT.md` carries the same release notice for the packaged source tree.
- The UI states that Ai Chat Explorer is an independent third-party extension and is not affiliated with, sponsored by, or endorsed by OpenAI.

## Compatibility
- Existing local storage prefixes, IndexedDB names, path marker format `⟦CE:...⟧`, workspace filenames, and account-scoped state keys were not renamed. Renaming those internals would break automatic upgrade/migration from 0.17.x.

## 1.0 release legal/privacy packaging

- Added `LICENSE`: Ai Chat Explorer Proprietary Software License v1.0.
  - permits installation and ordinary use of unmodified copies for personal or internal organizational use;
  - prohibits unauthorized modification, derivative works, repackaging, republication, resale, sublicensing, redistribution, and commercial exploitation of the Software itself;
  - explicitly preserves GitHub platform-specific public-repository viewing/forking rights without treating them as a broader open-source grant.
- Added `PRIVACY.md` matching the current code path:
  - no developer-controlled telemetry/analytics/advertising endpoint;
  - extension state is primarily local (`chrome.storage.local`, IndexedDB, optional local workspace JSON);
  - synchronization requests go directly to `chatgpt.com` using the current authenticated session;
  - path-marker folder names become part of ChatGPT conversation titles when the feature is enabled.
- Settings > About now includes Software License and Privacy Policy cards with buttons that open the packaged legal documents.
- `manifest.json` exposes only the packaged `LICENSE` and `PRIVACY.md` documents to `chatgpt.com` so those settings buttons can open them; no additional website host permissions were added.
- README/COPYRIGHT updated to reference the proprietary license and privacy policy.

Static validation completed for `content.js`, `background.js`, `idb.js`, and `manifest.json`.
