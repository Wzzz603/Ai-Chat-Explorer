# Ai Chat Explorer

**Ai Chat Explorer 1.0** is a browser extension for the ChatGPT web app that provides an Explorer-style way to organize large numbers of chats and Projects.  
**Ai Chat Explorer 1.0** 是一个面向 ChatGPT 网页端的浏览器扩展，为大量聊天和 Project 提供更接近文件资源管理器的组织方式。

<img width="2880" height="1430" alt="main" src="https://github.com/user-attachments/assets/9429778a-0a47-4996-be50-bca4bf611671" />


**Author:** [@Wzzz603](https://github.com/wzzz603)  
**作者：** [@Wzzz603](https://github.com/wzzz603)

**Version:** 1.0  
**版本：** 1.0

**License:** [Ai Chat Explorer Proprietary Software License v1.0](LICENSE)  
**许可：** [Ai Chat Explorer Proprietary Software License v1.0](LICENSE)

**Privacy:** [Privacy Policy](PRIVACY.md)  
**隐私：** [隐私政策](PRIVACY.md)

> Ai Chat Explorer is an independently developed third-party browser extension and is not affiliated with, sponsored by, partnered with, or endorsed by OpenAI.  
> Ai Chat Explorer 是独立开发的第三方浏览器扩展，与 OpenAI 无隶属、赞助、合作或官方认可关系。

---

## Overview / 简介

Ai Chat Explorer extends ChatGPT's native Project system with local multi-level folders, pinned chats, Quick Access, drag-and-drop ordering, background synchronization, and path-based recovery. It is designed to make large ChatGPT workspaces easier to manage in an Explorer-style interface.  
Ai Chat Explorer 在 ChatGPT 原有 Project 体系之上增加本地多级文件夹、置顶、快速访问、拖拽排序、后台同步和路径恢复等能力，帮助你像使用文件资源管理器一样管理大量 ChatGPT 对话。

The extension does not relocate or store the actual chat message content. Chat messages and attachments remain stored by ChatGPT. Ai Chat Explorer mainly maintains chat locations, local folder structure, ordering, layout, and related local state.  
扩展不会改变或另行保存聊天正文。聊天正文和附件仍由 ChatGPT 保存；Ai Chat Explorer 主要维护聊天位置、本地目录结构、排序、布局以及相关本地状态。

---

## Features / 主要功能

### Explorer-style chat management / 类文件资源管理器的聊天管理

- Uses official ChatGPT **Projects** as top-level directories.  
  将 ChatGPT 官方 **Project** 作为顶层目录。

- Creates arbitrary levels of **local subfolders** inside each Project.  
  可在每个 Project 内创建任意层级的**本地子文件夹**。

- Supports drag-and-drop movement of chats and folders.  
  支持聊天和文件夹拖拽移动。

- Supports moving an entire folder tree across Projects while synchronizing the official Project membership of the chats inside it.  
  支持整个文件夹跨 Project 移动，并同步其中聊天的官方 Project 归属。

- Supports cut / paste, rename, and deletion of local folders.  
  支持剪切 / 粘贴、重命名和删除本地文件夹。

- Supports multi-select and batch movement of chats.  
  支持聊天多选和批量移动。

- Supports Undo / Redo.  
  支持 Undo / Redo（撤销 / 重做）。

### Pinned, Quick Access, Chats, and Projects / 置顶、快速访问、聊天与项目

The Explorer navigation area contains the following sections:  
Explorer 左侧导航包含以下区域：

- **Pinned**: official ChatGPT pinned chats.  
  **置顶**：显示 ChatGPT 官方置顶聊天。

- **Quick Access**: frequently used Projects or local folders.  
  **快速访问**：固定常用 Project 或本地文件夹。

- **Chats**: current chat-related access.  
  **聊天**：当前聊天相关入口。

- **Projects**: all official Projects and local subfolders.  
  **项目**：浏览全部官方 Project 和本地子文件夹。

- **Unassigned**: regular chats that do not belong to any Project.  
  **未归项目**：显示尚未加入任何 Project 的普通聊天。

Pinned-chat display rules:  
置顶聊天显示规则：

- Unassigned + not pinned → shown only in **Unassigned**.  
  未归项目聊天 + 未置顶 → 仅显示在“未归项目”。

- Unassigned + pinned → shown only in **Pinned**.  
  未归项目聊天 + 已置顶 → 仅显示在“置顶”。

- Project chat + not pinned → shown only in its Project.  
  Project 内聊天 + 未置顶 → 仅显示在所属 Project。

- Project chat + pinned → shown in both **Pinned** and its original Project.  
  Project 内聊天 + 已置顶 → 同时显示在“置顶”和所属 Project。

### Background synchronization / 后台同步

Ai Chat Explorer reads and synchronizes Projects, chat membership, and pinned state for the currently signed-in ChatGPT account.  
Ai Chat Explorer 会读取并同步当前 ChatGPT 账号中的 Project、聊天归属和置顶状态。

- Official pin changes can be reflected automatically in Explorer.  
  官方置顶变化可自动同步到 Explorer。

- Creating Projects, moving chats, and pinning / unpinning are performed in the background whenever possible.  
  创建 Project、移动聊天、置顶 / 取消置顶等操作优先在后台完成。

- The extension does not normally rely on visible UI automation such as opening menus or switching the current chat page.  
  默认不会依赖模拟点击菜单、切换聊天页面等可见 UI 操作。

- Batch operations are queued in the background so the local Explorer interface can respond first and synchronize the official state afterward.  
  批量操作进入后台队列，本地界面先响应，再同步官方状态。

> ChatGPT's internal web endpoints are not a public stable API. If ChatGPT changes its website structure or internal endpoints, some synchronization features may require an Ai Chat Explorer update.  
> ChatGPT 网页内部接口并不是公开稳定 API。如果 ChatGPT 后续调整网页结构或内部接口，部分同步功能可能需要随 Ai Chat Explorer 更新。

### Path markers and cross-computer recovery / 路径标识与跨电脑恢复

Ai Chat Explorer can append the local folder path to the end of an official ChatGPT conversation title, for example:  
Ai Chat Explorer 可将本地文件夹路径写入 ChatGPT 官方聊天标题末尾，例如：

```text
Chat title ⟦CE:Research/Code/Model Training⟧
聊天标题 ⟦CE:博士论文/代码/模型训练⟧
```

When path markers are enabled:  
开启路径标识后：

- Moving or renaming local folders can update the path marker in the official chat title.  
  移动或重命名本地文件夹时，可同步更新聊天标题中的路径标识。

- On another computer, the local folder structure can be reconstructed from the path markers even if the original local workspace file is unavailable.  
  换电脑后，即使没有原电脑的本地 workspace 文件，也可根据标题中的路径标识重新恢复目录划分。

- Path markers can be written or removed in batches.  
  可以手动批量写入或移除路径标识。

Path markers are enabled by default and can be disabled under **Settings → Path Markers**.  
路径标识默认开启，可在 **设置 → 路径标识** 中关闭。

> A path marker becomes part of the official ChatGPT conversation title. Folder names contained in the marker are therefore stored by ChatGPT. Do not use sensitive information in folder names if you do not want it to appear in ChatGPT conversation titles.  
> 路径标识会成为 ChatGPT 官方聊天标题的一部分，因此路径中的文件夹名称会保存到 ChatGPT。请不要在文件夹名称中加入不希望出现在 ChatGPT 标题中的敏感信息。

### Manual Project and folder ordering / Project 与文件夹手动排序

- Projects can be reordered freely by drag and drop.  
  Project 可通过拖拽自由调整显示顺序。

- Folders at the same level can be reordered manually.  
  同一级子文件夹可自由排序。

- Drop near the top or bottom edge of a sibling folder to reorder.  
  拖到同级文件夹上 / 下边缘表示调整顺序。

- Drop in the middle of a folder to move into that folder.  
  拖到文件夹中间表示移动进入该文件夹。

- Manual ordering is persisted and is not replaced by automatic alphabetical sorting after synchronization.  
  排序结果会持久保存，不会因为同步自动恢复为名称排序。

### Adjustable interface / 可调界面

- The overall Explorer width can be resized.  
  Explorer 整体宽度可调整。

- The divider between the navigation pane and content pane can be dragged to resize both areas.  
  左侧导航与右侧内容区之间可拖动分隔条调整宽度。

- The heights of the **Pinned / Quick Access / Chats / Projects** sections can be adjusted.  
  “置顶 / 快速访问 / 聊天 / 项目”各区域高度可调整。

- Projects and nested folders can be expanded and collapsed independently.  
  Project 和多级子文件夹支持独立展开 / 收起。

- Expansion state, pane widths, and layout settings are persisted.  
  展开状态、分栏宽度和布局设置会持久保存。

- When ChatGPT opens an official Settings, Share, Account, or similar dialog, Explorer remains visible while the official dialog is allowed to appear above it.  
  ChatGPT 打开设置、分享、账号等官方弹窗时，Explorer 保持显示，并让官方弹窗显示在更高层级。

- Supports light mode, dark mode, or following the current ChatGPT theme.  
  支持浅色、深色或跟随 ChatGPT 主题。

### Create Projects and new chats / 新建 Project 与新聊天

- Create new official ChatGPT Projects directly from Explorer.  
  可直接从 Explorer 创建新的 ChatGPT 官方 Project。

- Create a new chat for a selected Project, local folder, or Unassigned location.  
  可在指定 Project、文件夹或“未归项目”位置创建新聊天。

- After the first message is sent, the new chat can automatically be placed in the preselected location.  
  新聊天发送第一条消息后，可自动归入预先指定的位置。

---

## Settings / 设置

Open **⚙ Settings** at the top of Explorer.  
点击 Explorer 顶部的 **⚙ 设置**。

### Path Markers / 路径标识

Enabled by default.  
默认开启。

When disabled:  
关闭后：

- New automatic `⟦CE:path⟧` writes and updates stop.  
  不再对后续聊天自动写入或更新 `⟦CE:路径⟧`。

- Existing path markers are not automatically removed in bulk.  
  不会自动批量删除已经存在的路径标识。

- Existing path markers can still be read for folder recovery.  
  已存在的路径标识仍可用于目录恢复。

To clean existing markers, use the **Remove Path Markers** function in Explorer.  
如需清理旧标识，可使用 Explorer 中的 **移除路径标识** 功能。

### Language / 语言

The default is **Follow ChatGPT**.  
默认选择 **跟随 ChatGPT**。

- Chinese ChatGPT interface → Explorer uses Chinese.  
  ChatGPT 中文界面 → Explorer 使用中文。

- English ChatGPT interface → Explorer uses English.  
  ChatGPT 英文界面 → Explorer 使用 English。

- Any other ChatGPT interface language → Explorer falls back to English.  
  其他语言 → Explorer 默认使用 English。

You can also manually lock the interface to Chinese or English.  
也可以手动固定为中文或 English。

### Appearance / 画面

The default is **Follow ChatGPT**.  
默认选择 **跟随 ChatGPT**。

Available options:  
支持以下选项：

- Follow ChatGPT  
  跟随 ChatGPT

- Light  
  浅色

- Dark  
  深色

When **Follow ChatGPT** is selected, Explorer follows later ChatGPT light / dark theme changes automatically.  
选择“跟随 ChatGPT”后，ChatGPT 切换浅色 / 深色时，Explorer 会同步变化。

---

## Local workspace / 本地工作区

On first use, Ai Chat Explorer asks you to choose a local workspace folder. The Explorer state for the current ChatGPT account is stored in a file such as:  
首次使用时，Ai Chat Explorer 会要求选择一个本地工作区文件夹，用于保存当前 ChatGPT 账号对应的 Explorer 状态文件：

```text
workspace.<account-fingerprint>.json
workspace.<账号指纹>.json
```

The workspace mainly contains:  
其中主要保存：

- Project and local-folder index  
  Project 与本地文件夹索引

- Chat location index  
  聊天位置索引

- Quick Access  
  快速访问

- Pinned-chat mapping  
  置顶映射

- Project / folder ordering  
  Project / 文件夹排序

- Expansion state and interface layout  
  展开状态和界面布局

- Undo / Redo information  
  Undo / Redo 信息

- Pending synchronization operations  
  待同步操作

- Explorer settings  
  Explorer 设置

**Chat message bodies and attachments are not saved in the workspace file. They remain stored by ChatGPT.**  
**聊天正文和附件不会保存到 workspace 文件中，它们仍由 ChatGPT 保存。**

Different ChatGPT accounts use separate Explorer state to avoid mixing workspaces between accounts.  
不同 ChatGPT 账号使用独立的 Explorer 状态，避免工作区互相混用。

---

## Installation / 安装

### Chrome Web Store / Chrome 网上应用店

Once Ai Chat Explorer is published on the Chrome Web Store, it can be installed and updated directly from the store.  
Ai Chat Explorer 在 Chrome Web Store 发布后，可直接通过商店安装和更新。

### Manual installation from GitHub / 从 GitHub 手动安装

1. Download and extract an Ai Chat Explorer release package.  
   下载 Ai Chat Explorer 发布包并解压。

2. Open the following address in Chrome.  
   在 Chrome 地址栏打开：

```text
chrome://extensions/
```

3. Enable **Developer mode** in the upper-right corner.  
   打开右上角 **开发者模式**。

4. Click **Load unpacked**.  
   点击 **加载已解压的扩展程序**。

5. Select the Ai Chat Explorer directory containing `manifest.json`.  
   选择包含 `manifest.json` 的 Ai Chat Explorer 目录。

6. Open or refresh `https://chatgpt.com/`.  
   打开或刷新 `https://chatgpt.com/`。

7. Choose a local workspace folder on first launch.  
   首次运行时选择本地工作区文件夹。

To update a manually installed version, replace the extension files, click **Reload** in `chrome://extensions/`, and then refresh ChatGPT.  
升级手动安装版本时，覆盖原扩展目录后，在 `chrome://extensions/` 点击 **重新加载**，再刷新 ChatGPT。

> Do not delete the existing `workspace.<account-fingerprint>.json` unless you are sure you no longer need its local folder structure and Explorer settings.  
> 不建议删除原来的 `workspace.<账号指纹>.json`，除非你确定不再需要其中保存的本地目录结构和 Explorer 设置。

---

## Basic usage / 基本使用

### Create a local folder / 创建本地文件夹

1. Select an official Project in the left navigation pane.  
   在左侧选择一个官方 Project。

2. Click **＋ New Folder**, or use the context menu on a Project / folder.  
   点击 **＋ 新建文件夹**，或使用 Project / 文件夹右键菜单。

3. The folder exists only inside Ai Chat Explorer and is used to organize ChatGPT conversations.  
   本地文件夹仅存在于 Ai Chat Explorer 中，用于组织 ChatGPT 聊天。

Local folders cannot be created under **Unassigned**.  
“未归项目”不能创建本地文件夹。

### Move chats / 移动聊天

You can:  
可以：

- Drag chats directly into a Project or local folder.  
  直接拖动聊天到 Project 或本地文件夹。

- Use cut / paste.  
  使用剪切 / 粘贴。

- Select multiple chats and drag them together.  
  多选多个聊天后一起拖动。

Explorer updates the local location immediately and synchronizes the official Project membership in the background.  
Explorer 会立即更新本地位置，官方 Project 归属在后台同步。

### Move folders / 移动文件夹

A folder can be moved to:  
文件夹可以移动到：

- Another local folder in the same Project.  
  同一 Project 的其他本地文件夹。

- Another official Project.  
  另一个官方 Project。

- A local folder inside another Project.  
  另一个 Project 内的本地文件夹。

Moving a whole folder also moves its descendant folders and the chats contained in the subtree.  
移动整个文件夹时，其后代文件夹和其中的聊天会一起迁移。

### Quick Access / 快速访问

Right-click a Project or local folder and choose **Pin to Quick Access** to make it directly available in the Quick Access section.  
右键 Project 或本地文件夹，选择 **固定到快速访问**，即可在左侧“快速访问”区域直接打开。

---

## Data and privacy / 数据与隐私

Ai Chat Explorer 1.0:  
Ai Chat Explorer 1.0：

- Does not include developer-controlled advertising SDKs.  
  不包含开发者控制的广告 SDK。

- Does not include third-party analytics services such as Google Analytics.  
  不包含 Google Analytics 等第三方分析服务。

- Does not send chat message bodies, attachments, or Explorer telemetry to Wzzz603.  
  不向 Wzzz603 发送聊天正文、附件或 Explorer 遥测数据。

- Stores Explorer state mainly in browser-local storage and in the workspace file selected by the user.  
  Explorer 状态主要保存在浏览器本地和用户自己选择的 workspace 文件中。

- Sends synchronization requests directly to `chatgpt.com`.  
  与 ChatGPT 的同步请求直接发送到 `chatgpt.com`。

See [PRIVACY.md](PRIVACY.md) for the full privacy policy.  
完整说明请阅读 [PRIVACY.md](PRIVACY.md)。

---

## Permissions / 权限

The extension currently uses:  
扩展当前使用：

```text
storage
https://chatgpt.com/*
```

- `storage`: stores local Explorer state.  
  `storage`：保存 Explorer 本地状态。

- `https://chatgpt.com/*`: reads and synchronizes Projects, chats, pinned state, and related information for the currently signed-in account.  
  `https://chatgpt.com/*`：读取和同步当前登录账号中的 Project、聊天、置顶等相关信息。

---

## License and copyright / 许可与版权

Copyright © 2026 Wzzz603. All rights reserved.  
版权所有 © 2026 Wzzz603。保留所有权利。

Ai Chat Explorer is distributed under the **Ai Chat Explorer Proprietary Software License v1.0**. It is not licensed under MIT, GPL, Apache, or another open-source license.  
Ai Chat Explorer 使用 **Ai Chat Explorer Proprietary Software License v1.0**，不是 MIT、GPL、Apache 等开源许可证。

Users may download, install, and normally use an unmodified copy of Ai Chat Explorer. Without authorization, users may not modify it, create derivative versions, repackage it, redistribute it, sell it, sublicense it, or commercially distribute Ai Chat Explorer itself.  
用户可以下载、安装并正常使用未经修改的 Ai Chat Explorer。未经授权，不得修改、制作衍生版本、重新打包、重新发布、出售、再许可或将 Ai Chat Explorer 本身用于商业分发。

See [LICENSE](LICENSE) and [COPYRIGHT.md](COPYRIGHT.md) for the complete terms.  
完整条款请阅读 [LICENSE](LICENSE) 和 [COPYRIGHT.md](COPYRIGHT.md)。

---

## Author and feedback / 作者与反馈

**Wzzz603**  
**Wzzz603**

GitHub: [@Wzzz603](https://github.com/wzzz603)  
GitHub：[@Wzzz603](https://github.com/wzzz603)

If you find a bug, compatibility issue, or have a feature request, please submit an Issue through the GitHub repository.  
如发现 Bug、兼容性问题或有功能建议，可通过 GitHub 项目提交 Issue。

---

## Third-party notice / 第三方声明

Ai Chat Explorer is an independently developed third-party tool and is not affiliated with, sponsored by, partnered with, or endorsed by OpenAI.  
Ai Chat Explorer 是独立开发的第三方工具，与 OpenAI 没有隶属、赞助、合作或官方认可关系。

OpenAI, ChatGPT, Chrome, GitHub, and other names, logos, and trademarks belong to their respective owners.  
OpenAI、ChatGPT、Chrome、GitHub 及其他名称、标识和商标归其各自权利人所有。
