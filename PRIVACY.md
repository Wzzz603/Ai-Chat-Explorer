# Ai Chat Explorer Privacy Policy

Effective date: September 7, 2026  
Version: 1.0

Ai Chat Explorer is an independently developed browser extension by Wzzz603 for organizing ChatGPT conversations and Projects. This policy describes what information the extension processes, where it is stored, and when it is sent to ChatGPT.

## 1. Summary

Ai Chat Explorer does not operate an author-controlled analytics, advertising, telemetry, or data-collection server. The extension does not intentionally send your ChatGPT conversation data, workspace structure, or usage activity to Wzzz603.

The extension works locally in your browser and communicates directly with `chatgpt.com` when it needs to read or update ChatGPT account, conversation, pin, or Project information.

## 2. Information processed by the extension

To provide its features, Ai Chat Explorer may process the following information from your current ChatGPT session:

- ChatGPT account/session identifiers needed to keep Explorer workspaces separated by account.
- Conversation identifiers and titles.
- Project identifiers, Project names, and Project membership.
- Pin/star state and conversation timestamps.
- Local Ai Chat Explorer folder assignments and folder names.
- Quick-access entries, shortcuts, manual ordering, panel/layout preferences, language/theme preferences, undo/redo state, and pending synchronization operations.
- The local workspace directory handle that you explicitly choose, when the workspace-file feature is used.

The extension does not intentionally persist ChatGPT message bodies or attachments as part of its Explorer workspace state. Chat contents and attachments remain managed by ChatGPT. Some ChatGPT endpoints used for synchronization may return additional response fields in memory; Ai Chat Explorer uses and stores only the information required for its organization and synchronization features.

## 3. Where information is stored

Ai Chat Explorer stores its state locally using browser extension storage (`chrome.storage.local`). A local directory handle may also be stored in IndexedDB when you choose a workspace folder.

If you enable and grant access to a local workspace folder, Ai Chat Explorer can write an account-scoped `workspace.<account fingerprint>.json` snapshot to that folder. This snapshot contains Explorer organization/index information such as Projects, folders, chat metadata, shortcuts, settings, and operation state. It is stored on your device in the folder you selected.

## 4. Communication with ChatGPT

Ai Chat Explorer is designed to run on `https://chatgpt.com/*` and communicates directly with ChatGPT using your existing authenticated browser session. Depending on the feature you use, it may read or update information such as:

- your current ChatGPT session identity;
- conversation metadata and titles;
- official Projects and Project membership;
- pin/star state;
- conversation moves, renames, archive/delete actions, or related synchronization operations initiated by you or by Explorer's synchronization logic.

These requests are sent directly between your browser and ChatGPT. They are subject to OpenAI's own terms and privacy practices.

## 5. Path markers and ChatGPT title data

The "Path markers" feature is enabled by default. When enabled, Ai Chat Explorer may append a marker such as `⟦CE:Folder/Subfolder⟧` to the official title of a ChatGPT conversation.

Because this marker becomes part of the official ChatGPT conversation title, the folder names contained in the marker are sent to and stored by ChatGPT as part of that title. This allows Explorer to reconstruct folder organization on another computer even without the original local workspace file.

You can disable future automatic path-marker writes in Ai Chat Explorer Settings. Disabling the setting does not automatically remove markers that were already written. Existing markers can be removed using the extension's path-marker removal feature.

Do not place sensitive information in Explorer folder names if you do not want that information included in ChatGPT conversation titles.

## 6. Data not sent to the developer

The current Ai Chat Explorer 1.0 code does not include developer-controlled telemetry, analytics, advertising SDKs, tracking pixels, crash-reporting services, or remote logging endpoints.

Ai Chat Explorer does not intentionally sell, rent, or transfer your Explorer workspace data or ChatGPT conversation data to Wzzz603 or to advertisers.

## 7. GitHub links

Ai Chat Explorer includes a link to the developer's GitHub profile. Opening that link navigates your browser to GitHub. Once you visit GitHub, GitHub's own terms, cookies, logging, and privacy practices apply. The extension does not need to send your ChatGPT workspace data to GitHub in order to provide this link.

## 8. Permissions

Ai Chat Explorer currently requests:

- `storage`: to save extension state locally in the browser.
- host access to `https://chatgpt.com/*`: to display the Explorer interface on ChatGPT and to read/update ChatGPT metadata required by the features you use.

The extension does not request broad access to unrelated websites.

## 9. Data retention and deletion

Local extension state remains on your device until it is overwritten, cleared, or the extension/browser profile data is removed. Workspace JSON snapshots remain in the local folder you selected until you delete them.

Conversation titles or other information already written to ChatGPT are stored according to ChatGPT/OpenAI's systems and policies. Removing Ai Chat Explorer does not automatically remove information already stored by ChatGPT, including previously written path markers.

## 10. Security

Ai Chat Explorer attempts to keep account workspaces separated and stores its organization state locally. No browser extension can guarantee absolute security. You are responsible for protecting access to your browser profile, computer, ChatGPT account, and any local workspace folder you choose.

## 11. Children

Ai Chat Explorer is not designed to independently collect information from children. Use of ChatGPT and the Chrome Web Store remains subject to the age requirements and policies of those services and applicable law.

## 12. Changes to this policy

This policy may be updated when Ai Chat Explorer's features, permissions, storage behavior, or data flows change. Material changes should be reflected in the published version of this file and, where applicable, in the Chrome Web Store privacy disclosures.

## 13. Contact

Project owner: Wzzz603  
GitHub: https://github.com/wzzz603

## 14. Third-party status

Ai Chat Explorer is an independent third-party extension and is not affiliated with, sponsored by, or endorsed by OpenAI. OpenAI, ChatGPT, Chrome, GitHub, and related names and marks belong to their respective owners.
