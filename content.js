(() => {
  'use strict';

  if (window.top !== window) return;
  if (document.getElementById('cgpt-explorer-host')) return;

  const STORAGE_PREFIX = 'cgptExplorerStateV11';
  const PREVIOUS_STORAGE_KEYS = ['cgptExplorerStateV10', 'cgptExplorerStateV9', 'cgptExplorerStateV8', 'cgptExplorerStateV7', 'cgptExplorerStateV6', 'cgptExplorerStateV5', 'cgptExplorerStateV4', 'cgptExplorerStateV3', 'cgptExplorerStateV2', 'cgptExplorerStateV1'];
  const LEGACY_MIGRATION_KEY = 'cgptExplorerLegacyMigrationOwnerV11';
  const LEGACY_HANDLE_KEY = 'workspaceDirectory';
  const HANDLE_KEY_PREFIX = 'workspaceDirectoryV11_';
  const PROJECT_LINK_SELECTOR = 'a[href*="/g/g-p-"]';
  const PROJECT_HREF_PATTERN = /\/g\/(g-p-[^/?#]+)/;
  const CANONICAL_PROJECT_ID_PATTERN = /g-p-[0-9a-f]{32}/i;
  const AUTO_FULL_SYNC_MS = 3 * 60 * 1000;
  const AUTO_PROJECT_SYNC_MS = 45 * 1000;
  const DOM_PIN_SYNC_DEBOUNCE_MS = 180;
  const DOM_PROJECT_SYNC_DEBOUNCE_MS = 900;
  const FULL_SYNC_CONCURRENCY = 5;
  const MEMBERSHIP_REFRESH_DEBOUNCE_MS = 700;
  const ALLOW_VISIBLE_UI_FALLBACK = false;
  const PIN_STATE_SCHEMA_VERSION = 2;
  const SETTINGS_SCHEMA_VERSION = 1;
  const APP_NAME = 'Ai Chat Explorer';
  const APP_VERSION = '1.0';
  const AUTHOR_HANDLE = '@Wzzz603';
  const AUTHOR_URL = 'https://github.com/wzzz603';
  const PATH_MARKER_PREFIX = '⟦CE:';
  const PATH_MARKER_SUFFIX = '⟧';
  const PATH_MARKER_RE = /\s*⟦CE:([^⟧]*)⟧\s*$/u;
  const UNASSIGNED_PROJECT_ID = '__cgpt_unassigned__';

  const defaultState = {
    initialized: false,
    workspaceName: '',
    projects: [],
    folders: [],
    chats: [],
    quickAccess: [],
    pinnedChats: [],
    pinStateSchemaVersion: PIN_STATE_SCHEMA_VERSION,
    navSectionRatios: { pinned: 0.16, quick: 0.22, chats: 0.14, projects: 0.48 },
    navCollapsedKeys: [],
    navPaneWidth: 230,
    projectOrder: [],
    folderOrders: {},
    settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
    settings: { pathMarkersEnabled: true, language: 'auto', theme: 'auto' },
    selectedProjectId: null,
    selectedFolderId: null,
    panelOpen: false,
    panelWidth: 760,
    viewMode: 'details',
    sortBy: 'name',
    sortDirection: 'asc',
    searchQuery: '',
    shortcuts: [],
    clipboard: null,
    stateRevision: 0,
    localJournal: [],
    lastProjectSyncAt: null,
    lastFullSyncAt: null,
    pendingOperations: [],
    accountIdentity: null,
    undoStack: [],
    redoStack: [],
    pendingNewChatTarget: null
  };

  let state = structuredClone(defaultState);
  let host, shadow, panel, treeEl, contentEl, breadcrumbEl, statusEl, wizardEl, contextMenuEl, navPaneEl, workspaceBodyEl;
  let activeTreeDrag = null;
  let mutationTimer = null;
  let projectMutationTimer = null;
  let modalMutationTimer = null;
  let membershipRefreshTimer = null;
  let autoTimer = null;
  let selectedEntry = null;
  let selectedChatIds = new Set();
  let selectionAnchorChatId = null;
  let navBackStack = [];
  let navForwardStack = [];
  let accessTokenCache = { token: null, expiresAt: 0, accountFingerprint: null };
  let sessionCache = { data: null, fetchedAt: 0 };
  let currentAccountIdentity = null;
  let currentStorageKey = null;
  let historyBaseline = null;
  let applyingHistory = false;
  let accountCheckTimer = null;
  let syncing = false;
  let processingOfficialQueue = false;
  let pinSyncPromise = null;
  let currentOfficialOperationId = null;
  let lastObservedUrl = location.href;
  let marqueeState = null;
  let lastDomProjectSignature = '';
  let lastDomPinSignature = '';
  let officialModalSuspended = false;
  const pendingMembershipRefreshProjects = new Set();
  let pendingMembershipRefreshUnassigned = false;

  function uid(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSettings(value) {
    const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      pathMarkersEnabled: src.pathMarkersEnabled !== false,
      language: ['auto','zh-CN','en'].includes(src.language) ? src.language : 'auto',
      theme: ['auto','light','dark'].includes(src.theme) ? src.theme : 'auto'
    };
  }

  function detectChatGPTLanguage() {
    const raw = normalizeText(document.documentElement?.lang || document.body?.getAttribute?.('lang') || navigator.language || '').toLowerCase();
    if (raw.startsWith('zh')) return 'zh-CN';
    if (raw.startsWith('en')) return 'en';
    return 'en';
  }

  function effectiveLanguage() {
    const mode = normalizeSettings(state.settings).language;
    return mode === 'auto' ? detectChatGPTLanguage() : mode;
  }

  function detectChatGPTTheme() {
    const html = document.documentElement;
    const body = document.body;
    const explicit = normalizeText(html?.getAttribute?.('data-theme') || body?.getAttribute?.('data-theme') || '').toLowerCase();
    if (/dark/.test(explicit)) return 'dark';
    if (/light/.test(explicit)) return 'light';
    if (html?.classList?.contains('dark') || body?.classList?.contains('dark')) return 'dark';
    if (html?.classList?.contains('light') || body?.classList?.contains('light')) return 'light';
    try {
      const scheme = String(getComputedStyle(html).colorScheme || '').toLowerCase();
      if (scheme === 'dark') return 'dark';
      if (scheme === 'light') return 'light';
      for (const el of [body, html].filter(Boolean)) {
        const bg = getComputedStyle(el).backgroundColor;
        const match = bg.match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\D+([0-9.]+))?/i);
        if (!match) continue;
        const r=Number(match[1]), g=Number(match[2]), b=Number(match[3]);
        const alpha = match[4] == null ? 1 : Number(match[4]);
        if (Number.isFinite(alpha) && alpha <= 0.05) continue;
        const luminance = 0.2126*r + 0.7152*g + 0.0722*b;
        if (Number.isFinite(luminance)) return luminance < 128 ? 'dark' : 'light';
      }
    } catch (_) {}
    return matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
  }

  function effectiveTheme() {
    const mode = normalizeSettings(state.settings).theme;
    return mode === 'auto' ? detectChatGPTTheme() : mode;
  }

  const I18N = {
    'zh-CN': {
      pinned:'置顶', quick:'快速访问', chats:'聊天', projects:'项目', unassigned:'未归项目',
      sync:'同步', settings:'设置', close:'关闭', back:'后退', forward:'前进', up:'上一级',
      searchPlaceholder:'搜索当前文件夹', sortBy:'排序依据', name:'名称', type:'类型', modified:'修改日期',
      details:'详细信息', small:'小图标', medium:'中图标', large:'大图标', xlarge:'超大图标',
      newChat:'新聊天', newProject:'新建项目', undo:'撤销', redo:'重做', cut:'剪切', paste:'粘贴',
      newFolder:'新建文件夹', currentChat:'当前聊天', writeMarkers:'写入路径标识', removeMarkers:'移除路径标识', permission:'工作区权限',
      chooseProject:'请在左侧选择“未归项目”或一个官方 Project。', chooseProjectShort:'请选择项目', noMatches:'没有匹配项。', empty:'这个位置目前是空的。',
      unassignedHint:'未归项目只显示普通聊天。', projectEmptyHint:'右键空白处可以新建聊天、新建文件夹或粘贴。', folder:'文件夹', conversation:'ChatGPT 对话', shortcut:'聊天快捷方式',
      pinEmpty:'右键聊天 → 官方置顶，会显示在这里', quickEmpty:'右键项目或文件夹可固定到这里', noProjects:'尚未读取到官方 Project', unnamed:'未命名聊天',
      expand:'展开', collapse:'收起', resizeSection:'拖动调整区域高度', resizePanes:'拖动调整左侧导航与右侧内容区域宽度',
      settingsTitle:'Ai Chat Explorer 设置', settingsSubtitle:'界面与路径恢复设置会随当前 ChatGPT 账号保存。',
      pathTitle:'路径标识', pathToggle:'开启路径标识', pathDesc:'开启后，位于本地子文件夹中的聊天会在官方标题末尾加入 ⟦CE:路径⟧。切换电脑后，即使没有原来的本地 workspace 文件，也可以从聊天标题恢复目录划分。默认开启。',
      pathOffNote:'关闭只停止后续自动写入/更新，不会批量删除已经存在的路径标识；已有标识仍可用于恢复目录。若要清理，请使用“移除路径标识”。',
      languageTitle:'语言', languageDesc:'默认跟随 ChatGPT。中文界面使用中文，英文界面使用 English；其他语言默认使用 English。', followChatGPT:'跟随 ChatGPT', chinese:'中文', english:'English',
      themeTitle:'画面', themeDesc:'默认读取 ChatGPT 当前画面。选择“跟随 ChatGPT”时，ChatGPT 切换浅色/深色后 Explorer 会同步变化。', light:'浅色', dark:'深色',
      aboutTitle:'关于', aboutProduct:'Ai Chat Explorer 1.0', authorTitle:'作者 / GitHub', copyrightTitle:'版权与使用声明', copyrightLine:'© 2026 Wzzz603. All rights reserved.', rightsNotice:'本软件采用专有许可：允许下载安装并正常使用未经修改的版本，但未经授权不得修改、制作衍生版本、重新打包、重新发布、出售、再许可或商业利用本软件本身。公开源码不等于开源授权。', thirdPartyNotice:'Ai Chat Explorer 是独立开发的第三方浏览器扩展，与 OpenAI 无隶属、赞助或官方认可关系。OpenAI、ChatGPT 及相关名称、商标和标识归其各自权利人所有。', licenseTitle:'软件许可', licenseSummary:'Ai Chat Explorer Proprietary Software License v1.0。保留全部未明确授予的权利。', privacyTitle:'隐私政策', privacySummary:'不向开发者发送聊天数据或遥测。扩展数据主要保存在本机；与 ChatGPT 的同步请求直接发送到 chatgpt.com。路径标识开启时，目录名称会作为聊天标题的一部分保存到 ChatGPT。', viewLicense:'查看 LICENSE', viewPrivacy:'查看隐私政策',
      settingsDone:'完成', initializedNeedWorkspace:'请选择本地工作区',
      wizardTitle:'创建本地工作区', chooseWorkspace:'选择工作区文件夹',
      wizardText:'选择一个 Windows 文件夹保存该 ChatGPT 账号专属的 workspace.<账号指纹>.json。聊天正文和附件仍保存在 ChatGPT；本插件只保存目录、索引和快速访问。',
      wizardNote:'官方 Project = 根目录。\n本地文件夹 = 无限层级目录。\n初始化后会自动读取每个官方 Project 中的聊天标题与 ID；若标题末尾带有 ⟦CE:路径⟧，会自动重建对应的本地子文件夹。',
      pathDisabled:'路径标识当前已关闭。请先在设置中开启；已有标识仍可使用“移除路径标识”清理。'
    },
    en: {
      pinned:'Pinned', quick:'Quick access', chats:'Chats', projects:'Projects', unassigned:'Unassigned',
      sync:'Sync', settings:'Settings', close:'Close', back:'Back', forward:'Forward', up:'Up',
      searchPlaceholder:'Search this folder', sortBy:'Sort by', name:'Name', type:'Type', modified:'Modified',
      details:'Details', small:'Small icons', medium:'Medium icons', large:'Large icons', xlarge:'Extra large icons',
      newChat:'New chat', newProject:'New project', undo:'Undo', redo:'Redo', cut:'Cut', paste:'Paste',
      newFolder:'New folder', currentChat:'Current chat', writeMarkers:'Write path markers', removeMarkers:'Remove path markers', permission:'Workspace permission',
      chooseProject:'Select Unassigned or an official Project on the left.', chooseProjectShort:'Select a project', noMatches:'No matching items.', empty:'This location is empty.',
      unassignedHint:'Unassigned shows ordinary, non-pinned chats only.', projectEmptyHint:'Right-click empty space to create a chat/folder or paste.', folder:'Folder', conversation:'ChatGPT conversation', shortcut:'Chat shortcut',
      pinEmpty:'Right-click a chat → Pin to show it here', quickEmpty:'Right-click a project or folder to pin it here', noProjects:'No official Projects loaded yet', unnamed:'Untitled chat',
      expand:'Expand', collapse:'Collapse', resizeSection:'Drag to resize sections', resizePanes:'Drag to resize navigation and content panes',
      settingsTitle:'Ai Chat Explorer Settings', settingsSubtitle:'Interface and path-recovery settings are saved for this ChatGPT account.',
      pathTitle:'Path markers', pathToggle:'Enable path markers', pathDesc:'When enabled, chats stored in local subfolders get a ⟦CE:path⟧ suffix in their official titles. On another computer, the folder structure can be reconstructed from those titles even without the original local workspace file. Enabled by default.',
      pathOffNote:'Turning this off only stops future automatic writes/updates. Existing markers are not bulk-deleted and can still be read for recovery. Use “Remove path markers” if you want to clean them up.',
      languageTitle:'Language', languageDesc:'Follows ChatGPT by default. Chinese uses 中文, English uses English, and any other ChatGPT language falls back to English.', followChatGPT:'Follow ChatGPT', chinese:'中文', english:'English',
      themeTitle:'Appearance', themeDesc:'Reads ChatGPT’s current appearance by default. In Follow ChatGPT mode, Explorer switches automatically when ChatGPT changes between light and dark.', light:'Light', dark:'Dark',
      aboutTitle:'About', aboutProduct:'Ai Chat Explorer 1.0', authorTitle:'Author / GitHub', copyrightTitle:'Copyright & use notice', copyrightLine:'© 2026 Wzzz603. All rights reserved.', rightsNotice:'This software is proprietary. You may download, install, and normally use unmodified copies, but you may not modify, create derivatives, repackage, republish, sell, sublicense, or commercially exploit the Software itself without permission. Public source visibility is not an open-source grant.', thirdPartyNotice:'Ai Chat Explorer is an independently developed third-party browser extension. It is not affiliated with, sponsored by, or endorsed by OpenAI. OpenAI, ChatGPT, and related names, trademarks, and marks belong to their respective owners.', licenseTitle:'Software license', licenseSummary:'Ai Chat Explorer Proprietary Software License v1.0. All rights not expressly granted are reserved.', privacyTitle:'Privacy policy', privacySummary:'No chat data or telemetry is sent to the developer. Explorer data is primarily stored locally; synchronization requests go directly to chatgpt.com. When path markers are enabled, folder names become part of the ChatGPT conversation title.', viewLicense:'View LICENSE', viewPrivacy:'View Privacy Policy',
      settingsDone:'Done', initializedNeedWorkspace:'Choose a local workspace',
      wizardTitle:'Create local workspace', chooseWorkspace:'Choose workspace folder',
      wizardText:'Choose a Windows folder for this ChatGPT account’s workspace.<account fingerprint>.json. Chat contents and attachments stay in ChatGPT; the extension stores only folders, indexes and Quick access.',
      wizardNote:'Official Project = root folder.\nLocal folder = unlimited nesting.\nAfter initialization, chats are indexed from every official Project. A trailing ⟦CE:path⟧ marker can rebuild local subfolders automatically.',
      pathDisabled:'Path markers are disabled. Enable them in Settings first; existing markers can still be cleaned with “Remove path markers”.'
    }
  };

  function t(key) {
    const lang = effectiveLanguage();
    return I18N[lang]?.[key] ?? I18N.en[key] ?? key;
  }

  function applyTheme() {
    if (!host) return;
    const theme = effectiveTheme();
    host.setAttribute('data-ce-theme', theme);
    panel?.setAttribute('data-ce-theme', theme);
  }

  function setText(id, value) {
    const el = shadow?.getElementById(id);
    if (el) el.textContent = value;
  }

  function applyStaticUiLocalization() {
    if (!shadow) return;
    setText('syncAll', `↻ ${t('sync')}`);
    const syncAll = shadow.getElementById('syncAll'); if (syncAll) syncAll.title = t('sync');
    const settingsBtn = shadow.getElementById('settingsBtn'); if (settingsBtn) { settingsBtn.title = t('settings'); settingsBtn.setAttribute('aria-label', t('settings')); }
    const closeBtn = shadow.getElementById('close'); if (closeBtn) closeBtn.title = t('close');
    const back = shadow.getElementById('back'); if (back) back.title = t('back');
    const forward = shadow.getElementById('forward'); if (forward) forward.title = t('forward');
    const up = shadow.getElementById('up'); if (up) up.title = t('up');
    const splitter = shadow.getElementById('workspaceSplitter'); if (splitter) splitter.title = t('resizePanes');
    const search = shadow.getElementById('searchInput'); if (search) search.placeholder = t('searchPlaceholder');
    const sortBy = shadow.getElementById('sortBy'); if (sortBy) sortBy.title = t('sortBy');
    const optionText = (selectId, map) => { const sel=shadow.getElementById(selectId); if(!sel)return; for(const [value,key] of Object.entries(map)){ const opt=sel.querySelector(`option[value="${value}"]`); if(opt)opt.textContent=t(key); } };
    optionText('sortBy', {name:'name',type:'type',date:'modified'});
    optionText('viewMode', {details:'details',small:'small',medium:'medium',large:'large',xlarge:'xlarge'});
    setText('newChatBtn', `＋ ${t('newChat')}`); setText('newProjectBtn', `＋ ${t('newProject')}`);
    setText('undoBtn', `↶ ${t('undo')}`); setText('redoBtn', `↷ ${t('redo')}`); setText('cutBtn', t('cut')); setText('pasteBtn', t('paste'));
    setText('newFolder', `＋ ${t('newFolder')}`); setText('addChat', `＋ ${t('currentChat')}`); setText('writeMarkers', t('writeMarkers')); setText('removeMarkers', t('removeMarkers')); setText('permission', t('permission'));
    const write = shadow.getElementById('writeMarkers'); if (write) write.disabled = !normalizeSettings(state.settings).pathMarkersEnabled;
    setText('wizardTitle', t('wizardTitle')); setText('wizardText', t('wizardText')); setText('chooseWorkspace', t('chooseWorkspace')); setText('wizardNote', t('wizardNote'));
    renderSettingsControls();
  }

  function refreshHostPreferences() {
    if (normalizeSettings(state.settings).language === 'auto') {
      applyStaticUiLocalization();
      if (state.initialized) { renderNavigationTree(); renderContentPane(); renderBreadcrumb(); }
    }
    if (normalizeSettings(state.settings).theme === 'auto') applyTheme();
  }

  function renderSettingsControls() {
    if (!shadow) return;
    const settings = normalizeSettings(state.settings);
    const pathToggle = shadow.getElementById('settingsPathMarkers'); if (pathToggle) pathToggle.checked = settings.pathMarkersEnabled;
    const language = shadow.getElementById('settingsLanguage'); if (language) language.value = settings.language;
    const theme = shadow.getElementById('settingsTheme'); if (theme) theme.value = settings.theme;
    setText('settingsTitle', t('settingsTitle')); setText('settingsSubtitle', t('settingsSubtitle'));
    setText('settingsPathTitle', t('pathTitle')); setText('settingsPathToggleLabel', t('pathToggle')); setText('settingsPathDesc', t('pathDesc')); setText('settingsPathOffNote', t('pathOffNote'));
    setText('settingsLanguageTitle', t('languageTitle')); setText('settingsLanguageDesc', t('languageDesc'));
    setText('settingsThemeTitle', t('themeTitle')); setText('settingsThemeDesc', t('themeDesc')); setText('settingsDone', t('settingsDone'));
    setText('settingsAboutTitle', t('aboutTitle')); setText('settingsAboutProduct', t('aboutProduct')); setText('settingsAuthorTitle', t('authorTitle')); setText('settingsCopyrightTitle', t('copyrightTitle')); setText('settingsCopyrightLine', t('copyrightLine')); setText('settingsRightsNotice', t('rightsNotice')); setText('settingsThirdPartyNotice', t('thirdPartyNotice')); setText('settingsLicenseTitle', t('licenseTitle')); setText('settingsLicenseSummary', t('licenseSummary')); setText('settingsPrivacyTitle', t('privacyTitle')); setText('settingsPrivacySummary', t('privacySummary')); setText('settingsViewLicense', t('viewLicense')); setText('settingsViewPrivacy', t('viewPrivacy'));
    const setOpt = (id,value,text) => { const sel=shadow.getElementById(id); const opt=sel?.querySelector(`option[value="${value}"]`); if(opt)opt.textContent=text; };
    setOpt('settingsLanguage','auto',t('followChatGPT')); setOpt('settingsLanguage','zh-CN',t('chinese')); setOpt('settingsLanguage','en',t('english'));
    setOpt('settingsTheme','auto',t('followChatGPT')); setOpt('settingsTheme','light',t('light')); setOpt('settingsTheme','dark',t('dark'));
  }

  function openSettings() {
    const overlay = shadow?.getElementById('settingsOverlay');
    if (!overlay) return;
    renderSettingsControls();
    overlay.hidden = false;
  }

  function closeSettings() {
    const overlay = shadow?.getElementById('settingsOverlay');
    if (overlay) overlay.hidden = true;
  }

  function escapeMarkerSegment(value) {
    return String(value || '')
      .replaceAll('%', '%25')
      .replaceAll('/', '%2F')
      .replaceAll('⟧', '%E2%9F%A7');
  }

  function unescapeMarkerSegment(value) {
    return String(value || '')
      .replaceAll('%E2%9F%A7', '⟧')
      .replaceAll('%2F', '/')
      .replaceAll('%25', '%');
  }

  function parsePathMarker(title) {
    const raw = normalizeText(title);
    const match = raw.match(PATH_MARKER_RE);
    if (!match) return { baseTitle: raw, hasMarker: false, path: [] };
    const baseTitle = normalizeText(raw.slice(0, match.index));
    const path = String(match[1] || '')
      .split('/')
      .filter(Boolean)
      .map(unescapeMarkerSegment)
      .map(normalizeText)
      .filter(Boolean);
    return { baseTitle: baseTitle || '未命名聊天', hasMarker: true, path };
  }

  function stripPathMarker(title) {
    return parsePathMarker(title).baseTitle;
  }

  function markerForFolder(folderId) {
    if (!normalizeSettings(state.settings).pathMarkersEnabled) return '';
    if (!folderId) return '';
    const parts = folderPath(folderId).map(escapeMarkerSegment).filter(Boolean);
    return parts.length ? ` ${PATH_MARKER_PREFIX}${parts.join('/')}${PATH_MARKER_SUFFIX}` : '';
  }


  function canonicalProjectId(value) {
    const raw = String(value || '');
    const match = raw.match(CANONICAL_PROJECT_ID_PATTERN);
    return match ? match[0].toLowerCase() : (raw.startsWith('g-p-') ? raw.split('/')[0] : raw || null);
  }

  function migrateCanonicalProjectIds() {
    const idMap = new Map();
    const merged = new Map();
    for (const project of Array.isArray(state.projects) ? state.projects : []) {
      const canonical = canonicalProjectId(project.id || project.url);
      if (!canonical) continue;
      idMap.set(project.id, canonical);
      const old = merged.get(canonical);
      merged.set(canonical, old ? { ...old, ...project, id: canonical } : { ...project, id: canonical });
    }
    state.projects = [...merged.values()];
    for (const folder of state.folders || []) {
      const canonical = canonicalProjectId(folder.projectId);
      if (canonical) folder.projectId = canonical;
    }
    for (const chat of state.chats || []) {
      const canonical = canonicalProjectId(chat.projectId);
      if (canonical) chat.projectId = canonical;
    }
    if (state.selectedProjectId) state.selectedProjectId = canonicalProjectId(state.selectedProjectId);
    state.quickAccess = (state.quickAccess || []).map(q => q.type === 'project' ? { ...q, id: canonicalProjectId(q.id) } : q);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function toEpoch(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return value > 1e12 ? value : value * 1000;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatDate(value) {
    const n = toEpoch(value);
    if (!n) return '';
    try {
      return new Intl.DateTimeFormat('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false
      }).format(new Date(n));
    } catch (_) {
      return '';
    }
  }


  function decodeJwtPayload(token) {
    try {
      const part = String(token || '').split('.')[1];
      if (!part) return {};
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(decodeURIComponent(escape(atob(padded))));
    } catch (_) { return {}; }
  }

  async function shortHash(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function getSessionData(force = false) {
    const now = Date.now();
    if (!force && sessionCache.data && now - sessionCache.fetchedAt < 4000) return sessionCache.data;
    const resp = await fetch('https://chatgpt.com/api/auth/session', { credentials: 'include', cache: 'no-store' });
    if (!resp.ok) throw new Error(`无法读取 ChatGPT 登录会话（HTTP ${resp.status}）`);
    const data = await resp.json();
    sessionCache = { data, fetchedAt: now };
    return data;
  }

  async function identityFromSession(data) {
    if (!data) return null;
    const claims = decodeJwtPayload(data.accessToken);
    const accountId = normalizeText(
      data?.account?.id || data?.user?.account_id || data?.user?.accountId ||
      claims['https://api.openai.com/auth.account_id'] || claims.account_id || ''
    );
    const userId = normalizeText(
      data?.user?.id || data?.user?.user_id ||
      claims['https://api.openai.com/auth.user.id'] || claims.user_id || claims.sub || ''
    );
    const fallback = normalizeText(data?.user?.email || data?.user?.name || '');
    const stable = accountId ? `account:${accountId}` : userId ? `user:${userId}` : fallback ? `fallback:${fallback}` : '';
    if (!stable) return null;
    const fingerprint = await shortHash(stable);
    return {
      fingerprint,
      idKind: accountId ? 'account_id' : userId ? 'user_id' : 'fallback',
      displayName: normalizeText(data?.user?.name || '') || 'ChatGPT 用户'
    };
  }

  async function getCurrentAccountIdentity(force = false) {
    const data = await getSessionData(force);
    return await identityFromSession(data);
  }

  function accountStorageKey(identity = currentAccountIdentity) {
    return identity?.fingerprint ? `${STORAGE_PREFIX}_${identity.fingerprint}` : null;
  }

  function accountHandleKey(identity = currentAccountIdentity) {
    return identity?.fingerprint ? `${HANDLE_KEY_PREFIX}${identity.fingerprint}` : null;
  }

  function workspaceFileName(identity = currentAccountIdentity) {
    return identity?.fingerprint ? `workspace.${identity.fingerprint}.json` : 'workspace.json';
  }

  function sameAccount(a, b) {
    return !!a?.fingerprint && !!b?.fingerprint && a.fingerprint === b.fingerprint;
  }

  async function verifyAccountBoundary(force = false) {
    const identity = await getCurrentAccountIdentity(force);
    if (!identity || !currentAccountIdentity) return !!identity;
    if (sameAccount(identity, currentAccountIdentity)) return true;
    try { await saveState({ snapshot: true }); } catch (_) {}
    accessTokenCache = { token: null, expiresAt: 0, accountFingerprint: null };
    sessionCache = { data: null, fetchedAt: 0 };
    if (statusEl) statusEl.textContent = '检测到 ChatGPT 账号已切换。正在切换到该账号自己的 Explorer 工作区…';
    setTimeout(() => location.reload(), 180);
    throw new Error('检测到 ChatGPT 账号切换，已停止当前账号操作');
  }

  function localHistorySnapshot() {
    return {
      folders: (state.folders || []).map(x => structuredClone(x)),
      chats: (state.chats || []).map(c => ({
        id:c.id, projectId:c.projectId || null, folderId:c.folderId || null,
        localName:c.localName || stripPathMarker(c.officialTitle || c.title || '未命名聊天'),
        url:c.url || null, source:c.source || null, createdAt:c.createdAt || null, updatedAt:c.updatedAt || null
      })),
      shortcuts: (state.shortcuts || []).map(x => structuredClone(x)),
      quickAccess: (state.quickAccess || []).map(x => structuredClone(x)),
      pinnedChats: (state.pinnedChats || []).map(id => ({ id })),
      manualOrders: [{ id:'nav-order', projectOrder:structuredClone(state.projectOrder || []), folderOrders:structuredClone(state.folderOrders || {}) }]
    };
  }

  function keyedDiff(beforeArr, afterArr, keyFn) {
    const before = new Map((beforeArr || []).map(x => [keyFn(x), x]));
    const after = new Map((afterArr || []).map(x => [keyFn(x), x]));
    const keys = new Set([...before.keys(), ...after.keys()]);
    const out = [];
    for (const key of keys) {
      const a = before.get(key) ?? null, b = after.get(key) ?? null;
      if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ key, before:a ? structuredClone(a) : null, after:b ? structuredClone(b) : null });
    }
    return out;
  }

  function historyDelta(before, after) {
    return {
      folders: keyedDiff(before?.folders, after?.folders, x => x.id),
      chats: keyedDiff(before?.chats, after?.chats, x => x.id),
      shortcuts: keyedDiff(before?.shortcuts, after?.shortcuts, x => x.id),
      quickAccess: keyedDiff(before?.quickAccess, after?.quickAccess, x => `${x.type}:${x.id}`),
      pinnedChats: keyedDiff(before?.pinnedChats, after?.pinnedChats, x => x.id),
      manualOrders: keyedDiff(before?.manualOrders, after?.manualOrders, x => x.id)
    };
  }

  function deltaHasChanges(delta) {
    return ['folders','chats','shortcuts','quickAccess','pinnedChats','manualOrders'].some(k => (delta?.[k] || []).length);
  }

  function replaceByDelta(collection, changes, targetSide, keyFn) {
    const map = new Map((collection || []).map(x => [keyFn(x), x]));
    for (const change of changes || []) {
      const target = change[targetSide];
      if (target == null) map.delete(change.key);
      else map.set(change.key, structuredClone(target));
    }
    return [...map.values()];
  }

  function applyHistoryEntry(entry, targetSide) {
    state.folders = replaceByDelta(state.folders, entry.delta?.folders, targetSide, x => x.id);
    const existingChatMap = new Map((state.chats || []).map(c => [c.id, c]));
    for (const change of entry.delta?.chats || []) {
      const target = change[targetSide];
      if (target == null) existingChatMap.delete(change.key);
      else existingChatMap.set(change.key, { ...(existingChatMap.get(change.key) || {}), ...structuredClone(target) });
    }
    state.chats = [...existingChatMap.values()];
    state.shortcuts = replaceByDelta(state.shortcuts, entry.delta?.shortcuts, targetSide, x => x.id);
    state.quickAccess = replaceByDelta(state.quickAccess, entry.delta?.quickAccess, targetSide, x => `${x.type}:${x.id}`);
    state.pinnedChats = replaceByDelta((state.pinnedChats || []).map(id => ({id})), entry.delta?.pinnedChats, targetSide, x => x.id).map(x => x.id);
    const manualOrders = replaceByDelta(
      [{ id:'nav-order', projectOrder:structuredClone(state.projectOrder || []), folderOrders:structuredClone(state.folderOrders || {}) }],
      entry.delta?.manualOrders,
      targetSide,
      x => x.id
    )[0];
    if (manualOrders) {
      state.projectOrder = Array.isArray(manualOrders.projectOrder) ? structuredClone(manualOrders.projectOrder) : [];
      state.folderOrders = manualOrders.folderOrders && typeof manualOrders.folderOrders === 'object' ? structuredClone(manualOrders.folderOrders) : {};
    }
  }

  function queueHistoryChatReconciliation(entry, targetSide) {
    for (const change of entry.delta?.chats || []) {
      const from = change[targetSide === 'before' ? 'after' : 'before'];
      const to = change[targetSide];
      if (!to) continue;
      const chat = getChat(change.key);
      if (!chat) continue;
      const desiredTitle = officialTitleForLocation(to.localName || chat.localName, to.folderId || null);
      chat.officialTitle = desiredTitle;
      chat.pendingOfficialSync = true;
      enqueueOfficialChatSync({
        conversationId: chat.id,
        sourceProjectId: from?.projectId || chat.projectId || UNASSIGNED_PROJECT_ID,
        targetProjectId: to.projectId || UNASSIGNED_PROJECT_ID,
        targetFolderId: to.folderId || null,
        desiredTitle,
        previousChat: from ? { ...chat, ...from } : null
      });
    }
  }

  function queueHistoryPinReconciliation(entry, targetSide) {
    for (const change of entry.delta?.pinnedChats || []) {
      const desired = change[targetSide] != null;
      const previous = change[targetSide === 'before' ? 'after' : 'before'] != null;
      enqueuePinOperation(change.key, desired, previous);
    }
  }

  async function undoLocalMutation() {
    const entry = state.undoStack?.pop();
    if (!entry) { if (statusEl) statusEl.textContent='没有可撤销的操作'; return; }
    applyingHistory = true;
    try {
      applyHistoryEntry(entry, 'before');
      cleanupRecoveredEmptyFolders();
      state.redoStack = Array.isArray(state.redoStack) ? state.redoStack : [];
      state.redoStack.push(entry);
      if (state.redoStack.length > 100) state.redoStack = state.redoStack.slice(-100);
      historyBaseline = localHistorySnapshot();
      state.stateRevision = Number(state.stateRevision || 0) + 1;
      state.localJournal.push({id:uid('j'),revision:state.stateRevision,type:'undo',details:{originalType:entry.type},at:new Date().toISOString()});
      render();
      persistStateSoon({ snapshot:true });
      queueHistoryChatReconciliation(entry, 'before');
      queueHistoryFolderPathReconciliation(entry);
      queueHistoryPinReconciliation(entry, 'before');
      if (statusEl) statusEl.textContent = `已撤销：${entry.label || entry.type}`;
    } finally { applyingHistory = false; }
  }

  async function redoLocalMutation() {
    const entry = state.redoStack?.pop();
    if (!entry) { if (statusEl) statusEl.textContent='没有可重做的操作'; return; }
    applyingHistory = true;
    try {
      applyHistoryEntry(entry, 'after');
      cleanupRecoveredEmptyFolders();
      state.undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
      state.undoStack.push(entry);
      if (state.undoStack.length > 100) state.undoStack = state.undoStack.slice(-100);
      historyBaseline = localHistorySnapshot();
      state.stateRevision = Number(state.stateRevision || 0) + 1;
      state.localJournal.push({id:uid('j'),revision:state.stateRevision,type:'redo',details:{originalType:entry.type},at:new Date().toISOString()});
      render();
      persistStateSoon({ snapshot:true });
      queueHistoryChatReconciliation(entry, 'after');
      queueHistoryFolderPathReconciliation(entry);
      queueHistoryPinReconciliation(entry, 'after');
      if (statusEl) statusEl.textContent = `已重做：${entry.label || entry.type}`;
    } finally { applyingHistory = false; }
  }

  async function loadState() {
    currentAccountIdentity = await getCurrentAccountIdentity(true);
    if (!currentAccountIdentity) {
      state = structuredClone(defaultState);
      return;
    }
    currentStorageKey = accountStorageKey(currentAccountIdentity);
    const keys = [currentStorageKey, LEGACY_MIGRATION_KEY, ...PREVIOUS_STORAGE_KEYS];
    const result = await chrome.storage.local.get(keys);
    let saved = result[currentStorageKey];

    if (!saved) {
      const legacyOwner = result[LEGACY_MIGRATION_KEY];
      if (!legacyOwner || legacyOwner === currentAccountIdentity.fingerprint) {
        for (const key of PREVIOUS_STORAGE_KEYS) {
          if (result[key]) { saved = result[key]; break; }
        }
        if (saved) {
          saved = { ...saved, accountIdentity: currentAccountIdentity };
          await chrome.storage.local.set({ [LEGACY_MIGRATION_KEY]: currentAccountIdentity.fingerprint });
          const legacyHandle = await globalThis.ChatGPTExplorerIDB.getHandle(LEGACY_HANDLE_KEY).catch(()=>null);
          if (legacyHandle) await globalThis.ChatGPTExplorerIDB.setHandle(accountHandleKey(), legacyHandle).catch(()=>{});
        }
      }
    }

    state = saved ? { ...structuredClone(defaultState), ...saved } : structuredClone(defaultState);
    if (state.accountIdentity?.fingerprint && state.accountIdentity.fingerprint !== currentAccountIdentity.fingerprint) {
      state = structuredClone(defaultState);
    }
    state.accountIdentity = currentAccountIdentity;
    state.projects = Array.isArray(state.projects) ? state.projects : [];
    state.folders = Array.isArray(state.folders) ? state.folders : [];
    state.chats = Array.isArray(state.chats) ? state.chats : [];
    state.quickAccess = Array.isArray(state.quickAccess) ? state.quickAccess : [];
    state.pinnedChats = Array.isArray(state.pinnedChats) ? state.pinnedChats : [];
    // 0.17.0 曾错误信任侧栏 DOM，可能把整个“未归项目”写入 pinnedChats。
    // 旧状态只清理一次；随后由官方 is_starred/pins API 重新建立真实置顶集合。
    const savedPinStateVersion = Number(saved?.pinStateSchemaVersion || 0);
    if (saved && savedPinStateVersion < PIN_STATE_SCHEMA_VERSION) {
      state.pinnedChats = [];
      for (const chat of state.chats || []) if (chat) chat.officialStarred = false;
    }
    state.pinStateSchemaVersion = PIN_STATE_SCHEMA_VERSION;
    state.navSectionRatios = normalizeNavSectionRatios(state.navSectionRatios);
    state.navCollapsedKeys = Array.isArray(state.navCollapsedKeys) ? [...new Set(state.navCollapsedKeys.map(String))] : [];
    state.navPaneWidth = Number.isFinite(Number(state.navPaneWidth)) ? Number(state.navPaneWidth) : 230;
    state.projectOrder = Array.isArray(state.projectOrder) ? [...new Set(state.projectOrder.map(x => canonicalProjectId(x) || String(x)).filter(Boolean))] : [];
    state.folderOrders = state.folderOrders && typeof state.folderOrders === 'object' && !Array.isArray(state.folderOrders) ? structuredClone(state.folderOrders) : {};
    state.settings = normalizeSettings(state.settings);
    state.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
    state.pendingOperations = Array.isArray(state.pendingOperations) ? state.pendingOperations : [];
    state.shortcuts = Array.isArray(state.shortcuts) ? state.shortcuts : [];
    state.localJournal = Array.isArray(state.localJournal) ? state.localJournal : [];
    state.undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
    state.redoStack = Array.isArray(state.redoStack) ? state.redoStack : [];
    state.stateRevision = Number(state.stateRevision || 0);
    if (state.clipboard?.mode !== 'cut') state.clipboard = null;
    state.sortBy = ['name','type','date'].includes(state.sortBy) ? state.sortBy : 'name';
    state.sortDirection = state.sortDirection === 'desc' ? 'desc' : 'asc';
    state.searchQuery = String(state.searchQuery || '');
    state.folders = state.folders.map(f => ({ ...f, projectId: f.projectId || null }));
    state.chats = state.chats.map(c => ({
      ...c, projectId: c.projectId || null, folderId: c.folderId || null,
      localName: c.localName || stripPathMarker(c.officialTitle || c.title || '未命名聊天')
    }));
    migrateCanonicalProjectIds();
    if (!Number.isFinite(state.panelWidth)) state.panelWidth = 760;
    if (!['details','small','medium','large','xlarge'].includes(state.viewMode)) state.viewMode = 'details';
    repairPendingOperationLocalTargets();
    state.pinnedChats = (state.pinnedChats || []).filter(id => getChat(id) && !getChat(id).lifecycleState);
    cleanupRecoveredEmptyFolders();
    historyBaseline = localHistorySnapshot();
    if (saved) await chrome.storage.local.set({ [currentStorageKey]: structuredClone(state) });
  }

  async function persistStateCopy(copy) {
    try {
      const response = await chrome.runtime.sendMessage({ type:'cgpt-explorer-persist', key:currentStorageKey, state:copy });
      if (!response?.ok) throw new Error(response?.error || 'background persist failed');
      return response;
    } catch (_) {
      // Service worker 被浏览器回收/重启时仍可直接落到 chrome.storage；写入前也做 revision 防倒退。
      const current = (await chrome.storage.local.get(currentStorageKey))[currentStorageKey];
      if (current && Number(current.stateRevision || 0) > Number(copy.stateRevision || 0)) {
        return { ok:true, ignored:true, reason:'stale-revision', fallback:true };
      }
      await chrome.storage.local.set({ [currentStorageKey]: copy });
      return { ok:true, fallback:true };
    }
  }

  async function saveState({ snapshot = true } = {}) {
    if (!currentStorageKey || !sameAccount(state.accountIdentity, currentAccountIdentity)) return;
    const copy = structuredClone(state);
    const result = await persistStateCopy(copy);
    if (!result?.ignored && snapshot && state.initialized) await writeWorkspaceSnapshot().catch(() => {});
  }

  function persistStateSoon({ snapshot = true } = {}) {
    if (!currentStorageKey || !sameAccount(state.accountIdentity, currentAccountIdentity)) return;
    const copy = structuredClone(state);
    persistStateCopy(copy)
      .then(result => !result?.ignored && snapshot && state.initialized ? writeWorkspaceSnapshot().catch(()=>{}) : null)
      .catch(()=>{});
  }

  function recordLocalMutation(type, details = {}, { snapshot = true, label = null, undoable = true } = {}) {
    const after = localHistorySnapshot();
    if (!applyingHistory && undoable) {
      const before = historyBaseline || after;
      const delta = historyDelta(before, after);
      if (deltaHasChanges(delta)) {
        state.undoStack = Array.isArray(state.undoStack) ? state.undoStack : [];
        state.undoStack.push({ id:uid('hist'), type, label:label || type, details:structuredClone(details), delta, at:new Date().toISOString() });
        if (state.undoStack.length > 100) state.undoStack = state.undoStack.slice(-100);
        state.redoStack = [];
      }
    }
    historyBaseline = after;
    state.stateRevision = Number(state.stateRevision || 0) + 1;
    state.localJournal.push({ id:uid('j'), revision:state.stateRevision, type, details, at:new Date().toISOString() });
    if (state.localJournal.length > 500) state.localJournal = state.localJournal.slice(-500);
    const ub=shadow?.getElementById('undoBtn'); if(ub) ub.disabled=!(state.undoStack||[]).length;
    const rb=shadow?.getElementById('redoBtn'); if(rb) rb.disabled=!(state.redoStack||[]).length;
    persistStateSoon({ snapshot });
  }

  function refreshHistoryBaselineAfterExternalSync() {
    if (!processingOfficialQueue && !(state.pendingOperations || []).length && !applyingHistory) historyBaseline = localHistorySnapshot();
  }

  async function ensureWorkspacePermission(handle) {
    if (!handle) return false;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  async function getWorkspaceHandle() {
    const key = accountHandleKey();
    if (!key) return null;
    const handle = await globalThis.ChatGPTExplorerIDB.getHandle(key);
    if (!handle) return null;
    return (await ensureWorkspacePermission(handle)) ? handle : null;
  }

  function serializableSnapshot() {
    return {
      schemaVersion: 16,
      app: APP_NAME,
      exportedAt: new Date().toISOString(),
      workspaceName: state.workspaceName,
      projects: state.projects,
      folders: state.folders,
      chats: state.chats,
      quickAccess: state.quickAccess,
      pinnedChats: state.pinnedChats,
      pinStateSchemaVersion: PIN_STATE_SCHEMA_VERSION,
      navSectionRatios: state.navSectionRatios,
      navCollapsedKeys: state.navCollapsedKeys,
      navPaneWidth: state.navPaneWidth,
      projectOrder: state.projectOrder,
      folderOrders: state.folderOrders,
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      settings: normalizeSettings(state.settings),
      shortcuts: state.shortcuts,
      clipboard: state.clipboard,
      stateRevision: state.stateRevision,
      localJournal: state.localJournal,
      pendingOperations: state.pendingOperations,
      accountIdentity: state.accountIdentity,
      undoStack: state.undoStack,
      redoStack: state.redoStack,
      pendingNewChatTarget: state.pendingNewChatTarget
    };
  }

  async function writeWorkspaceSnapshot() {
    const handle = await getWorkspaceHandle();
    if (!handle) return;
    const fileHandle = await handle.getFileHandle(workspaceFileName(), { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(serializableSnapshot(), null, 2));
    await writable.close();
  }

  async function readWorkspaceSnapshot(handle) {
    try {
      const fileHandle = await handle.getFileHandle(workspaceFileName());
      const file = await fileHandle.getFile();
      const data = JSON.parse(await file.text());
      return data && typeof data === 'object' ? data : null;
    } catch (_) {
      return null;
    }
  }

  function restoreSnapshot(data) {
    if (!data) return false;
    if (data.accountIdentity?.fingerprint && currentAccountIdentity?.fingerprint && data.accountIdentity.fingerprint !== currentAccountIdentity.fingerprint) return false;
    const useful = data.projects?.length || data.folders?.length || data.chats?.length || data.quickAccess?.length || data.pinnedChats?.length;
    if (!useful) return false;
    // 同一个工作区可能有“浏览器本地状态”和“workspace.json”两份。始终保留 revision 更高的那份，
    // 避免页面突然关闭导致磁盘快照稍旧，下一次反而把较新的浏览器状态覆盖掉。
    const incomingRevision = Number(data.stateRevision || 0);
    const currentRevision = Number(state.stateRevision || 0);
    const currentUseful = state.projects?.length || state.folders?.length || state.chats?.length || state.quickAccess?.length || state.pinnedChats?.length;
    if (currentUseful && currentRevision >= incomingRevision) return false;
    if (Array.isArray(data.projects)) state.projects = data.projects;
    if (Array.isArray(data.folders)) state.folders = data.folders.map(f => ({ ...f, projectId: f.projectId || null }));
    if (Array.isArray(data.chats)) {
      state.chats = data.chats.map(c => ({
        ...c,
        projectId: c.projectId || null,
        folderId: c.folderId || null,
        localName: c.localName || stripPathMarker(c.officialTitle || c.title || '未命名聊天')
      }));
    }
    if (Array.isArray(data.quickAccess)) state.quickAccess = data.quickAccess;
    if (Number(data.pinStateSchemaVersion || 0) >= PIN_STATE_SCHEMA_VERSION) {
      if (Array.isArray(data.pinnedChats)) state.pinnedChats = data.pinnedChats;
    } else {
      // 不恢复 0.17.0 及更早版本可能已被 DOM 扫描污染的置顶缓存。
      state.pinnedChats = [];
      for (const chat of state.chats || []) if (chat) chat.officialStarred = false;
    }
    state.pinStateSchemaVersion = PIN_STATE_SCHEMA_VERSION;
    state.navSectionRatios = normalizeNavSectionRatios(data.navSectionRatios || state.navSectionRatios);
    if (Array.isArray(data.navCollapsedKeys)) state.navCollapsedKeys = [...new Set(data.navCollapsedKeys.map(String))];
    if (Number.isFinite(Number(data.navPaneWidth))) state.navPaneWidth = Number(data.navPaneWidth);
    if (Array.isArray(data.projectOrder)) state.projectOrder = [...new Set(data.projectOrder.map(x => canonicalProjectId(x) || String(x)).filter(Boolean))];
    if (data.folderOrders && typeof data.folderOrders === 'object' && !Array.isArray(data.folderOrders)) state.folderOrders = structuredClone(data.folderOrders);
    if (data.settings && typeof data.settings === 'object') state.settings = normalizeSettings(data.settings);
    state.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
    if (Array.isArray(data.shortcuts)) state.shortcuts = data.shortcuts;
    if (data.clipboard && typeof data.clipboard === 'object') state.clipboard = data.clipboard;
    if (Number.isFinite(Number(data.stateRevision))) state.stateRevision = Number(data.stateRevision);
    if (Array.isArray(data.localJournal)) state.localJournal = data.localJournal;
    if (Array.isArray(data.pendingOperations)) state.pendingOperations = data.pendingOperations;
    if (Array.isArray(data.undoStack)) state.undoStack = data.undoStack;
    if (Array.isArray(data.redoStack)) state.redoStack = data.redoStack;
    if (data.pendingNewChatTarget && typeof data.pendingNewChatTarget === 'object') state.pendingNewChatTarget = data.pendingNewChatTarget;
    state.accountIdentity = currentAccountIdentity;
    migrateCanonicalProjectIds();
    repairPendingOperationLocalTargets();
    state.pinnedChats = (state.pinnedChats || []).filter(id => getChat(id) && !getChat(id).lifecycleState);
    cleanupRecoveredEmptyFolders();
    historyBaseline = localHistorySnapshot();
    return true;
  }

  function getProject(id) {
    if (id === UNASSIGNED_PROJECT_ID) {
      return { id: UNASSIGNED_PROJECT_ID, name: '未归项目', url: 'https://chatgpt.com/', source: 'virtual-unassigned', virtual: true };
    }
    return state.projects.find(p => p.id === id) || null;
  }

  function isUnassignedProject(id) {
    return id === UNASSIGNED_PROJECT_ID;
  }

  function getFolder(id) {
    return state.folders.find(f => f.id === id) || null;
  }

  function getChat(id) {
    return state.chats.find(c => c.id === id) || null;
  }

  function currentConversation() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    if (!match) return null;
    const id = match[1];
    const known = getChat(id);
    const leftItem = document.querySelector(`a[href*="/c/${CSS.escape(id)}"]`);
    let title = normalizeText(leftItem?.textContent);
    if (!title) title = known?.officialTitle || known?.localName || '';
    if (!title) title = document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
    if (!title || /^ChatGPT$/i.test(title)) title = '未命名聊天';
    const projectMatch = location.pathname.match(/\/g\/(g-p-[^/?#]+).*?\/c\//);
    const routeProjectId = canonicalProjectId(projectMatch?.[1]);
    // 置顶区的官方链接有时使用普通 /c/ID 路径，即使聊天真实属于 Project。
    // 对已经建立过官方索引的聊天，Project 归属以索引为准，不能仅凭当前 URL 降级成“未归项目”。
    const projectId = known?.projectId || routeProjectId || UNASSIGNED_PROJECT_ID;
    return {
      id,
      title,
      projectId,
      url: known?.url || location.href
    };
  }

  function folderPath(id) {
    const names = [];
    const seen = new Set();
    let cur = getFolder(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      names.unshift(cur.name);
      cur = cur.parentId ? getFolder(cur.parentId) : null;
    }
    return names;
  }

  function ensureFolderPath(projectId, pathParts) {
    projectId = canonicalProjectId(projectId);
    let parentId = null;
    for (const rawName of pathParts || []) {
      const name = normalizeText(rawName);
      if (!name) continue;
      let folder = state.folders.find(f =>
        canonicalProjectId(f.projectId) === projectId &&
        (f.parentId || null) === (parentId || null) &&
        f.name === name
      );
      if (!folder) {
        const now = new Date().toISOString();
        folder = {
          id: uid('folder'),
          name,
          projectId,
          parentId: parentId || null,
          createdAt: now,
          updatedAt: now,
          recoveredFromTitleMarker: true
        };
        state.folders.push(folder);
      }
      parentId = folder.id;
    }
    return parentId;
  }

  function projectOrderIds() {
    const validIds = new Set((state.projects || []).map(p => canonicalProjectId(p.id)).filter(Boolean));
    const ordered = [];
    const seen = new Set();
    for (const raw of state.projectOrder || []) {
      const id = canonicalProjectId(raw) || String(raw || '');
      if (!id || !validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      ordered.push(id);
    }
    const missing = (state.projects || [])
      .filter(p => !seen.has(canonicalProjectId(p.id)))
      .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
      .map(p => canonicalProjectId(p.id))
      .filter(Boolean);
    return [...ordered, ...missing];
  }

  function orderedProjects() {
    const rank = new Map(projectOrderIds().map((id, i) => [id, i]));
    return [...(state.projects || [])].sort((a,b) =>
      (rank.get(canonicalProjectId(a.id)) ?? Number.MAX_SAFE_INTEGER) - (rank.get(canonicalProjectId(b.id)) ?? Number.MAX_SAFE_INTEGER) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN')
    );
  }

  function folderOrderKey(projectId, parentId) {
    if (parentId) return `parent:${String(parentId)}`;
    return `root:${canonicalProjectId(projectId) || String(projectId || '')}`;
  }

  function siblingFolders(projectId, parentId) {
    if (isUnassignedProject(projectId)) return [];
    return state.folders.filter(f =>
      (f.projectId || null) === (projectId || null) && (f.parentId || null) === (parentId || null)
    );
  }

  function childFolders(projectId, parentId) {
    const siblings = siblingFolders(projectId, parentId);
    const stored = Array.isArray(state.folderOrders?.[folderOrderKey(projectId, parentId)])
      ? state.folderOrders[folderOrderKey(projectId, parentId)]
      : [];
    if (!stored.length) return siblings.sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    const valid = new Map(siblings.map(f => [f.id, f]));
    const out = [];
    const seen = new Set();
    for (const id of stored) {
      const folder = valid.get(String(id));
      if (!folder || seen.has(folder.id)) continue;
      out.push(folder); seen.add(folder.id);
    }
    const missing = siblings.filter(f => !seen.has(f.id)).sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
    return [...out, ...missing];
  }

  function removeFolderFromManualOrders(folderId) {
    if (!state.folderOrders || typeof state.folderOrders !== 'object') state.folderOrders = {};
    for (const key of Object.keys(state.folderOrders)) {
      if (!Array.isArray(state.folderOrders[key])) { delete state.folderOrders[key]; continue; }
      state.folderOrders[key] = state.folderOrders[key].map(String).filter(id => id !== String(folderId));
      if (!state.folderOrders[key].length) delete state.folderOrders[key];
    }
  }

  function appendFolderToManualOrder(folder) {
    if (!folder) return;
    if (!state.folderOrders || typeof state.folderOrders !== 'object') state.folderOrders = {};
    const key = folderOrderKey(folder.projectId, folder.parentId || null);
    const ids = childFolders(folder.projectId, folder.parentId || null).map(f => f.id).filter(id => id !== folder.id);
    state.folderOrders[key] = [...ids, folder.id];
  }

  function reorderProject(projectId, targetProjectId, position) {
    projectId = canonicalProjectId(projectId) || projectId;
    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    if (!projectId || !targetProjectId || projectId === targetProjectId) return false;
    const ids = projectOrderIds().filter(id => id !== projectId);
    const targetIndex = ids.indexOf(targetProjectId);
    if (targetIndex < 0) return false;
    ids.splice(targetIndex + (position === 'after' ? 1 : 0), 0, projectId);
    state.projectOrder = ids;
    renderNavigationTree();
    recordLocalMutation('project-reorder', { projectId, targetProjectId, position }, { snapshot:true, label:'调整项目顺序' });
    if (statusEl) statusEl.textContent = '已保存项目显示顺序';
    return true;
  }

  function reorderFolder(folderId, targetFolderId, position) {
    const folder = getFolder(folderId), target = getFolder(targetFolderId);
    if (!folder || !target || folder.id === target.id) return false;
    if (folder.projectId !== target.projectId || (folder.parentId || null) !== (target.parentId || null)) return false;
    const key = folderOrderKey(folder.projectId, folder.parentId || null);
    const ids = childFolders(folder.projectId, folder.parentId || null).map(f => f.id).filter(id => id !== folder.id);
    const targetIndex = ids.indexOf(target.id);
    if (targetIndex < 0) return false;
    ids.splice(targetIndex + (position === 'after' ? 1 : 0), 0, folder.id);
    if (!state.folderOrders || typeof state.folderOrders !== 'object') state.folderOrders = {};
    state.folderOrders[key] = ids;
    renderNavigationTree();
    recordLocalMutation('folder-reorder', { folderId, targetFolderId, position }, { snapshot:true, label:'调整文件夹顺序' });
    if (statusEl) statusEl.textContent = '已保存文件夹显示顺序';
    return true;
  }

  function chatsAt(projectId, folderId) {
    return state.chats
      .filter(c => {
        if (c.lifecycleState) return false;
        if ((c.projectId || null) !== (projectId || null) || (c.folderId || null) !== (folderId || null)) return false;
        // “未归项目”与“置顶”对普通聊天是互斥视图：未归项目聊天一旦置顶，
        // 只在“置顶”区展示；Project 内聊天置顶后仍保留在所属 Project 中。
        if (isUnassignedProject(projectId) && isPinnedChat(c.id)) return false;
        return true;
      })
      .sort((a, b) => {
        const ta = toEpoch(a.updateTime || a.updatedAt);
        const tb = toEpoch(b.updateTime || b.updatedAt);
        return tb - ta || (a.localName || '').localeCompare(b.localName || '', 'zh-CN');
      });
  }

  function shortcutsAt(projectId, folderId) {
    return (state.shortcuts || []).filter(s =>
      (s.projectId || null) === (projectId || null) && (s.folderId || null) === (folderId || null)
    );
  }

  function entryTypeLabel(kind) {
    return kind === 'folder' ? '文件夹' : kind === 'shortcut' ? '快捷方式' : 'ChatGPT 对话';
  }

  function compareEntries(a, b) {
    const dir = state.sortDirection === 'desc' ? -1 : 1;
    let av, bv;
    if (state.sortBy === 'date') {
      av = toEpoch(a.updatedAt || a.createdAt || a.updateTime);
      bv = toEpoch(b.updatedAt || b.createdAt || b.updateTime);
      return (av - bv) * dir || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
    }
    if (state.sortBy === 'type') {
      av = entryTypeLabel(a.kind); bv = entryTypeLabel(b.kind);
      return av.localeCompare(bv, 'zh-CN') * dir || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN') * dir;
    }
    av = String(a.name || ''); bv = String(b.name || '');
    return av.localeCompare(bv, 'zh-CN', { numeric: true, sensitivity: 'base' }) * dir;
  }

  function filteredEntries(projectId, folderId) {
    const q = normalizeText(state.searchQuery).toLowerCase();
    const entries = [];
    for (const f of (isUnassignedProject(projectId) ? [] : childFolders(projectId, folderId))) {
      entries.push({ kind:'folder', id:f.id, name:f.name, updatedAt:f.updatedAt, createdAt:f.createdAt, raw:f });
    }
    for (const c of chatsAt(projectId, isUnassignedProject(projectId) ? null : folderId)) {
      entries.push({ kind:'chat', id:c.id, name:c.localName, updatedAt:c.updatedAt, updateTime:c.updateTime, raw:c });
    }
    for (const sc of shortcutsAt(projectId, isUnassignedProject(projectId) ? null : folderId)) {
      const target = getChat(sc.targetChatId);
      entries.push({ kind:'shortcut', id:sc.id, name:sc.name || target?.localName || '聊天快捷方式', updatedAt:sc.updatedAt, createdAt:sc.createdAt, raw:sc, target });
    }
    return entries.filter(e => !q || String(e.name || '').toLowerCase().includes(q)).sort((a,b) => {
      // Windows 风格：文件夹优先，其余再按所选字段排序。
      if (a.kind === 'folder' && b.kind !== 'folder') return -1;
      if (b.kind === 'folder' && a.kind !== 'folder') return 1;
      return compareEntries(a,b);
    });
  }

  function getShortcut(id) { return (state.shortcuts || []).find(s => s.id === id) || null; }

  function isDescendantFolder(candidateParentId, folderId) {
    if (!candidateParentId) return false;
    return descendantFolderIds(folderId).has(candidateParentId);
  }

  function chatsInFolderSubtree(folderId) {
    if (!folderId) return [];
    const ids = descendantFolderIds(folderId);
    return state.chats.filter(chat => chat.folderId && ids.has(chat.folderId));
  }

  function previousChatMap(chats) {
    return new Map((chats || []).map(chat => [chat.id, structuredClone(chat)]));
  }

  function enqueuePathRefreshForChats(chats, previousById = null, reason = '路径变化') {
    let queued = 0;
    for (const chat of chats || []) {
      if (!chat?.id || !chat.projectId || isUnassignedProject(chat.projectId)) continue;
      const previousChat = previousById?.get?.(chat.id) || structuredClone(chat);
      const desiredTitle = officialTitleForLocation(
        chat.localName || stripPathMarker(chat.officialTitle || chat.title || '未命名聊天'),
        chat.folderId || null
      );
      if (normalizeText(chat.officialTitle || '') === normalizeText(desiredTitle) &&
          normalizeText(previousChat.officialTitle || '') === normalizeText(desiredTitle)) continue;
      chat.officialTitle = desiredTitle;
      chat.pendingOfficialSync = true;
      enqueueOfficialChatSync({
        conversationId: chat.id,
        sourceProjectId: chat.projectId,
        targetProjectId: chat.projectId,
        targetFolderId: chat.folderId || null,
        desiredTitle,
        previousChat
      });
      queued++;
    }
    if (queued && statusEl) statusEl.textContent = `${reason}：已更新本地路径，${queued} 条官方标题正在同步`;
    return queued;
  }

  function historyChangedFolderIds(entry) {
    return new Set((entry?.delta?.folders || []).map(change => change.key).filter(Boolean));
  }

  function chatTouchesAnyFolder(chat, folderIds) {
    if (!chat?.folderId || !folderIds?.size) return false;
    let current = getFolder(chat.folderId);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      if (folderIds.has(current.id)) return true;
      seen.add(current.id);
      current = current.parentId ? getFolder(current.parentId) : null;
    }
    return false;
  }

  function queueHistoryFolderPathReconciliation(entry) {
    const changedFolderIds = historyChangedFolderIds(entry);
    if (!changedFolderIds.size) return;
    const affected = state.chats.filter(chat => chatTouchesAnyFolder(chat, changedFolderIds));
    if (!affected.length) return;
    const previous = previousChatMap(affected);
    enqueuePathRefreshForChats(affected, previous, '撤销/重做后的目录路径');
  }

  function setClipboard(mode, items) {
    if (mode !== 'cut') return;
    state.clipboard = { mode:'cut', items, at: new Date().toISOString() };
    recordLocalMutation('clipboard-cut', { count: items.length }, { snapshot:false });
    if (statusEl) statusEl.textContent = `已剪切 ${items.length} 项；到目标目录按 Ctrl+V 或右键粘贴`;
  }

  function clipboardItemsForRow(kind, id) {
    if (kind === 'chat' && selectedChatIds.has(id) && selectedChatIds.size > 1) return [...selectedChatIds].map(cid => ({kind:'chat', id:cid}));
    return [{kind, id}];
  }

  async function moveFolderTree(folderId, targetProjectId, targetFolderId = null, options = {}) {
    const folder = getFolder(folderId);
    if (!folder) return { moved:false };
    if (!targetProjectId || isUnassignedProject(targetProjectId)) throw new Error('未归项目不能容纳本地文件夹');
    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    const targetFolder = targetFolderId ? getFolder(targetFolderId) : null;
    if (targetFolderId && (!targetFolder || targetFolder.projectId !== targetProjectId)) throw new Error('目标文件夹与目标 Project 不匹配');
    if (targetFolderId === folder.id || isDescendantFolder(targetFolderId, folder.id)) throw new Error('不能把文件夹移动到自身或自己的子文件夹中');

    const subtreeIds = descendantFolderIds(folder.id);
    const affectedChats = state.chats.filter(c => c.folderId && subtreeIds.has(c.folderId) && !c.lifecycleState);
    const previousChats = previousChatMap(affectedChats);
    const previousProjectId = folder.projectId;
    const previousParentId = folder.parentId || null;
    const now = new Date().toISOString();

    removeFolderFromManualOrders(folder.id);
    for (const f of state.folders) {
      if (!subtreeIds.has(f.id)) continue;
      f.projectId = targetProjectId;
      f.updatedAt = now;
    }
    folder.parentId = targetFolderId || null;
    appendFolderToManualOrder(folder);

    for (const chat of affectedChats) {
      const prev = previousChats.get(chat.id);
      chat.projectId = targetProjectId;
      chat.officialTitle = officialTitleForLocation(chat.localName || stripPathMarker(chat.officialTitle || '未命名聊天'), chat.folderId || null);
      chat.url = `https://chatgpt.com/g/${targetProjectId}/c/${chat.id}`;
      chat.updatedAt = now;
      chat.pendingOfficialSync = true;
      enqueueOfficialChatSync({
        conversationId:chat.id,
        sourceProjectId:prev?.projectId || previousProjectId || UNASSIGNED_PROJECT_ID,
        targetProjectId,
        targetFolderId:chat.folderId || null,
        desiredTitle:chat.officialTitle,
        previousChat:prev || null
      });
    }

    if (state.selectedFolderId && subtreeIds.has(state.selectedFolderId)) state.selectedProjectId = targetProjectId;
    if (options.recordHistory !== false) {
      render();
      recordLocalMutation('folder-move-project', { folderId, fromProjectId:previousProjectId, fromParentId:previousParentId, targetProjectId, targetFolderId, chats:affectedChats.length }, { label:'移动文件夹' });
    }
    persistStateSoon({ snapshot:true });
    processOfficialQueue().catch(()=>{});
    if (statusEl) statusEl.textContent = `文件夹已立即移动；${affectedChats.length} 条聊天正在同步到目标 Project`;
    return { moved:true, chats:affectedChats.length, subtreeIds:[...subtreeIds] };
  }

  async function pasteClipboard(targetProjectId = state.selectedProjectId, targetFolderId = state.selectedFolderId) {
    const cb = state.clipboard;
    if (!cb?.items?.length || cb.mode !== 'cut' || !targetProjectId) return;
    const targetIsUnassigned = isUnassignedProject(targetProjectId);
    let changed = 0;

    const chatItems = cb.items.filter(x=>x.kind==='chat').map(x=>getChat(x.id)).filter(Boolean).map(dragPayloadForChat);
    if (chatItems.length) {
      await dropChatsIntoLocation({items:chatItems}, targetProjectId, targetFolderId);
      changed += chatItems.length;
    }

    const folderPathJobs = [];
    for (const item of cb.items.filter(x=>x.kind==='folder')) {
      if (targetIsUnassigned) { if(statusEl) statusEl.textContent='未归项目不能容纳本地文件夹；聊天仍可移动到这里。'; continue; }
      const result = await moveFolderTree(item.id, targetProjectId, targetFolderId, { recordHistory:false, source:'paste' });
      if (result?.moved) changed++;
    }

    for (const item of cb.items.filter(x=>x.kind==='shortcut')) {
      if (targetIsUnassigned) continue;
      const sc=getShortcut(item.id);
      if(sc){sc.projectId=targetProjectId; sc.folderId=targetFolderId||null; sc.updatedAt=new Date().toISOString(); changed++;}
    }
    state.clipboard = null;
    render();
    recordLocalMutation('paste-cut', { count:changed, targetProjectId, targetFolderId }, { label:'移动' });
  }


  function normalizeNavSectionRatios(value) {
    const defaults = { pinned:0.16, quick:0.22, chats:0.14, projects:0.48 };
    const src = value && typeof value === 'object' ? value : defaults;
    const keys = ['pinned','quick','chats','projects'];
    const raw = {};
    let sum = 0;
    for (const key of keys) {
      const n = Number(src[key]);
      raw[key] = Number.isFinite(n) && n > 0 ? n : defaults[key];
      sum += raw[key];
    }
    if (!sum) return { ...defaults };
    for (const key of keys) raw[key] /= sum;
    return raw;
  }

  function isPinnedChat(chatId) {
    return (state.pinnedChats || []).includes(chatId);
  }

  function itemHasOfficialPinMetadata(item) {
    if (!item || typeof item !== 'object') return false;
    return ['is_starred','isStarred','pinned','is_pinned','pinned_time','pinnedTime']
      .some(key => Object.prototype.hasOwnProperty.call(item, key));
  }

  function itemIsOfficiallyPinned(item) {
    if (!item || typeof item !== 'object') return false;
    return item.is_starred === true || item.isStarred === true || item.pinned === true || item.is_pinned === true || item.pinned_time != null || item.pinnedTime != null;
  }

  async function fetchStarredConversationList() {
    const all = [];
    const seenIds = new Set();
    const limit = 50;
    let offset = 0;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({
        offset:String(offset), limit:String(limit), order:'updated',
        is_archived:'false', is_starred:'true', hide_snorlax:'false'
      });
      let data;
      try {
        data = await apiGet(`/backend-api/conversations?${params.toString()}`);
      } catch (err) {
        // Some cohorts do not accept hide_snorlax. Retry without it.
        params.delete('hide_snorlax');
        data = await apiGet(`/backend-api/conversations?${params.toString()}`);
      }
      const items = Array.isArray(data?.items) ? data.items : [];
      let added = 0;
      for (const item of items) {
        const id = String(item?.id || item?.conversation_id || item?.conversationId || '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        all.push(item);
        added++;
      }
      offset += items.length;
      const total = Number(data?.total || 0);
      // 如果 offset 被灰度接口忽略，会重复返回同一页；没有新增 ID 时立即停止。
      if (!items.length || !added || items.length < limit || (total && offset >= total)) break;
    }
    return all;
  }

  function normalizeOfficialPinIds(data) {
    const ids = new Set();
    const visit = value => {
      if (!value) return;
      if (typeof value === 'string') {
        // /pins 某些版本会直接返回 conversation id 字符串数组。
        if (value.length >= 8 && !/\s/.test(value)) ids.add(value);
        return;
      }
      if (Array.isArray(value)) { value.forEach(visit); return; }
      if (typeof value !== 'object') return;
      const objectType = normalizeText(value.type || value.object || value.object_type || value.pin_type || '').toLowerCase();
      const explicitConversationId = value.conversation_id || value.conversationId || value?.conversation?.id;
      const typedObjectId = /conversation/.test(objectType) ? (value.object_id || value.id) : null;
      const id = explicitConversationId || typedObjectId;
      if (id) ids.add(String(id));
      for (const key of ['items','pins','conversations','conversation_ids','pinned_conversation_ids','data','results']) if (value[key]) visit(value[key]);
    };
    visit(data);
    return [...ids];
  }

  function conversationIdFromHref(href) {
    const match = String(href || '').match(/\/c\/([^/?#]+)/);
    return match ? match[1] : null;
  }

  function scanOfficialPinsFromDom() {
    const ids = new Set();
    const labels = [...document.querySelectorAll('nav *, aside *')].filter(el => {
      if (host?.contains(el)) return false;
      const t = normalizeText(el.textContent);
      return /^(置顶|Pinned)$/i.test(t);
    });
    let observed = false;
    for (const label of labels) {
      let section = label.parentElement;
      for (let depth = 0; section && depth < 6; depth++, section = section.parentElement) {
        const anchors = [...section.querySelectorAll('a[href*="/c/"]')].filter(a => !host?.contains(a));
        // 取包含置顶标题的最小、合理列表容器，避免把整个侧栏都算成置顶。
        if (anchors.length > 0 && anchors.length <= 50) {
          observed = true;
          for (const a of anchors) {
            const id = conversationIdFromHref(a.getAttribute('href') || a.href);
            if (id) ids.add(id);
          }
          break;
        }
      }
    }
    return { observed, ids:[...ids] };
  }

  function mirrorOfficialPinsFromDom() {
    const dom = scanOfficialPinsFromDom();
    const signature = dom.ids.slice().sort().join('|');
    // DOM 只能作为“官方左栏发生了置顶相关变化”的快速信号，绝不能再作为置顶数据源。
    // ChatGPT 某些侧栏结构里，“置顶”标题的祖先容器同时包含普通聊天，直接采信其中
    // 的 /c/ 链接会把整批“未归项目”聊天误判成置顶。真正的置顶集合只由后台 API 校准。
    if (!dom.observed) {
      if (!lastDomPinSignature) return false;
      lastDomPinSignature = '';
      return true;
    }
    if (signature === lastDomPinSignature) return false;
    lastDomPinSignature = signature;
    return true;
  }

  function projectIdFromConversationMetadata(detail) {
    return canonicalProjectId(
      detail?.gizmo_id || detail?.conversation_template_id || detail?.gizmo?.id || detail?.gizmo?.gizmo?.id
    );
  }

  async function fetchConversationMetadata(conversationId) {
    try {
      return await apiGet(`/backend-api/conversations/${encodeURIComponent(conversationId)}`, 0);
    } catch (_) {
      return await apiGet(`/backend-api/conversation/${encodeURIComponent(conversationId)}`, 0);
    }
  }

  async function hydratePinnedChatFromOfficialMetadata(chatId) {
    let chat = getChat(chatId);
    try {
      const detail = await fetchConversationMetadata(chatId);
      const title = normalizeText(detail?.title) || chat?.officialTitle || chat?.localName || '未命名聊天';
      const parsed = parsePathMarker(title);
      const officialProjectId = projectIdFromConversationMetadata(detail);
      const projectId = officialProjectId || UNASSIGNED_PROJECT_ID;
      const now = new Date().toISOString();
      if (!chat) {
        chat = { id:chatId, createdAt:now, source:'official-pin-metadata' };
        state.chats.push(chat);
      }
      // Full conversation metadata is authoritative for Project membership.
      // Never infer Project membership from the Pinned sidebar href, because it may be /c/ID for a Project chat.
      if (!chat.pendingOfficialSync && !hasPendingOfficialForChat(chatId) && !chat.lifecycleState) {
        chat.projectId = projectId;
        if (officialProjectId) {
          if (parsed.hasMarker) chat.folderId = ensureFolderPath(officialProjectId, parsed.path) || null;
          else if (chat.folderId && getFolder(chat.folderId)?.projectId !== officialProjectId) chat.folderId = null;
        } else {
          chat.folderId = null;
        }
        chat.localName = parsed.baseTitle || title;
        chat.officialTitle = title;
        chat.url = officialProjectId
          ? `https://chatgpt.com/g/${officialProjectId}/c/${chatId}`
          : `https://chatgpt.com/c/${chatId}`;
        chat.updateTime = detail?.update_time ?? detail?.updateTime ?? chat.updateTime ?? null;
        chat.createTime = detail?.create_time ?? detail?.createTime ?? chat.createTime ?? null;
        chat.updatedAt = now;
        chat.lastSeenAt = now;
        chat.source = 'official-pin-metadata';
      }
      return chat;
    } catch (_) {
      // If we already know this chat from Project/unassigned synchronization, keep that authoritative mapping.
      // Do not create a new unassigned chat from a generic /c/ pinned link.
      return chat || null;
    }
  }

  async function performOfficialPinSync({ silent = true } = {}) {
    // 置顶集合只接受后台 API 的权威结果。DOM 只用于触发这次校准，不能贡献 conversation id。
    // 这样即使 ChatGPT 左栏 DOM 把“置顶”和普通聊天包在同一个祖先容器里，也不会污染 pinnedChats。
    const dom = scanOfficialPinsFromDom();
    const remoteIds = new Set();
    const errors = [];

    const [starredResult, pinsResult] = await Promise.allSettled([
      fetchStarredConversationList(),
      apiGet('/backend-api/pins?limit=100')
    ]);

    // 首选 conversations?is_starred=true，但不能仅凭“请求参数”就相信返回的每一项都是置顶。
    // 某些灰度接口可能忽略筛选参数，因此只有空列表，或返回项带有明确 pin 元数据时，
    // 才把这个数据源视为权威；并且只采纳明确标记为 pinned/starred 的条目。
    let authoritativeSourceSucceeded = false;
    if (starredResult.status === 'fulfilled') {
      const items = Array.isArray(starredResult.value) ? starredResult.value : [];
      const hasExplicitMetadata = items.length === 0 || items.some(itemHasOfficialPinMetadata);
      if (hasExplicitMetadata) {
        authoritativeSourceSucceeded = true;
        for (const item of items) {
          if (!itemIsOfficiallyPinned(item)) continue;
          const id = item?.id || item?.conversation_id || item?.conversationId;
          if (!id) continue;
          remoteIds.add(String(id));
          let chat = getChat(String(id));
          const embeddedProjectId = canonicalProjectId(item?.gizmo_id || item?.conversation_template_id || item?.gizmo?.id);
          if (!chat) {
            const title = normalizeText(item?.title) || '未命名聊天';
            const parsed = parsePathMarker(title);
            const now = new Date().toISOString();
            chat = {
              id:String(id), projectId:embeddedProjectId || UNASSIGNED_PROJECT_ID, folderId:null,
              localName:parsed.baseTitle || title, officialTitle:title, officialStarred:true,
              url:embeddedProjectId ? `https://chatgpt.com/g/${embeddedProjectId}/c/${id}` : `https://chatgpt.com/c/${id}`,
              createTime:item?.create_time ?? item?.createTime ?? null, updateTime:item?.update_time ?? item?.updateTime ?? null,
              createdAt:now, updatedAt:now, lastSeenAt:now, source:'official-starred-list'
            };
            if (embeddedProjectId && parsed.hasMarker) chat.folderId = ensureFolderPath(embeddedProjectId, parsed.path) || null;
            state.chats.push(chat);
          } else {
            chat.officialStarred = true;
          }
        }
      } else {
        errors.push('starred-list: 返回项缺少明确置顶标志，已拒绝把整页普通聊天当成置顶');
      }
    } else errors.push(`starred-list: ${starredResult.reason?.message || starredResult.reason}`);

    // /pins 作为第二个权威来源参与校准，但只接受明确的 conversation id / conversation 类型对象。
    // 这样既能覆盖某些 cohort 的 starred 列表不完整问题，也不会把其它 pin 类型混进聊天置顶。
    if (pinsResult.status === 'fulfilled') {
      authoritativeSourceSucceeded = true;
      for (const id of normalizeOfficialPinIds(pinsResult.value)) remoteIds.add(String(id));
    } else errors.push(`pins: ${pinsResult.reason?.message || pinsResult.reason}`);

    if (!authoritativeSourceSucceeded) {
      if (!silent && statusEl) statusEl.textContent = `官方置顶读取失败，已保留上一次正确状态：${errors.join('；')}`;
      return state.pinnedChats || [];
    }

    const finalIds = [...remoteIds];
    const unknown = finalIds.filter(id => !getChat(id));
    if (unknown.length) await Promise.allSettled(unknown.map(id => hydratePinnedChatFromOfficialMetadata(id)));

    state.pinnedChats = finalIds.filter(id => getChat(id) && !getChat(id)?.lifecycleState);
    const finalSet = new Set(state.pinnedChats);
    for (const chat of state.chats || []) if (chat && !chat.lifecycleState) chat.officialStarred = finalSet.has(String(chat.id));
    lastDomPinSignature = dom.observed ? dom.ids.slice().sort().join('|') : lastDomPinSignature;
    persistStateSoon({ snapshot:false });
    render();
    if (!silent && statusEl) statusEl.textContent = `已同步 ${state.pinnedChats.length} 条官方置顶聊天`;
    return state.pinnedChats;
  }

  async function syncOfficialPins(options = {}) {
    if (pinSyncPromise) return await pinSyncPromise;
    pinSyncPromise = performOfficialPinSync(options);
    try { return await pinSyncPromise; }
    finally { pinSyncPromise = null; }
  }

  function enqueuePinOperation(chatId, desiredPinned, previousPinned) {
    const op = { id:uid('op'), type:'pin-chat', conversationId:chatId, desiredPinned:!!desiredPinned, previousPinned:!!previousPinned, createdAt:new Date().toISOString(), attempts:0 };
    state.pendingOperations = state.pendingOperations.filter(x => !(x.type === 'pin-chat' && x.conversationId === chatId && x.id !== currentOfficialOperationId));
    state.pendingOperations.push(op);
    persistStateSoon({ snapshot:false });
    processOfficialQueue().catch(()=>{});
  }

  function togglePinnedChat(chatId) {
    const chat = getChat(chatId);
    if (!chat || chat.lifecycleState) return;
    const wasPinned = isPinnedChat(chatId);
    state.pinnedChats = Array.isArray(state.pinnedChats) ? state.pinnedChats : [];
    if (wasPinned) state.pinnedChats = state.pinnedChats.filter(id => id !== chatId);
    else state.pinnedChats.unshift(chatId);
    chat.officialStarred = !wasPinned;
    render();
    recordLocalMutation(wasPinned ? 'chat-unpin' : 'chat-pin', { chatId }, { label:wasPinned ? '取消官方置顶' : '官方置顶' });
    enqueuePinOperation(chatId, !wasPinned, wasPinned);
    if (statusEl) statusEl.textContent = `${wasPinned ? '取消置顶' : '置顶'}已立即反映到 Explorer，正在同步 ChatGPT 官方状态…`;
  }

  function repairPendingOperationLocalTargets() {
    let repaired = 0;
    for (const op of state.pendingOperations || []) {
      if (op.type !== 'move-chat' || !op.conversationId) continue;
      const chat = getChat(op.conversationId);
      if (!chat) continue;
      const parsed = parsePathMarker(op.desiredTitle || '');
      const targetProjectId = canonicalProjectId(op.targetProjectId) || op.targetProjectId || chat.projectId;
      let targetFolderId = op.targetFolderId || null;
      if (targetFolderId && !getFolder(targetFolderId)) targetFolderId = parsed.hasMarker ? ensureFolderPath(targetProjectId, parsed.path) : null;
      chat.projectId = targetProjectId;
      chat.folderId = targetFolderId;
      if (parsed.baseTitle) chat.localName = parsed.baseTitle;
      if (op.desiredTitle) chat.officialTitle = op.desiredTitle;
      chat.pendingOfficialSync = true;
      repaired++;
    }
    return repaired;
  }

  function cleanupRecoveredEmptyFolders() {
    let removed = 0;
    let changed = true;
    while (changed) {
      changed = false;
      const quickFolderIds = new Set((state.quickAccess || []).filter(q => q.type === 'folder').map(q => q.id));
      for (const folder of [...(state.folders || [])]) {
        if (!folder.recoveredFromTitleMarker) continue;
        const hasChild = state.folders.some(f => f.parentId === folder.id);
        const hasChat = state.chats.some(c => c.folderId === folder.id);
        const hasShortcut = (state.shortcuts || []).some(sc => sc.folderId === folder.id);
        if (!hasChild && !hasChat && !hasShortcut && !quickFolderIds.has(folder.id)) {
          state.folders = state.folders.filter(f => f.id !== folder.id);
          removed++;
          changed = true;
        }
      }
    }
    return removed;
  }

  function hasPendingOfficialForChat(chatId) {
    return (state.pendingOperations || []).some(op => op.conversationId === chatId);
  }

  function removeChatFromLocalIndex(chatId) {
    state.chats = state.chats.filter(c => c.id !== chatId);
    state.pinnedChats = (state.pinnedChats || []).filter(id => id !== chatId);
    state.shortcuts = (state.shortcuts || []).filter(sc => sc.targetChatId !== chatId);
    state.quickAccess = (state.quickAccess || []).filter(q => !(q.type === 'chat' && q.id === chatId));
    selectedChatIds.delete(chatId);
    if (selectionAnchorChatId === chatId) selectionAnchorChatId = null;
  }

  function enqueueConversationLifecycleOperation(chat, action) {
    if (!chat?.id) return;
    const op = {
      id: uid('op'), type: action === 'archive' ? 'archive-chat' : 'delete-chat',
      conversationId: chat.id, previousChat: structuredClone(chat),
      previousPinned: isPinnedChat(chat.id), createdAt:new Date().toISOString(), attempts:0
    };
    // 归档/删除是终止性操作：尚未开始的移动/置顶/另一个生命周期操作全部作废，
    // 但不强行中断当前已经在执行的官方操作。
    state.pendingOperations = state.pendingOperations.filter(x => !(x.conversationId === chat.id && x.id !== currentOfficialOperationId));
    state.pendingOperations.push(op);
    persistStateSoon({ snapshot:false });
    processOfficialQueue().catch(()=>{});
  }

  function archiveChat(chatId) {
    const chat = getChat(chatId);
    if (!chat || chat.lifecycleState) return;
    chat.lifecycleState = 'archive-pending';
    chat.pendingOfficialSync = true;
    state.pinnedChats = (state.pinnedChats || []).filter(id => id !== chatId);
    enqueueConversationLifecycleOperation(chat, 'archive');
    render();
    recordLocalMutation('chat-archive-request', { chatId }, { label:'归档聊天', undoable:false });
    if (statusEl) statusEl.textContent = `已从 Explorer 隐藏「${chat.localName || chat.id}」，官方归档正在同步`;
  }

  function deleteChat(chatId) {
    const chat = getChat(chatId);
    if (!chat || chat.lifecycleState) return;
    if (!confirm(`删除聊天「${chat.localName || '未命名聊天'}」？\n\n该操作会让它从 ChatGPT 正常聊天列表中消失。删除不可通过本插件恢复。`)) return;
    chat.lifecycleState = 'delete-pending';
    chat.pendingOfficialSync = true;
    state.pinnedChats = (state.pinnedChats || []).filter(id => id !== chatId);
    enqueueConversationLifecycleOperation(chat, 'delete');
    render();
    recordLocalMutation('chat-delete-request', { chatId }, { label:'删除聊天', undoable:false });
    if (statusEl) statusEl.textContent = `已从 Explorer 隐藏「${chat.localName || chat.id}」，官方删除正在同步`;
  }

  function isQuick(type, id) {
    return state.quickAccess.some(q => q.type === type && q.id === id);
  }

  async function toggleQuick(type, id) {
    const idx = state.quickAccess.findIndex(q => q.type === type && q.id === id);
    if (idx >= 0) state.quickAccess.splice(idx, 1);
    else state.quickAccess.push({ type, id, addedAt: new Date().toISOString() });
    render();
    recordLocalMutation('quick-access-toggle', { type, id });
  }

  async function getAccessToken() {
    const now = Date.now();
    await verifyAccountBoundary(false);
    if (accessTokenCache.token && accessTokenCache.expiresAt > now && accessTokenCache.accountFingerprint === currentAccountIdentity?.fingerprint) return accessTokenCache.token;
    const data = await getSessionData(true);
    const identity = await identityFromSession(data);
    if (!sameAccount(identity, currentAccountIdentity)) {
      await verifyAccountBoundary(true);
      throw new Error('账号已切换');
    }
    if (!data?.accessToken) throw new Error('当前页面未取得 ChatGPT access token，请确认已登录。');
    accessTokenCache = { token:data.accessToken, expiresAt:now + 60 * 1000, accountFingerprint:currentAccountIdentity.fingerprint };
    return data.accessToken;
  }

  async function apiGet(path, retries = 2) {
    let token = await getAccessToken();
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`https://chatgpt.com${path}`, {
          credentials: 'include',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (resp.status === 401 && attempt < retries) {
          accessTokenCache = { token:null, expiresAt:0, accountFingerprint:null };
          token = await getAccessToken();
          continue;
        }
        if (resp.status === 429 && attempt < retries) {
          await delay(700 * (attempt + 1));
          continue;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
      } catch (err) {
        lastError = err;
        if (attempt < retries) await delay(300 * (attempt + 1));
      }
    }
    throw lastError || new Error('请求失败');
  }


  async function apiPostJson(path, payload, retries = 2) {
    let token = await getAccessToken();
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const session = await getSessionData(false).catch(() => null);
        const claims = decodeJwtPayload(token);
        const accountId = normalizeText(
          session?.account?.id || session?.user?.account_id || session?.user?.accountId ||
          claims['https://api.openai.com/auth.account_id'] || claims.account_id || ''
        );
        const headers = { Authorization:`Bearer ${token}`, 'Content-Type':'application/json', Accept:'application/json' };
        if (accountId) headers['chatgpt-account-id'] = accountId;
        const resp = await fetch(`https://chatgpt.com${path}`, {
          method:'POST', credentials:'include', headers, body:JSON.stringify(payload ?? {})
        });
        if (resp.status === 401 && attempt < retries) {
          accessTokenCache = { token:null, expiresAt:0, accountFingerprint:null };
          sessionCache = { data:null, fetchedAt:0 };
          token = await getAccessToken();
          continue;
        }
        if (resp.status === 429 && attempt < retries) {
          await delay(700 * (attempt + 1));
          continue;
        }
        const text = await resp.text();
        if (!resp.ok) {
          const detail = normalizeText(text).slice(0, 180);
          throw new Error(`HTTP ${resp.status}${detail ? `：${detail}` : ''}`);
        }
        try { return text ? JSON.parse(text) : {}; } catch (_) { return {}; }
      } catch (err) {
        lastError = err;
        if (attempt < retries) await delay(300 * (attempt + 1));
      }
    }
    throw lastError || new Error('POST 请求失败');
  }

  function projectFromCreateResponse(data, fallbackName = '') {
    const candidates = [
      data?.project,
      data?.gizmo?.gizmo,
      data?.gizmo,
      data?.data?.project,
      data?.data?.gizmo?.gizmo,
      data?.data?.gizmo,
      data?.data,
      data
    ].filter(Boolean);
    for (const item of candidates) {
      const id = canonicalProjectId(item?.id || item?.project_id || item?.projectId || item?.gizmo_id);
      if (!id || !String(id).startsWith('g-p-')) continue;
      const name = normalizeText(item?.display?.name || item?.name || item?.title || fallbackName || id);
      return { id, name, url:`https://chatgpt.com/g/${id}/project`, source:'created-api' };
    }
    return null;
  }

  let creatingProject = false;

  async function createOfficialProject() {
    if (!state.initialized) return;
    if (creatingProject) {
      if (statusEl) statusEl.textContent = '已有 Project 正在创建，请勿重复提交。';
      return;
    }
    const raw = prompt('新建 ChatGPT Project\n\n项目名称：', '');
    if (raw == null) return;
    const name = normalizeText(raw);
    if (!name) {
      if (statusEl) statusEl.textContent = '项目名称不能为空。';
      return;
    }

    creatingProject = true;
    const button = shadow?.getElementById('newProjectBtn');
    if (button) button.disabled = true;
    if (statusEl) statusEl.textContent = `正在后台创建 Project「${name}」…`;

    const beforeIds = new Set((state.projects || []).map(p => canonicalProjectId(p.id)).filter(Boolean));
    try {
      const data = await apiPostJson('/backend-api/projects', { name, instructions:'' });
      let project = projectFromCreateResponse(data, name);

      // Some cohorts return only an acknowledgement. In that case, resolve the new id from
      // the authoritative project list instead of touching the visible ChatGPT sidebar.
      if (!project) {
        await delay(120);
        const backend = await scanProjectsFromBackend();
        const fresh = backend.filter(p => !beforeIds.has(canonicalProjectId(p.id)));
        project = fresh.find(p => normalizeText(p.name) === name) || (fresh.length === 1 ? fresh[0] : null);
      }
      if (!project?.id) throw new Error('官方接口已响应，但没有返回可识别的新 Project ID');

      const existing = getProject(project.id);
      if (existing) Object.assign(existing, project, { missingOfficialCount:0, lastSeenAt:new Date().toISOString() });
      else state.projects.push({ ...project, missingOfficialCount:0, lastSeenAt:new Date().toISOString() });
      if (!Array.isArray(state.projectOrder)) state.projectOrder = [];
      state.projectOrder = projectOrderIds();
      if (!state.projectOrder.includes(project.id)) state.projectOrder.push(project.id);
      state.selectedProjectId = project.id;
      state.selectedFolderId = null;
      selectedChatIds.clear();
      selectionAnchorChatId = null;
      render();
      recordLocalMutation('project-create', { projectId:project.id, name:project.name }, { label:'新建 Project', undoable:false });
      if (statusEl) statusEl.textContent = `已创建 Project「${project.name}」`;

      // Background confirmation only. No route change, menu opening or visible UI fallback.
      syncOfficialProjects({ silent:true, persist:true, rerender:true }).catch(() => {});
    } catch (err) {
      if (statusEl) statusEl.textContent = `新建 Project 失败：${err?.message || err}`;
    } finally {
      creatingProject = false;
      const btn = shadow?.getElementById('newProjectBtn');
      if (btn) btn.disabled = false;
    }
  }

  async function apiPatchConversation(conversationId, payload, retries = 2) {
    let token = await getAccessToken();
    let lastError = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const resp = await fetch(`https://chatgpt.com/backend-api/conversation/${encodeURIComponent(conversationId)}`, {
          method:'PATCH',
          credentials:'include',
          headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
          body:JSON.stringify(payload)
        });
        if (resp.status === 401 && attempt < retries) {
          accessTokenCache = { token:null, expiresAt:0, accountFingerprint:null };
          token = await getAccessToken();
          continue;
        }
        if (resp.status === 429 && attempt < retries) {
          await delay(700 * (attempt + 1));
          continue;
        }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();
        try { return text ? JSON.parse(text) : {}; } catch (_) { return {}; }
      } catch (err) {
        lastError = err;
        if (attempt < retries) await delay(300 * (attempt + 1));
      }
    }
    throw lastError || new Error('PATCH 请求失败');
  }

  async function renameConversation(conversationId, title) {
    const clean = normalizeText(title);
    if (!clean) throw new Error('聊天标题不能为空');
    await apiPatchConversation(conversationId, { title: clean });
  }

  function localNameForMove(chat, payload) {
    if (chat?.localName) return normalizeText(chat.localName) || '未命名聊天';
    const candidate = payload?.title || chat?.officialTitle || '未命名聊天';
    return stripPathMarker(candidate) || '未命名聊天';
  }

  function officialTitleForLocation(localName, folderId) {
    const base = stripPathMarker(localName) || '未命名聊天';
    return `${base}${markerForFolder(folderId)}`.trim();
  }

  async function renameChatTitle(chatId) {
    const chat = getChat(chatId);
    if (!chat) return;
    const oldLocalName = normalizeText(chat.localName || stripPathMarker(chat.officialTitle) || '未命名聊天');
    const input = prompt('聊天标题：\n\n插件路径标识会自动保留在标题末尾，不需要手工输入。', oldLocalName);
    if (input == null) return;
    const newLocalName = normalizeText(stripPathMarker(input));
    if (!newLocalName || newLocalName === oldLocalName) return;
    const previousChat = structuredClone(chat);
    chat.localName = newLocalName;
    chat.officialTitle = officialTitleForLocation(newLocalName, chat.folderId || null);
    chat.updatedAt = new Date().toISOString();
    chat.pendingOfficialSync = true;
    render();
    recordLocalMutation('chat-rename', {conversationId:chat.id, from:oldLocalName, to:newLocalName}, {label:'重命名聊天'});
    enqueueOfficialChatSync({
      conversationId:chat.id,
      sourceProjectId:chat.projectId,
      targetProjectId:chat.projectId,
      targetFolderId:chat.folderId || null,
      desiredTitle:chat.officialTitle,
      previousChat
    });
    statusEl.textContent = `已立即重命名为「${newLocalName}」，官方标题同步已加入队列`;
  }

  async function writeAllPathMarkers() {
    if (!state.initialized) return;
    if (!normalizeSettings(state.settings).pathMarkersEnabled) { if (statusEl) statusEl.textContent = t('pathDisabled'); return; }
    const candidates = state.chats.filter(chat => chat.projectId && chat.folderId);
    if (!candidates.length) {
      statusEl.textContent = '没有需要写入路径标识的聊天。';
      return;
    }
    if (!confirm(`将根据本地文件夹结构，把路径标识写入 ${candidates.length} 个官方聊天标题。\n\n只修改标题，不移动或删除聊天。是否继续？`)) return;
    let ok = 0, failed = 0;
    for (let i = 0; i < candidates.length; i++) {
      const chat = candidates[i];
      const title = officialTitleForLocation(chat.localName || stripPathMarker(chat.officialTitle), chat.folderId);
      statusEl.textContent = `写入路径标识 ${i + 1}/${candidates.length}：${chat.localName || chat.id}`;
      try {
        if (normalizeText(chat.officialTitle) !== normalizeText(title)) await renameConversation(chat.id, title);
        chat.officialTitle = title;
        chat.updatedAt = new Date().toISOString();
        ok++;
      } catch (err) {
        chat.lastTitleSyncError = String(err?.message || err);
        failed++;
      }
      await delay(90);
    }
    await saveState();
    render();
    statusEl.textContent = `路径标识写入完成：成功 ${ok}，失败 ${failed}。本地文件夹和聊天均未改变。`;
  }

  async function removeAllPathMarkers() {
    if (!state.initialized) return;
    const candidates = state.chats.filter(chat => parsePathMarker(chat.officialTitle || '').hasMarker);
    if (!candidates.length) {
      statusEl.textContent = '当前没有聊天标题包含 Ai Chat Explorer 路径标识。';
      return;
    }
    if (!confirm(`将从 ${candidates.length} 个官方聊天标题中移除 Ai Chat Explorer 路径标识。\n\n只删除标题末尾的 ⟦CE:…⟧，不会删除聊天，也不会删除本地文件夹。是否继续？`)) return;
    let ok = 0, failed = 0;
    for (let i = 0; i < candidates.length; i++) {
      const chat = candidates[i];
      const base = stripPathMarker(chat.officialTitle || chat.localName || '未命名聊天');
      statusEl.textContent = `移除路径标识 ${i + 1}/${candidates.length}：${base}`;
      try {
        await renameConversation(chat.id, base);
        chat.officialTitle = base;
        chat.localName = chat.localName || base;
        chat.updatedAt = new Date().toISOString();
        ok++;
      } catch (err) {
        chat.lastTitleSyncError = String(err?.message || err);
        failed++;
      }
      await delay(90);
    }
    await saveState();
    render();
    statusEl.textContent = `路径标识移除完成：成功 ${ok}，失败 ${failed}。聊天和本地目录均保留。`;
  }

  function isVisibleDomElement(el) {
    if (!(el instanceof HTMLElement)) return false;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity || 1) > 0;
  }

  function normalizedDomText(el) { return normalizeText(el?.innerText || el?.textContent || '').toLowerCase(); }

  function realisticClick(el) {
    if (!el) return false;
    try { el.scrollIntoView({ block:'nearest', inline:'nearest' }); } catch (_) {}
    for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, composed:true, view:window, button:0 })); } catch (_) {}
    }
    return true;
  }

  function realisticHover(el) {
    if (!el) return;
    for (const type of ['pointerenter','mouseenter','mouseover','mousemove']) {
      try { el.dispatchEvent(new MouseEvent(type, { bubbles:true, cancelable:true, composed:true, view:window })); } catch (_) {}
    }
  }

  function officialChatAnchor(conversationId) {
    return [...document.querySelectorAll('a[href*="/c/"]')].find(a => !host?.contains(a) && (a.getAttribute('href') || a.href || '').includes(`/c/${conversationId}`)) || null;
  }

  function nearbyMenuButton(anchor) {
    let cur = anchor;
    for (let depth=0; cur && depth<7; depth++, cur=cur.parentElement) {
      const buttons = [...cur.querySelectorAll('button')].filter(isVisibleDomElement);
      const preferred = buttons.find(b => /more|option|更多|菜单|menu|ellipsis|actions?/i.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('data-testid') || ''}`));
      if (preferred) return preferred;
      if (buttons.length === 1) return buttons[0];
    }
    return null;
  }

  function visibleMenuElements() {
    return [...document.querySelectorAll('[role="menuitem"], [role="option"], [data-radix-menu-content] button, [data-radix-menu-content] [tabindex], div[role="menu"] button')]
      .filter(el => !host?.contains(el) && isVisibleDomElement(el));
  }

  function findVisibleMenuItem(matchers) {
    const tests = matchers.map(x => x instanceof RegExp ? x : new RegExp(String(x), 'i'));
    return visibleMenuElements().find(el => { const t = normalizedDomText(el); return tests.some(re => re.test(t)); }) || null;
  }

  async function openOfficialChatMenu(conversationId) {
    let anchor = officialChatAnchor(conversationId);
    if (!anchor) {
      const chat = getChat(conversationId);
      if (chat) { openChatInPlace(chat); await delay(500); anchor = officialChatAnchor(conversationId); }
    }
    if (!anchor) throw new Error('没有在 ChatGPT 官方界面找到该聊天，无法执行官方菜单操作');
    realisticHover(anchor);
    await delay(120);
    const button = nearbyMenuButton(anchor);
    if (!button) throw new Error('没有找到 ChatGPT 官方聊天菜单按钮');
    realisticClick(button);
    await delay(220);
    return anchor;
  }

  async function officialUiSetPinned(conversationId, desiredPinned) {
    await openOfficialChatMenu(conversationId);
    const item = desiredPinned
      ? findVisibleMenuItem([/^pin( chat)?$/i, /置顶(聊天)?/, /固定(聊天)?/])
      : findVisibleMenuItem([/^unpin( chat)?$/i, /取消置顶/, /取消固定/]);
    if (!item) { document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); throw new Error(`官方菜单中没有找到“${desiredPinned?'置顶':'取消置顶'}”`); }
    realisticClick(item);
    await delay(350);
  }

  async function verifyConversationProject(conversationId, targetProjectId) {
    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    // 优先读取单条会话元数据，避免每次验证都分页扫描整个 Project。
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const detail = await fetchConversationMetadata(conversationId);
        const actualProjectId = projectIdFromConversationMetadata(detail);
        if (isUnassignedProject(targetProjectId)) {
          if (!actualProjectId) return true;
        } else if (actualProjectId === targetProjectId) return true;
      } catch (_) {}
      await delay(180 + attempt * 120);
    }

    // 元数据接口在少数账号/灰度版本可能不带 Project 字段；最后只做一次列表级兜底。
    try {
      if (isUnassignedProject(targetProjectId)) {
        const items = await fetchUnassignedConversationList();
        return items.some(item => String(item?.id || '') === String(conversationId) && !canonicalProjectId(item?.gizmo_id || item?.conversation_template_id || item?.gizmo?.id));
      }
      const items = await fetchProjectConversationList(targetProjectId);
      return items.some(item => String(item?.id || '') === String(conversationId));
    } catch (_) {
      return false;
    }
  }

  async function officialUiMoveConversation(conversationId, targetProjectId) {
    await openOfficialChatMenu(conversationId);
    if (isUnassignedProject(targetProjectId)) {
      const remove = findVisibleMenuItem([/remove from project/i, /^remove$/i, /从项目中移除/, /移出项目/, /^移除$/]);
      if (!remove) throw new Error('官方菜单中没有找到“移出项目/Remove from project”');
      realisticClick(remove);
      await delay(500);
      return;
    }

    const move = findVisibleMenuItem([/move to project/i, /移动到项目/, /移至项目/, /move project/i, /change project/i]);
    if (!move) throw new Error('官方菜单中没有找到“移动到项目/Move to project”');
    realisticHover(move);
    realisticClick(move);
    await delay(260);
    const project = getProject(targetProjectId);
    if (!project) throw new Error('目标 Project 不存在');
    const candidates = visibleMenuElements();
    const target = candidates.find(el => normalizeText(el.innerText || el.textContent) === normalizeText(project.name))
      || candidates.find(el => normalizedDomText(el).includes(normalizeText(project.name).toLowerCase()));
    if (!target) throw new Error(`官方项目菜单中没有找到“${project.name}”`);
    realisticClick(target);
    await delay(550);
  }

  async function moveConversationToProject(conversationId, targetProjectId) {
    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    if (!targetProjectId) throw new Error('目标 Project ID 无效');
    if (await verifyConversationProject(conversationId, targetProjectId)) return true;

    let patchError = null;
    // 默认完全后台执行：先直接 PATCH，不打开聊天、不弹菜单、不切换官方中间页面。
    try {
      if (isUnassignedProject(targetProjectId)) {
        await apiPatchConversation(conversationId, { gizmo_id:null, conversation_template_id:null });
      } else {
        const canonical = canonicalProjectId(targetProjectId);
        await apiPatchConversation(conversationId, { gizmo_id:canonical, conversation_template_id:canonical });
      }
      if (await verifyConversationProject(conversationId, targetProjectId)) return true;
    } catch (err) {
      patchError = err;
    }

    // 默认严格后台模式：后台接口失败时回滚，不触碰 ChatGPT 原生左栏/中间页面。
    if (!ALLOW_VISIBLE_UI_FALLBACK) {
      throw new Error(`官方 Project 归属没有真正变化；已按后台模式停止，未执行可见 UI 操作${patchError ? `：${patchError.message || patchError}` : ''}`);
    }

    let uiError = null;
    try {
      await officialUiMoveConversation(conversationId, targetProjectId);
      if (await verifyConversationProject(conversationId, targetProjectId)) return true;
    } catch (err) { uiError = err; }

    throw new Error(`官方 Project 归属没有真正变化${patchError ? `；后台接口：${patchError.message || patchError}` : ''}${uiError ? `；UI 兜底：${uiError.message || uiError}` : ''}`);
  }

  function enqueueOfficialChatSync(op) {
    const queuedSame = state.pendingOperations.find(x => x.type === 'move-chat' && x.conversationId === op.conversationId && x.id !== currentOfficialOperationId);
    const normalized = {
      id: op.id || uid('op'),
      type: 'move-chat',
      conversationId: op.conversationId,
      // 折叠尚未开始的重复拖动时，保留最早的官方来源/回滚快照；目标取用户最新一次拖动。
      sourceProjectId: queuedSame?.sourceProjectId || op.sourceProjectId || UNASSIGNED_PROJECT_ID,
      targetProjectId: op.targetProjectId,
      targetFolderId: op.targetFolderId || null,
      desiredTitle: op.desiredTitle || '',
      previousChat: queuedSame?.previousChat || op.previousChat || null,
      createdAt: queuedSame?.createdAt || op.createdAt || new Date().toISOString(),
      attempts: Number(queuedSame?.attempts || op.attempts || 0)
    };
    state.pendingOperations = state.pendingOperations.filter(x => !(x.type === 'move-chat' && x.conversationId === normalized.conversationId && x.id !== currentOfficialOperationId));
    state.pendingOperations.push(normalized);
    persistStateSoon({ snapshot: false });
    processOfficialQueue().catch(() => {});
  }

  function scheduleMembershipRefresh(projectIds = [], includeUnassigned = false) {
    for (const id of projectIds || []) {
      const canonical = canonicalProjectId(id) || id;
      if (canonical && !isUnassignedProject(canonical)) pendingMembershipRefreshProjects.add(canonical);
    }
    if (includeUnassigned) pendingMembershipRefreshUnassigned = true;
    clearTimeout(membershipRefreshTimer);
    membershipRefreshTimer = setTimeout(() => flushMembershipRefresh().catch(()=>{}), MEMBERSHIP_REFRESH_DEBOUNCE_MS);
  }

  async function flushMembershipRefresh() {
    const projectIds = [...pendingMembershipRefreshProjects];
    const includeUnassigned = pendingMembershipRefreshUnassigned;
    pendingMembershipRefreshProjects.clear();
    pendingMembershipRefreshUnassigned = false;
    if (!projectIds.length && !includeUnassigned) return;

    const projectJobs = projectIds.map(async projectId => {
      const project = getProject(projectId);
      if (!project) return;
      const items = await fetchProjectConversationList(projectId);
      mergeOfficialChats(projectId, items);
      project.lastChatsSyncAt = new Date().toISOString();
    });
    const jobs = [...projectJobs];
    if (includeUnassigned) jobs.push(fetchUnassignedConversationList().then(items => mergeUnassignedChats(items)));
    await Promise.allSettled(jobs);
    persistStateSoon({ snapshot:false });
    refreshHistoryBaselineAfterExternalSync();
    render();
  }

  async function processOfficialQueue() {
    if (processingOfficialQueue || !state.initialized) return;
    processingOfficialQueue = true;
    try {
      while (state.pendingOperations.length) {
        await verifyAccountBoundary(false);
        const op = state.pendingOperations[0];
        currentOfficialOperationId = op.id;
        const chat = getChat(op.conversationId);
        if (!chat && op.type === 'move-chat') {
          state.pendingOperations.shift(); currentOfficialOperationId = null; persistStateSoon({ snapshot:false }); continue;
        }
        op.attempts = Number(op.attempts || 0) + 1;
        const label = chat?.localName || op.previousChat?.localName || op.conversationId;
        statusEl.textContent = `待同步 ${state.pendingOperations.length} 项 · 正在同步「${label}」…`;
        try {
          if (op.type === 'archive-chat') {
            await apiPatchConversation(op.conversationId, { is_archived:true });
            removeChatFromLocalIndex(op.conversationId);
          } else if (op.type === 'delete-chat') {
            await apiPatchConversation(op.conversationId, { is_visible:false });
            removeChatFromLocalIndex(op.conversationId);
          } else if (op.type === 'pin-chat') {
            // 默认后台 PATCH；只有后台接口失败/未生效时，才使用官方 UI 兜底。
            let patchError = null;
            try {
              await apiPatchConversation(op.conversationId, { is_starred:!!op.desiredPinned });
              await delay(120);
              await syncOfficialPins({ silent:true });
            } catch (err) { patchError = err; }

            if (isPinnedChat(op.conversationId) !== !!op.desiredPinned) {
              if (!ALLOW_VISIBLE_UI_FALLBACK) {
                throw new Error(`官方置顶状态未确认；已按后台模式停止，未打开官方菜单${patchError ? `：${patchError.message || patchError}` : ''}`);
              }
              let uiError = null;
              try { await officialUiSetPinned(op.conversationId, !!op.desiredPinned); }
              catch (err) { uiError = err; }
              await delay(220);
              await syncOfficialPins({ silent:true });
              if (isPinnedChat(op.conversationId) !== !!op.desiredPinned) {
                throw new Error(`官方置顶状态未确认${patchError ? `；后台接口：${patchError.message || patchError}` : ''}${uiError ? `；UI 兜底：${uiError.message || uiError}` : ''}`);
              }
            }
          } else {
            // 即使本地 source/target 看起来相同，也重新验证官方归属；旧版可能留下了错误的本地 Project 映射。
            await moveConversationToProject(op.conversationId, op.targetProjectId);
            // 在真正写标题之前按“当前设置”重新计算。这样即使该操作入队时路径标识还是开启的，
            // 用户随后在设置中关闭，也不会由旧队列继续把 ⟦CE:路径⟧ 写回官方标题。
            const queueLocalName = chat?.localName || op.previousChat?.localName || stripPathMarker(op.desiredTitle || '') || '未命名聊天';
            const desiredTitleNow = officialTitleForLocation(queueLocalName, op.targetFolderId || null);
            op.desiredTitle = desiredTitleNow;
            if (chat) chat.officialTitle = desiredTitleNow;
            if (desiredTitleNow) {
              const oldTitle = normalizeText(op.previousChat?.officialTitle || '');
              if (normalizeText(desiredTitleNow) !== oldTitle) {
                try { await renameConversation(op.conversationId, desiredTitleNow); }
                catch (titleErr) { if (chat) chat.lastOfficialSyncError = `标题同步失败：${titleErr?.message || titleErr}`; }
              }
            }
          }

          state.pendingOperations.shift();
          currentOfficialOperationId = null;
          if (chat && op.type === 'move-chat') {
            chat.pendingOfficialSync = hasPendingOfficialForChat(chat.id);
            chat.updatedAt = new Date().toISOString();
          }
          cleanupRecoveredEmptyFolders();
          persistStateSoon({ snapshot:false });
          render();

          if (op.type === 'move-chat') {
            // Explorer 本地状态已经即时更新。这里只合并安排一次后台校准，避免批量移动时
            // 每条聊天都重复全量扫描源/目标 Project。
            const source = op.sourceProjectId || UNASSIGNED_PROJECT_ID;
            const target = op.targetProjectId || UNASSIGNED_PROJECT_ID;
            scheduleMembershipRefresh([source, target], isUnassignedProject(source) || isUnassignedProject(target));
          } else if (op.type === 'archive-chat' || op.type === 'delete-chat') {
            const sourceProjectId = op.previousChat?.projectId || UNASSIGNED_PROJECT_ID;
            scheduleMembershipRefresh([sourceProjectId], isUnassignedProject(sourceProjectId));
          }
          await delay(25);
        } catch (err) {
          // 当前操作失败时，后续同一聊天的乐观操作必须继承更早的真实基线。
          // 否则连续拖动/连续置顶切换都失败时，第二次操作可能回滚到一个从未真正生效的位置。
          for (const later of state.pendingOperations.slice(1)) {
            if (later.conversationId !== op.conversationId) continue;
            if (op.type === 'move-chat' && later.type === 'move-chat' && op.previousChat) {
              later.previousChat = structuredClone(op.previousChat);
              later.sourceProjectId = op.sourceProjectId || op.previousChat.projectId || UNASSIGNED_PROJECT_ID;
            }
            if (op.type === 'pin-chat' && later.type === 'pin-chat') later.previousPinned = !!op.previousPinned;
          }
          if (op.previousChat) {
            const existing = getChat(op.conversationId);
            if (existing) Object.assign(existing, op.previousChat);
            else state.chats.push(structuredClone(op.previousChat));
          }
          if (op.type === 'pin-chat') {
            state.pinnedChats = (state.pinnedChats || []).filter(id => id !== op.conversationId);
            if (op.previousPinned) state.pinnedChats.unshift(op.conversationId);
          } else if (op.previousPinned && !(state.pinnedChats || []).includes(op.conversationId)) state.pinnedChats.unshift(op.conversationId);
          state.pendingOperations.shift(); currentOfficialOperationId = null;
          await saveState({ snapshot:false });
          render();
          statusEl.textContent = `官方同步失败，已回滚「${label}」：${err?.message || err}`;
          await delay(250);
        }
      }
    } finally {
      currentOfficialOperationId = null; processingOfficialQueue = false;
      if (state.pendingOperations.length) setTimeout(() => processOfficialQueue().catch(()=>{}), 600);
      else if (statusEl && state.initialized) statusEl.textContent = '所有待同步操作已完成';
    }
  }

  function scanProjectsFromDom() {
    const map = new Map();
    document.querySelectorAll(PROJECT_LINK_SELECTOR).forEach(a => {
      const href = a.href || a.getAttribute('href') || '';
      const match = href.match(PROJECT_HREF_PATTERN);
      if (!match) return;
      const id = canonicalProjectId(match[1]);
      const name = normalizeText(a.textContent);
      if (!id || !name) return;
      map.set(id, {
        id,
        name,
        url: href.startsWith('http') ? href : `https://chatgpt.com/g/${id}/project`,
        source: 'dom'
      });
    });
    return [...map.values()];
  }

  function scanProjectsFromChatGPTCache() {
    const map = new Map();
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.endsWith('snorlax-history')) continue;
        let data;
        try { data = JSON.parse(localStorage.getItem(key)); } catch { continue; }
        const pages = data?.value?.pages || [];
        for (const page of pages) {
          for (const item of (page?.items || [])) {
            const gizmo = item?.gizmo?.gizmo;
            if (!gizmo?.id || !String(gizmo.id).startsWith('g-p-')) continue;
            const id = canonicalProjectId(gizmo.id);
            const name = normalizeText(gizmo?.display?.name || gizmo?.name || id);
            map.set(id, { id, name, url: `https://chatgpt.com/g/${id}/project`, source: 'cache' });
          }
        }
      }
    } catch (_) {}
    return [...map.values()];
  }

  async function scanProjectsFromBackend() {
    // Project sidebar is cursor-paginated. ChatGPT normally renders only the first few projects
    // and a “show more” affordance; reading only the first response therefore truncates the list.
    const out = [];
    let cursor = null;
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({ owned_only:'true', conversations_per_gizmo:'0' });
      if (cursor) params.set('cursor', cursor);
      const data = await apiGet(`/backend-api/gizmos/snorlax/sidebar?${params.toString()}`);
      for (const item of (data?.items || [])) {
        const gizmo = item?.gizmo?.gizmo || item?.gizmo || item;
        const id = canonicalProjectId(gizmo?.id || item?.id);
        const name = normalizeText(gizmo?.display?.name || gizmo?.name || item?.title || id);
        if (id && String(id).startsWith('g-p-')) {
          out.push({ id:String(id), name, url:`https://chatgpt.com/g/${id}/project`, source:'backend' });
        }
      }
      const next = data?.cursor ?? null;
      if (!next || seen.has(String(next))) break;
      seen.add(String(next));
      cursor = String(next);
    }
    const dedup = new Map();
    for (const project of out) dedup.set(project.id, { ...(dedup.get(project.id)||{}), ...project });
    return [...dedup.values()];
  }

  async function syncOfficialProjects({ silent = false, persist = true, rerender = true } = {}) {
    const dom = scanProjectsFromDom();
    const cache = scanProjectsFromChatGPTCache();
    let backend = [];
    let backendOk = false;
    try {
      backend = await scanProjectsFromBackend();
      backendOk = true;
    } catch (err) {
      if (!silent) statusEl.textContent = `项目接口读取失败，已使用页面缓存：${err.message}`;
    }

    const merged = new Map();
    const base = backendOk && backend.length ? backend : [...cache, ...dom];
    for (const p of base) {
      const id = canonicalProjectId(p.id || p.url);
      if (!id) continue;
      merged.set(id, { ...(merged.get(id) || {}), ...p, id });
    }
    // DOM/cache 仅用于补充名称或带 slug 的可打开 URL，不再额外创建项目。
    for (const p of [...cache, ...dom]) {
      const id = canonicalProjectId(p.id || p.url);
      if (!id || !merged.has(id)) continue;
      const old = merged.get(id);
      merged.set(id, {
        ...p,
        ...old,
        id,
        name: old.name || p.name,
        url: (p.source === 'dom' && p.url) ? p.url : (old.url || p.url)
      });
    }

    let found = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (!found.length) {
      if (!silent) statusEl.textContent = '暂未识别到官方 Project，请确认 ChatGPT 左栏可以看到项目。';
      return 0;
    }

    // 后端偶发分页/灰度异常时可能短暂少返回 Project。不要一次异常就把本地项目整块删除；
    // 连续 3 次成功后端扫描都缺失，才把该 Project 视为真正删除。
    const foundIds = new Set(found.map(p => p.id));
    if (backendOk) {
      for (const old of state.projects || []) {
        const id = canonicalProjectId(old.id);
        if (!id || foundIds.has(id)) continue;
        const missingOfficialCount = Number(old.missingOfficialCount || 0) + 1;
        if (missingOfficialCount < 3) found.push({ ...old, id, missingOfficialCount, source:old.source || 'stale-backend' });
      }
      found.sort((a,b) => a.name.localeCompare(b.name, 'zh-CN'));
    }

    const now = new Date().toISOString();
    const beforeSignature = JSON.stringify((state.projects || []).map(p => [canonicalProjectId(p.id), p.name || '', p.url || '']).sort());
    const existingMap = new Map(state.projects.map(p => [canonicalProjectId(p.id), p]));
    state.projects = found.map(project => {
      const old = existingMap.get(project.id) || {};
      const presentNow = merged.has(project.id);
      return { ...old, ...project, id:project.id, missingOfficialCount:presentNow ? 0 : Number(project.missingOfficialCount || 0), lastSeenAt:presentNow ? now : (old.lastSeenAt || now) };
    });
    state.projectOrder = projectOrderIds();
    state.lastProjectSyncAt = now;

    migrateCanonicalProjectIds();
    if (!state.selectedProjectId || !getProject(state.selectedProjectId)) {
      state.selectedProjectId = state.projects[0]?.id || null;
      state.selectedFolderId = null;
    }
    const afterSignature = JSON.stringify((state.projects || []).map(p => [canonicalProjectId(p.id), p.name || '', p.url || '']).sort());
    const structurallyChanged = beforeSignature !== afterSignature;

    if (persist) {
      if (silent) persistStateSoon({ snapshot:false });
      else await saveState({ snapshot:false });
    }
    refreshHistoryBaselineAfterExternalSync();
    if (rerender && (structurallyChanged || !silent)) render();
    if (!silent) statusEl.textContent = `已识别 ${found.length} 个官方 Project（已自动去重）`;
    return found.length;
  }

  async function fetchProjectConversationList(projectId) {
    const all = [];
    let cursor = '0';
    const seenCursors = new Set();
    for (let page = 0; page < 100 && cursor != null; page++) {
      if (seenCursors.has(String(cursor))) break;
      seenCursors.add(String(cursor));
      const data = await apiGet(`/backend-api/gizmos/${encodeURIComponent(projectId)}/conversations?cursor=${encodeURIComponent(cursor)}`);
      const items = Array.isArray(data?.items) ? data.items : [];
      all.push(...items);
      if (!items.length) break;
      cursor = data?.cursor ?? null;
    }
    return all;
  }


  async function fetchUnassignedConversationList() {
    const all = [];
    const seenIds = new Set();
    const limit = 100;
    let offset = 0;
    for (let page = 0; page < 200; page++) {
      // Recents / 未归项目 must exclude archived and pinned conversations.
      // Pinned chats have their own official section and may include Project chats.
      const data = await apiGet(`/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated&is_archived=false&is_starred=false`);
      const items = Array.isArray(data?.items) ? data.items : [];
      let added = 0;
      for (const item of items) {
        const id = String(item?.id || '');
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        all.push(item);
        added++;
      }
      offset += items.length;
      const total = Number(data?.total || 0);
      if (!items.length || !added || items.length < limit || (total && offset >= total)) break;
    }
    return all;
  }

  function mergeUnassignedChats(items, { authoritativeProjectChatIds = null } = {}) {
    const now = new Date().toISOString();
    const projectChatIds = authoritativeProjectChatIds || new Set(state.chats.filter(c => c.projectId && !isUnassignedProject(c.projectId)).map(c => c.id));
    const existing = new Map(state.chats.map(c => [c.id, c]));
    let count = 0;
    for (const item of items || []) {
      if (!item?.id) continue;
      const id = String(item.id);
      const embeddedProjectId = canonicalProjectId(item?.gizmo_id || item?.conversation_template_id || item?.gizmo?.id);
      if (embeddedProjectId && embeddedProjectId.startsWith('g-p-')) continue;
      if (projectChatIds.has(id)) continue;
      const title = normalizeText(item.title) || '未命名聊天';
      const parsed = parsePathMarker(title);
      let chat = existing.get(id);
      if (!chat) {
        chat = { id, createdAt: now, source: 'official-unassigned' };
        state.chats.push(chat);
        existing.set(id, chat);
      }
      if (chat.pendingOfficialSync || hasPendingOfficialForChat(id) || chat.lifecycleState) {
        chat.remoteObservedTitle = title;
        chat.lastSeenAt = now;
        continue;
      }
      chat.projectId = UNASSIGNED_PROJECT_ID;
      chat.folderId = null;
      chat.localName = parsed.baseTitle || title;
      chat.officialTitle = title;
      chat.url = `https://chatgpt.com/c/${id}`;
      chat.createTime = item.create_time ?? item.createTime ?? chat.createTime ?? null;
      chat.updateTime = item.update_time ?? item.updateTime ?? chat.updateTime ?? null;
      chat.updatedAt = now;
      chat.lastSeenAt = now;
      chat.source = 'official-unassigned';
      chat.officialStarred = itemIsOfficiallyPinned(item);
      count++;
    }
    return count;
  }

  async function syncUnassignedChats({ silent = false } = {}) {
    if (!silent) statusEl.textContent = '正在读取未归项目聊天…';
    const items = await fetchUnassignedConversationList();
    const count = mergeUnassignedChats(items);
    await saveState({ snapshot: false });
    refreshHistoryBaselineAfterExternalSync();
    render();
    if (!silent) statusEl.textContent = `未归项目聊天已同步 ${count} 条`;
    return count;
  }

  function mergeOfficialChats(projectId, items) {
    projectId = canonicalProjectId(projectId);
    const now = new Date().toISOString();
    const existing = new Map(state.chats.map(c => [c.id, c]));
    let recoveredMarkers = 0;
    for (const item of items) {
      if (!item?.id) continue;
      const id = String(item.id);
      const title = normalizeText(item.title) || '未命名聊天';
      const parsed = parsePathMarker(title);
      const old = existing.get(id);

      // 本地用户操作尚未完成官方同步时，本地目录/标题是唯一真源。
      // 不能让后台列表里“稍旧的 CE 标记”反向创建旧目录，否则文件夹重命名/撤销会出现两个目录。
      if (old && (old.pendingOfficialSync || hasPendingOfficialForChat(id) || old.lifecycleState)) {
        old.remoteObservedTitle = title;
        old.updateTime = item.update_time ?? item.updateTime ?? old.updateTime;
        old.createTime = item.create_time ?? item.createTime ?? old.createTime;
        old.lastSeenAt = now;
        continue;
      }

      const markerFolderId = parsed.hasMarker ? ensureFolderPath(projectId, parsed.path) : null;
      if (parsed.hasMarker) recoveredMarkers++;
      if (old) {
        old.projectId = projectId;
        if (old.folderId && getFolder(old.folderId)?.projectId !== projectId) old.folderId = null;
        if (parsed.hasMarker) old.folderId = markerFolderId || null;
        old.officialTitle = title;
        if (!old.localName || parsed.hasMarker) old.localName = parsed.baseTitle;
        old.url = `https://chatgpt.com/g/${projectId}/c/${id}`;
        old.updateTime = item.update_time ?? item.updateTime ?? old.updateTime;
        old.createTime = item.create_time ?? item.createTime ?? old.createTime;
        old.lastSeenAt = now;
        old.source = 'official-project';
        old.officialStarred = itemIsOfficiallyPinned(item);
      } else {
        const chat = {
          id, projectId, folderId:markerFolderId || null,
          localName:parsed.baseTitle || title, officialTitle:title,
          url:`https://chatgpt.com/g/${projectId}/c/${id}`,
          createTime:item.create_time ?? item.createTime ?? null,
          updateTime:item.update_time ?? item.updateTime ?? null,
          createdAt:now, updatedAt:now, lastSeenAt:now, source:'official-project',
          officialStarred:itemIsOfficiallyPinned(item)
        };
        state.chats.push(chat);
        existing.set(id, chat);
      }
    }
    cleanupRecoveredEmptyFolders();
    return recoveredMarkers;
  }

  async function syncProjectChats(projectId, { silent = false } = {}) {
    const project = getProject(projectId);
    if (!project) return 0;
    if (!silent) statusEl.textContent = `正在读取「${project.name}」中的聊天…`;
    const items = await fetchProjectConversationList(projectId);
    const recoveredMarkers = mergeOfficialChats(projectId, items);
    project.lastChatsSyncAt = new Date().toISOString();
    await saveState({ snapshot: false });
    refreshHistoryBaselineAfterExternalSync();
    render();
    if (!silent) statusEl.textContent = recoveredMarkers ? `「${project.name}」已同步 ${items.length} 条聊天，并从 ${recoveredMarkers} 个路径标识恢复/校准本地目录` : `「${project.name}」已同步 ${items.length} 条聊天`;
    return items.length;
  }

  async function runWithConcurrency(items, limit, worker) {
    const list = Array.from(items || []);
    if (!list.length) return;
    let nextIndex = 0;
    const count = Math.max(1, Math.min(Number(limit) || 1, list.length));
    const runners = Array.from({ length:count }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= list.length) return;
        await worker(list[index], index);
      }
    });
    await Promise.all(runners);
  }

  function pruneStaleChatsAfterFullSync({ authoritativeProjectChatIds, unassignedIds, projectResults }) {
    const pinned = new Set(state.pinnedChats || []);
    let removed = 0;
    for (const chat of [...(state.chats || [])]) {
      if (!chat?.id || chat.pendingOfficialSync || hasPendingOfficialForChat(chat.id) || chat.lifecycleState) continue;
      const id = String(chat.id);
      if (authoritativeProjectChatIds.has(id) || unassignedIds.has(id) || pinned.has(id)) continue;

      if (isUnassignedProject(chat.projectId)) {
        // 未归项目列表本次成功读取且找不到该聊天：通常是外部归档/删除。
        removeChatFromLocalIndex(id);
        removed++;
        continue;
      }

      const projectId = canonicalProjectId(chat.projectId) || chat.projectId;
      const projectResult = projectResults.get(projectId);
      if (projectResult && !projectResult.error) {
        // 该 Project 已完整同步但不再包含此聊天：通常是外部移动/归档/删除。
        removeChatFromLocalIndex(id);
        removed++;
      }
    }
    if (removed) cleanupRecoveredEmptyFolders();
    return removed;
  }

  async function syncAllData({ silent = false } = {}) {
    if (syncing) return;
    syncing = true;
    try {
      await syncOfficialProjects({ silent:true, persist:false, rerender:false });
      let total = 0;
      let recoveredMarkers = 0;
      let completed = 0;
      const projectResults = new Map();

      // 未归项目的网络请求与 Project 请求并行发出。Project 列表先全部取完，再按固定顺序合并，
      // 避免并发完成顺序导致同一聊天的 projectId 被“最后返回的请求”偶发覆盖。
      const unassignedPromise = fetchUnassignedConversationList()
        .then(items => ({ items, error:null }))
        .catch(error => ({ items:[], error }));

      await runWithConcurrency(state.projects, FULL_SYNC_CONCURRENCY, async project => {
        try {
          const items = await fetchProjectConversationList(project.id);
          projectResults.set(project.id, { items, error:null });
        } catch (error) {
          projectResults.set(project.id, { items:[], error });
        } finally {
          completed++;
          if (!silent && statusEl) statusEl.textContent = `后台同步项目聊天 ${completed}/${state.projects.length}`;
        }
      });

      const authoritativeProjectChatIds = new Set();
      for (const project of state.projects) {
        const result = projectResults.get(project.id);
        if (!result || result.error) {
          if (result?.error) project.lastSyncError = String(result.error?.message || result.error);
          continue;
        }
        project.lastSyncError = null;
        for (const item of result.items || []) if (item?.id) authoritativeProjectChatIds.add(String(item.id));
        recoveredMarkers += mergeOfficialChats(project.id, result.items);
        project.lastChatsSyncAt = new Date().toISOString();
        total += result.items.length;
      }

      let unassigned = 0;
      const unassignedIds = new Set();
      const unassignedResult = await unassignedPromise;
      if (!unassignedResult.error) {
        for (const item of unassignedResult.items || []) if (item?.id) unassignedIds.add(String(item.id));
        unassigned = mergeUnassignedChats(unassignedResult.items, { authoritativeProjectChatIds });
      } else if (!silent && statusEl) {
        statusEl.textContent = `未归项目聊天读取失败：${unassignedResult.error?.message || unassignedResult.error}`;
      }

      await syncOfficialPins({ silent:true });
      if (!unassignedResult.error) {
        pruneStaleChatsAfterFullSync({ authoritativeProjectChatIds, unassignedIds, projectResults });
      }
      state.lastFullSyncAt = new Date().toISOString();
      await saveState();
      refreshHistoryBaselineAfterExternalSync();
      render();
      if (!silent && statusEl) statusEl.textContent = recoveredMarkers
        ? `同步完成：${state.projects.length} 个项目，读取 ${total} 条项目聊天 + ${unassigned} 条未归项目聊天；检测到 ${recoveredMarkers} 个 CE 路径标识并恢复/校准目录`
        : `同步完成：${state.projects.length} 个项目，读取 ${total} 条项目聊天 + ${unassigned} 条未归项目聊天`;
    } catch (err) {
      if (statusEl) statusEl.textContent = `同步失败：${err?.message || err}`;
    } finally {
      syncing = false;
    }
  }

  function renderPinnedRows() {
    const rows = [];
    for (const id of state.pinnedChats || []) {
      const chat = getChat(id);
      if (!chat || chat.lifecycleState) continue;
      const project = getProject(chat.projectId);
      const path = chat.folderId ? folderPath(chat.folderId).join(' / ') : '';
      rows.push(`<div class="nav-row pinned-row" data-kind="pinned-chat" data-id="${chat.id}" data-project-id="${chat.projectId || ''}" title="${escapeHtml([project?.name, path, chat.localName].filter(Boolean).join(' / '))}">
        <span class="twisty">📌</span><span class="nav-icon">💬</span><span class="nav-label">${escapeHtml(chat.localName || '未命名聊天')}</span>
      </div>`);
    }
    if (!rows.length) rows.push(`<div class="nav-empty">${escapeHtml(t('pinEmpty'))}</div>`);
    return rows.join('');
  }

  function renderQuickRows() {
    const rows = [];
    for (const q of state.quickAccess) {
      if (q.type === 'folder') {
        const folder = getFolder(q.id);
        const project = folder ? getProject(folder.projectId) : null;
        if (!folder || !project) continue;
        rows.push(`<div class="nav-row quick-row" draggable="true" data-kind="folder" data-drop-target="folder" data-id="${folder.id}" data-project-id="${project.id}" title="${escapeHtml(project.name + ' / ' + folderPath(folder.id).join(' / '))}">
          <span class="twisty">★</span><span class="nav-icon">📁</span><span class="nav-label">${escapeHtml(folder.name)}</span>
        </div>`);
      } else if (q.type === 'project') {
        const project = getProject(q.id);
        if (!project) continue;
        rows.push(`<div class="nav-row quick-row" data-kind="project" data-drop-target="project" data-id="${project.id}" title="${escapeHtml(project.name)}">
          <span class="twisty">★</span><span class="nav-icon">🟦</span><span class="nav-label">${escapeHtml(project.name)}</span>
        </div>`);
      }
    }
    if (!rows.length) rows.push(`<div class="nav-empty">${escapeHtml(t('quickEmpty'))}</div>`);
    return rows.join('');
  }

  function navCollapseKey(kind, id) {
    return `${kind}:${String(id || '')}`;
  }

  function isNavCollapsed(kind, id) {
    return (state.navCollapsedKeys || []).includes(navCollapseKey(kind, id));
  }

  function setNavCollapsed(kind, id, collapsed) {
    const key = navCollapseKey(kind, id);
    const keys = new Set((state.navCollapsedKeys || []).map(String));
    if (collapsed) keys.add(key); else keys.delete(key);
    state.navCollapsedKeys = [...keys];
    persistStateSoon({ snapshot:false });
  }

  function toggleNavCollapsed(kind, id) {
    setNavCollapsed(kind, id, !isNavCollapsed(kind, id));
    renderNavigationTree();
  }

  function renderFolderTree(folder, depth = 1) {
    const selected = state.selectedFolderId === folder.id;
    const children = childFolders(folder.projectId, folder.id);
    const collapsed = children.length > 0 && isNavCollapsed('folder', folder.id);
    let html = `<div class="nav-row folder-tree ${selected ? 'active' : ''}" draggable="true" data-kind="folder" data-drop-target="folder" data-id="${folder.id}" data-project-id="${folder.projectId}" data-parent-id="${folder.parentId || ''}" title="拖到同级文件夹上/下边缘可调整顺序；拖到中间可移入该文件夹" style="--depth:${depth}">
      <span class="twisty ${children.length ? 'twisty-toggle' : ''}" data-twisty-kind="folder" data-twisty-id="${folder.id}" title="${children.length ? (collapsed ? escapeHtml(t('expand')) : escapeHtml(t('collapse'))) : ''}">${children.length ? (collapsed ? '▸' : '▾') : '·'}</span><span class="nav-icon">📁</span><span class="nav-label">${escapeHtml(folder.name)}</span>
    </div>`;
    if (!collapsed) for (const child of children) html += renderFolderTree(child, depth + 1);
    return html;
  }

  function renderChatRootRows() {
    const unassignedCount = state.chats.filter(c => !c.lifecycleState && isUnassignedProject(c.projectId) && !isPinnedChat(c.id)).length;
    const active = state.selectedProjectId === UNASSIGNED_PROJECT_ID;
    return `<div class="nav-row project-tree ${active ? 'active' : ''}" data-kind="unassigned" data-drop-target="unassigned" data-project-id="${UNASSIGNED_PROJECT_ID}" data-id="${UNASSIGNED_PROJECT_ID}" style="--depth:0">
      <span class="twisty">·</span><span class="nav-icon">📥</span><span class="nav-label">${escapeHtml(t('unassigned'))}${unassignedCount ? ` (${unassignedCount})` : ''}</span>
    </div>`;
  }

  function renderProjectRows() {
    let html = '';
    if (!state.projects.length) html += `<div class="nav-empty">${escapeHtml(t('noProjects'))}</div>`;
    for (const project of orderedProjects()) {
      const active = state.selectedProjectId === project.id && !state.selectedFolderId;
      const roots = childFolders(project.id, null);
      const collapsed = roots.length > 0 && isNavCollapsed('project', project.id);
      html += `<div class="nav-row project-tree ${active ? 'active' : ''}" draggable="true" data-kind="project" data-drop-target="project" data-id="${project.id}" data-project-id="${project.id}" title="拖到其他 Project 上/下半部可调整显示顺序" style="--depth:0">
        <span class="twisty ${roots.length ? 'twisty-toggle' : ''}" data-twisty-kind="project" data-twisty-id="${project.id}" title="${roots.length ? (collapsed ? escapeHtml(t('expand')) : escapeHtml(t('collapse'))) : ''}">${roots.length ? (collapsed ? '▸' : '▾') : '·'}</span><span class="nav-icon">🟦</span><span class="nav-label">${escapeHtml(project.name)}</span>
      </div>`;
      if (!collapsed) for (const folder of roots) html += renderFolderTree(folder, 1);
    }
    return html;
  }

  function navSectionStyle(key) {
    const ratios = normalizeNavSectionRatios(state.navSectionRatios);
    return `flex:${ratios[key]} 1 0`;
  }

  function renderNavigationTree() {
    state.navSectionRatios = normalizeNavSectionRatios(state.navSectionRatios);
    treeEl.innerHTML = `
      <section class="nav-block" data-nav-section="pinned" style="${navSectionStyle('pinned')}">
        <div class="nav-section-title">${escapeHtml(t('pinned'))}</div><div class="nav-section-scroll">${renderPinnedRows()}</div>
      </section>
      <div class="nav-splitter" data-above="pinned" data-below="quick" title="${escapeHtml(t('resizeSection'))}"></div>
      <section class="nav-block" data-nav-section="quick" style="${navSectionStyle('quick')}">
        <div class="nav-section-title">${escapeHtml(t('quick'))}</div><div class="nav-section-scroll">${renderQuickRows()}</div>
      </section>
      <div class="nav-splitter" data-above="quick" data-below="chats" title="${escapeHtml(t('resizeSection'))}"></div>
      <section class="nav-block" data-nav-section="chats" style="${navSectionStyle('chats')}">
        <div class="nav-section-title">${escapeHtml(t('chats'))}</div><div class="nav-section-scroll">${renderChatRootRows()}</div>
      </section>
      <div class="nav-splitter" data-above="chats" data-below="projects" title="${escapeHtml(t('resizeSection'))}"></div>
      <section class="nav-block" data-nav-section="projects" style="${navSectionStyle('projects')}">
        <div class="nav-section-title">${escapeHtml(t('projects'))}</div><div class="nav-section-scroll">${renderProjectRows()}</div>
      </section>`;
  }

  function renderContentPane() {
    const project = getProject(state.selectedProjectId);
    if (!project) {
      contentEl.innerHTML = `<div class="content-empty">${escapeHtml(t('chooseProject'))}</div>`;
      return;
    }

    const entries = filteredEntries(project.id, isUnassignedProject(project.id) ? null : (state.selectedFolderId || null));
    const rows = [];
    for (const entry of entries) {
      if (entry.kind === 'folder') {
        const folder=entry.raw;
        rows.push(`<div class="file-row" draggable="true" data-kind="folder" data-drop-target="folder" data-id="${folder.id}" data-project-id="${project.id}">
          <div class="file-name"><span class="file-icon">📁</span><span>${escapeHtml(folder.name)}</span></div>
          <div class="file-type">${escapeHtml(t('folder'))}</div><div class="file-date">${formatDate(folder.updatedAt || folder.createdAt)}</div></div>`);
      } else if (entry.kind === 'chat') {
        const chat=entry.raw;
        rows.push(`<div class="file-row ${selectedChatIds.has(chat.id) ? 'selected' : ''}" draggable="true" data-kind="chat" data-id="${chat.id}" data-project-id="${project.id}" title="官方标题：${escapeHtml(chat.officialTitle || chat.localName)}">
          <div class="file-name"><span class="file-icon">💬</span><span>${escapeHtml(chat.localName)}</span></div>
          <div class="file-type">${escapeHtml(t('conversation'))}</div><div class="file-date">${formatDate(chat.updateTime || chat.updatedAt)}</div></div>`);
      } else {
        const sc=entry.raw;
        rows.push(`<div class="file-row shortcut-row" data-kind="shortcut" data-id="${sc.id}" data-project-id="${project.id}" title="指向：${escapeHtml(entry.target?.localName || sc.targetChatId)}">
          <div class="file-name"><span class="file-icon">🔗</span><span>${escapeHtml(entry.name)}</span></div>
          <div class="file-type">${escapeHtml(t('shortcut'))}</div><div class="file-date">${formatDate(sc.updatedAt || sc.createdAt)}</div></div>`);
      }
    }

    contentEl.dataset.viewMode = state.viewMode;
    if (!rows.length) {
      contentEl.innerHTML = `<div class="content-empty">${escapeHtml(state.searchQuery ? t('noMatches') : t('empty'))}<br><span>${escapeHtml(isUnassignedProject(project.id) ? t('unassignedHint') : t('projectEmptyHint'))}</span></div>`;
      return;
    }
    if (state.viewMode === 'details') contentEl.innerHTML = `<div class="details-head"><div>${escapeHtml(t('name'))}</div><div>${escapeHtml(t('type'))}</div><div>${escapeHtml(t('modified'))}</div></div>${rows.join('')}`;
    else contentEl.innerHTML = `<div class="icon-grid">${rows.join('')}</div>`;
  }

  function renderBreadcrumb() {
    const project = getProject(state.selectedProjectId);
    if (!project) {
      breadcrumbEl.innerHTML = `<span class="crumb-placeholder">${escapeHtml(t('chooseProjectShort'))}</span>`;
      return;
    }
    const parts = [`<button class="crumb-part" data-project-id="${project.id}" data-folder-id="">${isUnassignedProject(project.id) ? '📥 ' + escapeHtml(t('unassigned')) : escapeHtml(project.name)}</button>`];
    const chain = [];
    let folder = getFolder(state.selectedFolderId);
    const seen = new Set();
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      chain.unshift(folder);
      folder = folder.parentId ? getFolder(folder.parentId) : null;
    }
    for (const f of chain) {
      parts.push('<span class="crumb-sep">›</span>');
      parts.push(`<button class="crumb-part" data-project-id="${project.id}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`);
    }
    breadcrumbEl.innerHTML = parts.join('');
  }


  function findChatGPTAppShell() {
    const preferred = [
      document.getElementById('root'),
      document.getElementById('__next'),
      document.querySelector('[data-reactroot]')
    ].filter(Boolean);
    if (preferred.length) return preferred[0];

    const candidates = [...(document.body?.children || [])]
      .filter(el => el !== host && el instanceof HTMLElement);
    let best = null;
    let bestScore = -1;
    for (const el of candidates) {
      const rect = el.getBoundingClientRect();
      const hasMain = !!el.querySelector('main');
      const hasConversation = !!el.querySelector('a[href*="/c/"]');
      const score = (hasMain ? 1000000 : 0) + (hasConversation ? 500000 : 0) + Math.max(0, rect.width * rect.height);
      if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  function restoreAppShellLayout() {
    const previous = [...document.querySelectorAll('[data-cgpt-explorer-app-shell="1"]')];
    for (const el of previous) {
      const props = ['width','max-width','min-width','margin-right','right','box-sizing','transition','overflow-x'];
      for (const prop of props) {
        const key = `cgptOriginal${prop.replace(/-([a-z])/g, (_,c)=>c.toUpperCase()).replace(/^./, c=>c.toUpperCase())}`;
        const val = el.dataset[key];
        if (val == null || val === '') el.style.removeProperty(prop);
        else el.style.setProperty(prop, val);
        delete el.dataset[key];
      }
      delete el.dataset.cgptExplorerAppShell;
    }
  }

  function rememberInlineStyle(el, prop) {
    const key = `cgptOriginal${prop.replace(/-([a-z])/g, (_,c)=>c.toUpperCase()).replace(/^./, c=>c.toUpperCase())}`;
    if (!(key in el.dataset)) el.dataset[key] = el.style.getPropertyValue(prop) || '';
  }

  function appLayoutTargets() {
    // ChatGPT 的页面壳在不同版本里会变化。仅改最外层 root 有时不会影响真正的
    // 聊天布局，所以沿 main 向上寻找占据大部分视口宽度的布局容器。
    const targets = new Set();
    const app = findChatGPTAppShell();
    if (app) targets.add(app);

    const main = document.querySelector('main');
    let cur = main;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur instanceof HTMLElement) {
        const rect = cur.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.70) targets.add(cur);
      }
      cur = cur.parentElement;
    }
    return [...targets];
  }

  function applyPageInset() {
    const inset = state.panelOpen ? Math.min(1100, Math.max(560, state.panelWidth || 760)) : 0;
    document.documentElement.style.setProperty('--cgpt-explorer-inset', `${inset}px`);
    document.body?.classList.toggle('cgpt-explorer-open', inset > 0);

    let style = document.getElementById('cgpt-explorer-page-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'cgpt-explorer-page-style';
      style.textContent = `
        html, body { min-width: 0 !important; }
        body.cgpt-explorer-open { overflow-x: hidden !important; }
        body.cgpt-explorer-open main { min-width: 0 !important; }
      `;
      document.head.appendChild(style);
    }

    restoreAppShellLayout();
    if (!inset) return;

    // Explorer 的左边界就是 ChatGPT 可用区域的绝对右边界。
    // 0.7 的问题在于给“从 x=260 开始”的内层容器也设置成 viewport-inset 宽，
    // 它的右边缘自然会伸进 Explorer。现在每个容器都按自己的实际 left 计算宽度，
    // 所有层级的右边缘因此严格落在同一条分界线上。
    const boundaryX = Math.max(0, window.innerWidth - inset);
    for (const target of appLayoutTargets()) {
      const rect = target.getBoundingClientRect();
      const availablePx = Math.max(0, Math.floor(boundaryX - rect.left));
      target.dataset.cgptExplorerAppShell = '1';
      for (const prop of ['width','max-width','min-width','margin-right','right','box-sizing','transition','overflow-x']) rememberInlineStyle(target, prop);
      target.style.setProperty('width', `${availablePx}px`, 'important');
      target.style.setProperty('max-width', `${availablePx}px`, 'important');
      target.style.setProperty('min-width', '0px', 'important');
      target.style.setProperty('margin-right', '0px', 'important');
      target.style.setProperty('right', 'auto', 'important');
      target.style.setProperty('box-sizing', 'border-box', 'important');
      target.style.setProperty('transition', 'none', 'important');
      target.style.setProperty('overflow-x', 'hidden', 'important');
    }
  }

  function chatPayloadFromAnchor(anchor) {
    if (!anchor) return null;
    const href = anchor.href || anchor.getAttribute('href') || '';
    const match = href.match(/\/c\/([^/?#]+)/);
    if (!match) return null;
    const id = match[1];
    const projectMatch = href.match(/\/g\/(g-p-[^/?#]+)/);
    const existing = getChat(id);
    return {
      id,
      title: normalizeText(anchor.textContent) || existing?.localName || existing?.officialTitle || '未命名聊天',
      projectId: canonicalProjectId(projectMatch?.[1]) || existing?.projectId || UNASSIGNED_PROJECT_ID,
      url: href.startsWith('http') ? href : new URL(href, location.origin).href,
      source: 'official-sidebar'
    };
  }

  function chatUrl(chat) {
    if (!chat) return null;
    if (chat.url) return chat.url;
    return chat.projectId && !isUnassignedProject(chat.projectId)
      ? `https://chatgpt.com/g/${canonicalProjectId(chat.projectId)}/c/${chat.id}`
      : `https://chatgpt.com/c/${chat.id}`;
  }

  function openChatInPlace(chat) {
    if (!chat?.id) return;
    const targetUrl = new URL(chatUrl(chat), location.origin);
    const desiredPath = targetUrl.pathname;

    // Only click an official link whose route represents the same Project membership as our authoritative index.
    // A pinned Project chat may also have a generic /c/ID link; clicking that link would incorrectly leave
    // the Project route and was the cause of 0.14 moving the current route into “未归项目”.
    const anchors = [...document.querySelectorAll('a[href*="/c/"]')];
    const officialAnchor = anchors.find(a => {
      if (host?.contains(a)) return false;
      try {
        const u = new URL(a.getAttribute('href') || a.href || '', location.origin);
        return conversationIdFromHref(u.pathname) === String(chat.id) && u.pathname === desiredPath;
      } catch (_) { return false; }
    });
    if (officialAnchor) {
      officialAnchor.click();
      return;
    }

    // No correctly-scoped official link is currently rendered. Navigate to the authoritative route in-place.
    const next = `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (next === current) return;
    history.pushState(history.state, '', next);
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
  }

  function visibleChatIds() {
    if (!state.selectedProjectId) return [];
    return filteredEntries(state.selectedProjectId, state.selectedFolderId || null).filter(e => e.kind === 'chat').map(e => e.id);
  }

  function updateSelectionClasses() {
    if (!contentEl) return;
    contentEl.querySelectorAll('.file-row[data-kind="chat"]').forEach(row => {
      row.classList.toggle('selected', selectedChatIds.has(row.dataset.id));
    });
    const xb=shadow?.getElementById('cutBtn'); if(xb) xb.disabled=!selectedChatIds.size;
  }

  function clearChatSelection() {
    selectedChatIds.clear();
    selectionAnchorChatId = null;
    updateSelectionClasses();
  }

  function selectChatFromClick(chatId, event) {
    const ids = visibleChatIds();
    if (!ids.includes(chatId)) return;
    const additive = !!(event.ctrlKey || event.metaKey);

    if (event.shiftKey && selectionAnchorChatId && ids.includes(selectionAnchorChatId)) {
      const a = ids.indexOf(selectionAnchorChatId);
      const b = ids.indexOf(chatId);
      const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
      if (!additive) selectedChatIds.clear();
      range.forEach(id => selectedChatIds.add(id));
    } else if (additive) {
      if (selectedChatIds.has(chatId)) selectedChatIds.delete(chatId);
      else selectedChatIds.add(chatId);
      selectionAnchorChatId = chatId;
    } else {
      selectedChatIds.clear();
      selectedChatIds.add(chatId);
      selectionAnchorChatId = chatId;
    }
    updateSelectionClasses();
    selectedEntry = { kind: 'chat', id: chatId };
    statusEl.textContent = selectedChatIds.size > 1 ? `已选择 ${selectedChatIds.size} 个聊天，可直接一起拖动` : '已选择 1 个聊天';
  }

  function dragPayloadForChat(chat) {
    return {
      id: chat.id,
      title: chat.localName || chat.officialTitle,
      projectId: chat.projectId,
      url: chat.url,
      source: 'explorer'
    };
  }

  function setChatDragData(event, payload) {
    if (!payload || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-chatgpt-explorer-chat', JSON.stringify(payload));
    event.dataTransfer.setData('text/plain', payload.title || (payload.items?.length ? `${payload.items.length} 个聊天` : payload.id));
  }

  function readChatDragData(event) {
    try {
      const raw = event.dataTransfer?.getData('application/x-chatgpt-explorer-chat');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  async function dropChatIntoLocation(payload, targetProjectId, targetFolderId = null, options = {}) {
    if (!payload?.id || !targetProjectId) return;
    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    const targetIsUnassigned = isUnassignedProject(targetProjectId);

    const existing = getChat(payload.id);
    const payloadProjectId = payload.projectId === UNASSIGNED_PROJECT_ID ? UNASSIGNED_PROJECT_ID : (canonicalProjectId(payload.projectId) || payload.projectId || null);
    const sourceProjectId = payloadProjectId || existing?.projectId || UNASSIGNED_PROJECT_ID;
    const targetProject = getProject(targetProjectId);
    targetFolderId = targetIsUnassigned ? null : targetFolderId;
    const targetFolder = targetFolderId ? getFolder(targetFolderId) : null;
    if (!targetProject) throw new Error('目标位置无效');
    if (!targetIsUnassigned && targetProject.virtual) throw new Error('目标必须是官方 Project 或其本地文件夹');
    if (targetFolder && targetFolder.projectId !== targetProjectId) throw new Error('目标文件夹与 Project 不匹配');

    const localName = localNameForMove(existing, payload);
    const newOfficialTitle = officialTitleForLocation(localName, targetFolderId || null);
    const now = new Date().toISOString();
    const previousChat = existing ? structuredClone(existing) : null;
    const chat = existing || { id: payload.id, createdAt: now, source: payload.source || 'drag' };

    chat.projectId = targetProjectId;
    chat.folderId = targetFolderId || null;
    chat.localName = localName;
    chat.officialTitle = newOfficialTitle;
    chat.url = targetIsUnassigned ? `https://chatgpt.com/c/${payload.id}` : `https://chatgpt.com/g/${targetProjectId}/c/${payload.id}`;
    chat.updatedAt = now;
    chat.pendingOfficialSync = true;
    if (!existing) state.chats.push(chat);

    // 本地资源管理器先立即完成，官方操作排队慢慢同步。
    if (!options.deferRender) render();
    recordLocalMutation('chat-move-local', { conversationId:payload.id, targetProjectId, targetFolderId }, { snapshot:true });
    enqueueOfficialChatSync({
      conversationId: payload.id,
      sourceProjectId,
      targetProjectId,
      targetFolderId,
      desiredTitle: newOfficialTitle,
      previousChat
    });

    const locationLabel = `${targetProject.name}${targetFolder ? ' / ' + folderPath(targetFolder.id).join(' / ') : ''}`;
    statusEl.textContent = `已立即放入：${locationLabel} · 官方同步已加入队列（${state.pendingOperations.length}）`;
  }

  async function dropChatsIntoLocation(payload, targetProjectId, targetFolderId = null) {
    const items = Array.isArray(payload?.items) && payload.items.length ? payload.items : [payload];
    const unique = [];
    const seen = new Set();
    for (const item of items) if (item?.id && !seen.has(item.id)) { seen.add(item.id); unique.push(item); }
    if (!unique.length) return;
    if (unique.length === 1) return dropChatIntoLocation(unique[0], targetProjectId, targetFolderId);

    targetProjectId = canonicalProjectId(targetProjectId) || targetProjectId;
    const targetIsUnassigned = isUnassignedProject(targetProjectId);
    const targetProject = getProject(targetProjectId);
    targetFolderId = targetIsUnassigned ? null : targetFolderId;
    const targetFolder = targetFolderId ? getFolder(targetFolderId) : null;
    if (!targetProject || (!targetIsUnassigned && targetProject.virtual)) throw new Error('目标必须是“未归项目”、官方 Project 或其本地文件夹');

    const officialOps = [];
    for (const item of unique) {
      const existing = getChat(item.id);
      const itemProjectId = item.projectId === UNASSIGNED_PROJECT_ID ? UNASSIGNED_PROJECT_ID : (canonicalProjectId(item.projectId) || item.projectId || null);
      const sourceProjectId = itemProjectId || existing?.projectId || UNASSIGNED_PROJECT_ID;
      const previousChat = existing ? structuredClone(existing) : null;
      const localName = localNameForMove(existing, item);
      const desiredTitle = officialTitleForLocation(localName, targetFolderId || null);
      const chat = existing || { id: item.id, createdAt: new Date().toISOString(), source: item.source || 'drag' };
      chat.projectId = targetProjectId;
      chat.folderId = targetFolderId || null;
      chat.localName = localName;
      chat.officialTitle = desiredTitle;
      chat.url = targetIsUnassigned ? `https://chatgpt.com/c/${item.id}` : `https://chatgpt.com/g/${targetProjectId}/c/${item.id}`;
      chat.updatedAt = new Date().toISOString();
      chat.pendingOfficialSync = true;
      if (!existing) state.chats.push(chat);
      officialOps.push({ conversationId: item.id, sourceProjectId, targetProjectId, targetFolderId, desiredTitle, previousChat });
    }

    selectedChatIds.clear();
    selectionAnchorChatId = null;
    render();
    recordLocalMutation('chat-move-local-batch', { count:unique.length, targetProjectId, targetFolderId }, { snapshot:true });
    for (const op of officialOps) enqueueOfficialChatSync(op);
    statusEl.textContent = `已立即移动 ${unique.length} 个聊天 · ${state.pendingOperations.length} 项官方操作正在队列中`;
  }

  function setupOfficialSidebarDrag() {
    document.addEventListener('dragstart', event => {
      if (!state.initialized || !state.panelOpen) return;
      const path = event.composedPath?.() || [];
      const anchor = path.find(el => el instanceof HTMLAnchorElement && /\/c\//.test(el.getAttribute('href') || el.href || ''))
        || event.target?.closest?.('a[href*="/c/"]');
      if (!anchor || host?.contains(anchor)) return;
      const payload = chatPayloadFromAnchor(anchor);
      if (payload) setChatDragData(event, payload);
    }, true);
  }

  function setFolderDragData(event, folder) {
    if (!event?.dataTransfer || !folder) return;
    activeTreeDrag = { kind:'folder', id:folder.id, projectId:folder.projectId, parentId:folder.parentId || null };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-chatgpt-explorer-folder', JSON.stringify({ id:folder.id, projectId:folder.projectId, name:folder.name }));
    event.dataTransfer.setData('text/plain', folder.name || '文件夹');
  }

  function readFolderDragData(event) {
    try {
      const raw = event?.dataTransfer?.getData('application/x-chatgpt-explorer-folder');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function clearDropHighlights() {
    shadow?.querySelectorAll('.drop-target-active,.reorder-before,.reorder-after').forEach(el => {
      el.classList.remove('drop-target-active','reorder-before','reorder-after');
    });
  }

  function setProjectOrderDragData(event, project) {
    if (!event?.dataTransfer || !project) return;
    activeTreeDrag = { kind:'project', id:project.id };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-chatgpt-explorer-project-order', JSON.stringify({ id:project.id, name:project.name }));
    event.dataTransfer.setData('text/plain', project.name || 'Project');
  }

  function readProjectOrderDragData(event) {
    try {
      const raw = event?.dataTransfer?.getData('application/x-chatgpt-explorer-project-order');
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function treeReorderPosition(event, row, kind) {
    if (!row || !activeTreeDrag || activeTreeDrag.kind !== kind || activeTreeDrag.id === row.dataset.id) return null;
    const rect = row.getBoundingClientRect();
    if (!rect.height) return null;
    const ratio = (event.clientY - rect.top) / rect.height;
    if (kind === 'project') return ratio < 0.5 ? 'before' : 'after';
    if (kind === 'folder') {
      const source = getFolder(activeTreeDrag.id), target = getFolder(row.dataset.id);
      if (!source || !target || source.projectId !== target.projectId || (source.parentId || null) !== (target.parentId || null)) return null;
      if (ratio <= 0.30) return 'before';
      if (ratio >= 0.70) return 'after';
    }
    return null;
  }

  function clampedNavPaneWidth(value) {
    const bodyWidth = workspaceBodyEl?.clientWidth || Math.min(1100, Math.max(560, state.panelWidth || 760));
    const minWidth = 160;
    const maxWidth = Math.max(minWidth, Math.min(520, bodyWidth - 260));
    const n = Number.isFinite(Number(value)) ? Number(value) : 230;
    return Math.round(Math.min(maxWidth, Math.max(minWidth, n)));
  }

  function applyNavPaneWidth() {
    if (!navPaneEl) return;
    state.navPaneWidth = clampedNavPaneWidth(state.navPaneWidth);
    navPaneEl.style.width = `${state.navPaneWidth}px`;
    navPaneEl.style.flex = `0 0 ${state.navPaneWidth}px`;
  }

  function render() {
    if (!shadow) return;
    applyTheme();
    applyStaticUiLocalization();
    panel.classList.toggle('open', state.panelOpen);
    panel.style.width = `${Math.min(1100, Math.max(560, state.panelWidth || 760))}px`;
    applyNavPaneWidth();
    applyPageInset();
    const viewModeSelect = shadow.getElementById('viewMode');
    if (viewModeSelect) viewModeSelect.value = state.viewMode;
    const searchInput = shadow.getElementById('searchInput'); if (searchInput && searchInput.value !== state.searchQuery) searchInput.value = state.searchQuery || '';
    const sortBy = shadow.getElementById('sortBy'); if (sortBy) sortBy.value = state.sortBy;
    const sortDirection = shadow.getElementById('sortDirection'); if (sortDirection) sortDirection.textContent = state.sortDirection === 'desc' ? '↓' : '↑';
    const newFolderBtn = shadow.getElementById('newFolder');
    if (newFolderBtn) newFolderBtn.disabled = isUnassignedProject(state.selectedProjectId);
    const currentDrop = shadow.getElementById('contentPane');
    if (currentDrop) {
      currentDrop.dataset.projectId = state.selectedProjectId || '';
      currentDrop.dataset.folderId = state.selectedFolderId || '';
    }

    if (!state.initialized) {
      wizardEl.hidden = false;
      shadow.getElementById('workspaceBody').hidden = true;
      statusEl.textContent = t('initializedNeedWorkspace');
      return;
    }

    wizardEl.hidden = true;
    shadow.getElementById('workspaceBody').hidden = false;
    renderNavigationTree();
    renderContentPane();
    renderBreadcrumb();

    const synced = state.lastFullSyncAt ? ` · 上次同步 ${formatDate(state.lastFullSyncAt)}` : '';
    const unassignedCount = state.chats.filter(c => !c.lifecycleState && isUnassignedProject(c.projectId) && !isPinnedChat(c.id)).length;
    const pending = state.pendingOperations.length ? ` · ${state.pendingOperations.length} 项待同步` : '';
    const acct = currentAccountIdentity?.fingerprint ? ` · 账号隔离 ${currentAccountIdentity.fingerprint.slice(0,8)}` : '';
    statusEl.textContent = `${state.projects.length} 个官方 Project · ${(state.pinnedChats||[]).length} 条置顶 · ${unassignedCount} 条未归项目聊天 · ${state.folders.length} 个本地文件夹 · ${state.chats.length} 个聊天索引${pending}${synced}${acct}`;
    const ub=shadow.getElementById('undoBtn'); if(ub) ub.disabled=!(state.undoStack||[]).length;
    const rb=shadow.getElementById('redoBtn'); if(rb) rb.disabled=!(state.redoStack||[]).length;
    const xb=shadow.getElementById('cutBtn'); if(xb) xb.disabled=!selectedChatIds.size;
    const pb=shadow.getElementById('pasteBtn'); if(pb) pb.disabled=!state.clipboard?.items?.length;
  }

  async function chooseWorkspace() {
    if (!window.showDirectoryPicker) {
      alert('当前浏览器环境不支持目录选择。请使用较新的 Chrome/Edge。');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (!(await ensureWorkspacePermission(handle))) return;
      await globalThis.ChatGPTExplorerIDB.setHandle(accountHandleKey(), handle);
      let existingSnapshot = await readWorkspaceSnapshot(handle);
      if (!existingSnapshot) {
        const migrationInfo = await chrome.storage.local.get(LEGACY_MIGRATION_KEY);
        const legacyOwner = migrationInfo[LEGACY_MIGRATION_KEY];
        if (!legacyOwner || legacyOwner === currentAccountIdentity?.fingerprint) {
          try {
            const legacyFile = await handle.getFileHandle('workspace.json');
            const legacyData = JSON.parse(await (await legacyFile.getFile()).text());
            if (!legacyData?.accountIdentity || legacyData.accountIdentity.fingerprint === currentAccountIdentity?.fingerprint) existingSnapshot = legacyData;
          } catch (_) {}
        }
      }
      state.initialized = true;
      state.workspaceName = handle.name || existingSnapshot?.workspaceName || APP_NAME;
      state.panelOpen = true;
      restoreSnapshot(existingSnapshot);
      await saveState();
      render();
      setTimeout(() => syncAllData({ silent: false }), 400);
    } catch (err) {
      if (err?.name !== 'AbortError') alert(`选择工作区失败：${err?.message || err}`);
    }
  }

  function currentLocation() {
    return { projectId: state.selectedProjectId || null, folderId: state.selectedFolderId || null };
  }

  async function navigateTo(projectId, folderId = null, { pushHistory = true } = {}) {
    if (!projectId) return;
    if (pushHistory && state.selectedProjectId) {
      navBackStack.push(currentLocation());
      if (navBackStack.length > 100) navBackStack.shift();
      navForwardStack = [];
    }
    state.selectedProjectId = projectId;
    state.selectedFolderId = folderId || null;
    selectedEntry = null;
    selectedChatIds.clear();
    selectionAnchorChatId = null;
    render();
    persistStateSoon({ snapshot: false });

    const project = getProject(projectId);
    const age = Date.now() - toEpoch(project?.lastChatsSyncAt);
    if (isUnassignedProject(projectId)) {
      syncUnassignedChats({ silent: true }).catch(() => {});
    } else if (project && (!project.lastChatsSyncAt || age > AUTO_FULL_SYNC_MS)) {
      syncProjectChats(projectId, { silent: true }).catch(() => {});
    }
  }

  async function goBack() {
    const target = navBackStack.pop();
    if (!target) return;
    navForwardStack.push(currentLocation());
    await navigateTo(target.projectId, target.folderId, { pushHistory: false });
  }

  async function goForward() {
    const target = navForwardStack.pop();
    if (!target) return;
    navBackStack.push(currentLocation());
    await navigateTo(target.projectId, target.folderId, { pushHistory: false });
  }

  async function goUp() {
    if (!state.selectedProjectId) return;
    if (!state.selectedFolderId) return;
    const folder = getFolder(state.selectedFolderId);
    await navigateTo(state.selectedProjectId, folder?.parentId || null);
  }

  async function addFolder(parentFolderId = state.selectedFolderId, projectId = state.selectedProjectId) {
    if (!projectId || isUnassignedProject(projectId)) {
      alert('请先选择一个蓝色的官方 Project。未归项目只用于查看和拖出聊天，不创建本地子文件夹。');
      return;
    }
    const parent = parentFolderId ? getFolder(parentFolderId) : null;
    if (parent && parent.projectId !== projectId) parentFolderId = null;
    const name = prompt('文件夹名称：');
    if (!name?.trim()) return;
    state.folders.push({
      id: uid('folder'),
      name: name.trim(),
      projectId,
      parentId: parentFolderId || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    render();
    recordLocalMutation('folder-create', { projectId, parentFolderId, name:name.trim() });
  }

  async function renameFolder(folderId) {
    const folder = getFolder(folderId);
    if (!folder) return;
    const name = prompt('新的文件夹名称：', folder.name);
    if (!name?.trim() || name.trim() === folder.name) return;
    const affected = chatsInFolderSubtree(folder.id);
    const previous = previousChatMap(affected);
    const oldName = folder.name;
    folder.name = name.trim();
    folder.updatedAt = new Date().toISOString();
    render();
    recordLocalMutation('folder-rename', { folderId, from:oldName, to:folder.name }, { label:'重命名文件夹' });
    enqueuePathRefreshForChats(affected, previous, '文件夹重命名后的路径');
  }

  function descendantFolderIds(folderId) {
    const ids = new Set([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const f of state.folders) {
        if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
          ids.add(f.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  async function deleteFolder(folderId) {
    const folder = getFolder(folderId);
    if (!folder) return;
    const ids = descendantFolderIds(folder.id);
    const containedChats = state.chats.filter(c => c.folderId && ids.has(c.folderId));
    const childCount = ids.size - 1;
    const msg = `删除本地文件夹「${folder.name}」？\n\n` +
      `包含 ${childCount} 个子文件夹、${containedChats.length} 条聊天索引。\n` +
      `不会删除 ChatGPT 官方聊天；这些聊天会移到上一级本地目录。`;
    if (!confirm(msg)) return;

    const fallbackFolderId = folder.parentId || null;
    const previous = previousChatMap(containedChats);
    for (const chat of containedChats) chat.folderId = fallbackFolderId;
    state.folders = state.folders.filter(f => !ids.has(f.id));
    for (const id of ids) removeFolderFromManualOrders(id);
    if (state.folderOrders && typeof state.folderOrders === 'object') {
      for (const key of Object.keys(state.folderOrders)) {
        if (key.startsWith('parent:') && ids.has(key.slice('parent:'.length))) delete state.folderOrders[key];
      }
    }
    state.quickAccess = state.quickAccess.filter(q => q.type !== 'folder' || !ids.has(q.id));
    if (state.selectedFolderId && ids.has(state.selectedFolderId)) state.selectedFolderId = fallbackFolderId;
    render();
    recordLocalMutation('folder-delete', { folderId, movedChats:containedChats.length }, { label:'删除文件夹' });
    enqueuePathRefreshForChats(containedChats, previous, '删除文件夹后的路径');
  }

  async function addCurrentChat() {
    if (!state.selectedProjectId) return alert('请先选择目标位置。');
    const current = currentConversation();
    if (!current) return alert('当前页面不是具体聊天。');
    await dropChatIntoLocation({ id:current.id, title:current.title, projectId:current.projectId, url:current.url, source:'current-chat' }, state.selectedProjectId, isUnassignedProject(state.selectedProjectId) ? null : (state.selectedFolderId || null));
  }

  function navigateInPlacePath(path) {
    const anchor = [...document.querySelectorAll('a[href]')].find(a => !host?.contains(a) && (a.getAttribute('href') || '') === path);
    if (anchor) { anchor.click(); return; }
    if (`${location.pathname}${location.search}${location.hash}` === path) return;
    history.pushState(history.state, '', path);
    window.dispatchEvent(new PopStateEvent('popstate', { state:history.state }));
  }

  function startNewChatAtCurrentLocation() {
    const projectId = state.selectedProjectId || UNASSIGNED_PROJECT_ID;
    const folderId = isUnassignedProject(projectId) ? null : (state.selectedFolderId || null);
    startNewChat(projectId, folderId);
  }

  function startNewChat(projectId, folderId = null) {
    if (!projectId) return;
    const targetIsUnassigned = isUnassignedProject(projectId);
    const project = getProject(projectId);
    if (!project) return;
    const before = currentConversation()?.id || null;
    state.pendingNewChatTarget = {
      projectId, folderId: targetIsUnassigned ? null : (folderId || null),
      sourceConversationId:before, startedAt:new Date().toISOString()
    };
    recordLocalMutation('new-chat-target', { projectId, folderId:targetIsUnassigned ? null : (folderId || null) }, { label:'新建聊天目标', undoable:false });
    if (targetIsUnassigned) navigateInPlacePath('/');
    else {
      const projectPath = new URL(project.url || `https://chatgpt.com/g/${projectId}/project`, location.origin).pathname;
      navigateInPlacePath(projectPath);
    }
    const where = targetIsUnassigned ? '未归项目' : `${project.name}${folderId ? ' / ' + folderPath(folderId).join(' / ') : ''}`;
    if (statusEl) statusEl.textContent = `已打开新聊天输入区；发送第一条消息后，会自动归入「${where}」并同步路径标识`;
  }

  async function capturePendingNewChat() {
    const pending = state.pendingNewChatTarget;
    if (!pending) return false;
    const current = currentConversation();
    if (!current?.id || current.id === pending.sourceConversationId) return false;
    const known = getChat(current.id);
    if (known && toEpoch(known.createdAt || known.createTime) < toEpoch(pending.startedAt) - 2000) return false;
    state.pendingNewChatTarget = null;
    persistStateSoon({ snapshot:true });
    try {
      await dropChatIntoLocation({ id:current.id, title:current.title, projectId:current.projectId, url:current.url, source:'new-chat' }, pending.projectId, pending.folderId || null);
      return true;
    } catch (err) {
      if (statusEl) statusEl.textContent = `新聊天已创建，但归档到目标位置失败：${err?.message || err}`;
      return false;
    }
  }

  async function refreshWorkspacePermission() {
    const handle = await globalThis.ChatGPTExplorerIDB.getHandle(accountHandleKey());
    if (!handle) return alert('没有保存的工作区句柄，请重新初始化。');
    const ok = await ensureWorkspacePermission(handle);
    alert(ok ? '工作区访问权限正常。' : '未获得工作区访问权限。');
    if (ok) await writeWorkspaceSnapshot();
  }

  function hideContextMenu() {
    if (contextMenuEl) contextMenuEl.hidden = true;
  }

  function showContextMenu(x, y, items) {
    contextMenuEl.innerHTML = items.map((item, i) => item.separator
      ? '<div class="ctx-sep"></div>'
      : `<button class="ctx-item ${item.danger ? 'danger' : ''}" data-ctx-index="${i}">${escapeHtml(item.label)}</button>`
    ).join('');
    contextMenuEl._items = items;
    contextMenuEl.hidden = false;
    const rect = panel.getBoundingClientRect();
    const menuWidth = 235;
    const menuHeight = Math.min(360, items.length * 34 + 12);
    contextMenuEl.style.left = `${Math.max(8, Math.min(x - rect.left, rect.width - menuWidth - 8))}px`;
    contextMenuEl.style.top = `${Math.max(8, Math.min(y - rect.top, rect.height - menuHeight - 8))}px`;
  }

  function folderContextItems(folder) {
    return [
      { label:'打开', action:()=>navigateTo(folder.projectId,folder.id) },
      { label:isQuick('folder',folder.id)?'从快速访问取消固定':'固定到快速访问', action:()=>toggleQuick('folder',folder.id) },
      { separator:true },
      { label:'剪切（Ctrl+X）', action:()=>setClipboard('cut',[{kind:'folder',id:folder.id}]) },
      { label:'粘贴到此文件夹', action:()=>pasteClipboard(folder.projectId,folder.id) },
      { separator:true },
      { label:'新建聊天', action:()=>startNewChat(folder.projectId,folder.id) },
      { label:'新建子文件夹', action:()=>addFolder(folder.id,folder.projectId) },
      { label:'重命名', action:()=>renameFolder(folder.id) },
      { separator:true },
      { label:'删除本地文件夹', danger:true, action:()=>deleteFolder(folder.id) }
    ];
  }

  function projectContextItems(project) {
    return [
      { label:'打开', action:()=>navigateTo(project.id,null) },
      { label:'新建 Project', action:createOfficialProject },
      { label:isQuick('project',project.id)?'从快速访问取消固定':'固定到快速访问', action:()=>toggleQuick('project',project.id) },
      { separator:true },
      { label:'粘贴到项目根目录', action:()=>pasteClipboard(project.id,null) },
      { label:'新建聊天', action:()=>startNewChat(project.id,null) },
      { label:'新建文件夹', action:()=>addFolder(null,project.id) },
      { label:'同步此项目聊天', action:()=>syncProjectChats(project.id,{silent:false}) },
      { separator:true },
      { label:'在 ChatGPT 官方项目页打开', action:()=>{ if(project.url) history.pushState(history.state,'',new URL(project.url).pathname); window.dispatchEvent(new PopStateEvent('popstate',{state:history.state})); } }
    ];
  }

  function autoLocateCurrentChat() {
    const current = currentConversation();
    if (!current?.id) return false;
    const chat = getChat(current.id);
    if (!chat) return false;
    const changed = state.selectedProjectId !== chat.projectId || (state.selectedFolderId || null) !== (chat.folderId || null);
    state.selectedProjectId = chat.projectId;
    state.selectedFolderId = chat.folderId || null;
    selectedChatIds = new Set([chat.id]); selectionAnchorChatId = chat.id;
    if (changed) render(); else updateSelectionClasses();
    requestAnimationFrame(() => {
      const row = contentEl?.querySelector(`.file-row[data-kind="chat"][data-id="${CSS.escape(chat.id)}"]`);
      row?.scrollIntoView({ block:'nearest' });
      row?.classList.add('current-chat-flash'); setTimeout(()=>row?.classList.remove('current-chat-flash'),900);
    });
    return true;
  }

  function elementIsActuallyVisible(el) {
    if (!(el instanceof Element)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 2 && rect.height > 2;
  }

  function hasVisibleOfficialModal() {
    // ChatGPT 的 Settings / Share / account / confirmation 等官方弹窗通常使用
    // role=dialog / aria-modal=true / <dialog open>。这里只识别真正的 modal，
    // 不把普通下拉菜单、tooltip 或 Explorer 自己的 Shadow DOM 算进去。
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      'dialog[open]'
    ];
    for (const selector of selectors) {
      for (const el of document.querySelectorAll(selector)) {
        if (el === host || host?.contains?.(el)) continue;
        if (elementIsActuallyVisible(el)) return true;
      }
    }
    return false;
  }

  function syncOfficialModalSuspension() {
    const active = hasVisibleOfficialModal();
    if (active === officialModalSuspended) return false;
    officialModalSuspended = active;
    if (host) {
      if (active) host.setAttribute('data-official-modal', 'true');
      else host.removeAttribute('data-official-modal');
    }
    // 官方 modal 打开时 Explorer 不再隐藏/收起，也不释放页面 inset。
    // 这里只切换 host 标记，让 CSS 暂时降低 Explorer 的层级，官方弹窗自然覆盖在其上。
    panel?.classList.toggle('open', !!state.panelOpen);
    applyPageInset();
    return true;
  }

  function setupAutoSync() {
    lastDomProjectSignature = scanProjectsFromDom().map(p => p.id).sort().join('|');
    lastDomPinSignature = '';
    mirrorOfficialPinsFromDom();

    const observer = new MutationObserver(mutations => {
      // 官方弹窗可能在 Explorer 尚未初始化完成时出现，所以 modal 层级检查独立于同步逻辑。
      syncOfficialModalSuspension();
      if (!state.initialized) return;
      const sidebarTouched = mutations.some(m => {
        const target = m.target instanceof Element ? m.target : m.target?.parentElement;
        if (target?.closest?.('nav, aside')) return true;
        return [...(m.addedNodes || [])].some(node => node instanceof Element && (node.matches?.('nav, aside') || node.querySelector?.('nav, aside, a[href*="/c/"], a[href*="/g/g-p-"]')));
      });
      if (!sidebarTouched) return;

      const conversationLinksChanged = mutations.some(m => {
        const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
        return nodes.some(node => {
          if (!(node instanceof Element)) return false;
          return node.matches?.('a[href*="/c/"]') || !!node.querySelector?.('a[href*="/c/"]');
        });
      });
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        const pinSignalChanged = mirrorOfficialPinsFromDom();
        // DOM 只负责告诉我们“侧栏聊天结构/置顶区域变了”。真正的置顶 ID 始终重新从 API 校准。
        // 即使某种 DOM 结构让置顶前后的扫描签名相同，聊天节点的移动也仍会触发这里。
        if (pinSignalChanged || conversationLinksChanged) syncOfficialPins({ silent:true }).catch(()=>{});
      }, DOM_PIN_SYNC_DEBOUNCE_MS);

      const projectSignature = scanProjectsFromDom().map(p => p.id).sort().join('|');
      if (projectSignature !== lastDomProjectSignature) {
        lastDomProjectSignature = projectSignature;
        clearTimeout(projectMutationTimer);
        projectMutationTimer = setTimeout(() => syncOfficialProjects({ silent:true }).catch(()=>{}), DOM_PROJECT_SYNC_DEBOUNCE_MS);
      }
    });
    observer.observe(document.documentElement, { childList:true, subtree:true });

    // 某些 ChatGPT modal 会保留在 DOM 中，只通过 aria/data-state/open 属性切换。
    // 单独监听这些属性，避免把全站 class/style 动画都纳入 observer 造成额外同步开销。
    const modalAttributeObserver = new MutationObserver(() => {
      clearTimeout(modalMutationTimer);
      modalMutationTimer = setTimeout(() => syncOfficialModalSuspension(), 20);
    });
    modalAttributeObserver.observe(document.documentElement, {
      attributes:true, subtree:true, attributeFilter:['open','aria-hidden','aria-modal','data-state']
    });

    // “跟随 ChatGPT”模式只观察页面根节点/Body 的语言和主题信号，不监听整站 class 动画。
    const hostPreferenceObserver = new MutationObserver(() => refreshHostPreferences());
    hostPreferenceObserver.observe(document.documentElement, { attributes:true, attributeFilter:['class','data-theme','lang'] });
    if (document.body) hostPreferenceObserver.observe(document.body, { attributes:true, attributeFilter:['class','data-theme','lang'] });

    setInterval(() => {
      if (location.href === lastObservedUrl) return;
      lastObservedUrl = location.href;
      if (state.initialized) setTimeout(() => capturePendingNewChat().catch(()=>{}), 80);
      if (state.initialized && state.panelOpen) setTimeout(() => autoLocateCurrentChat(), 110);
    }, 350);

    accountCheckTimer = setInterval(() => { if (state.initialized) verifyAccountBoundary(true).catch(()=>{}); }, 8000);

    autoTimer = setInterval(() => {
      if (location.href !== lastObservedUrl) {
        lastObservedUrl = location.href;
        if (state.initialized && state.panelOpen) setTimeout(() => autoLocateCurrentChat(), 120);
      }
      if (!state.initialized || syncing) return;
      // Project 列表轻量刷新可在后台进行；完整分页同步只在 Explorer 打开时定时执行，
      // 避免用户根本没使用面板时每 3 分钟仍大量访问 Project/conversation 接口。
      syncOfficialProjects({ silent:true }).catch(()=>{});
      if (!state.panelOpen) return;
      const age = Date.now() - toEpoch(state.lastFullSyncAt);
      if (!state.lastFullSyncAt || age > AUTO_FULL_SYNC_MS) syncAllData({ silent:true }).catch(()=>{});
    }, AUTO_PROJECT_SYNC_MS);
  }

  function inject() {
    host = document.createElement('div');
    host.id = 'cgpt-explorer-host';
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        /* 官方 modal 打开时不隐藏 Explorer，只把它压到官方弹窗之后。
           页面 inset 继续保留，因此 Explorer 仍可见且不会被 ChatGPT 主内容重新占位覆盖。 */
        :host([data-official-modal="true"]) #toggle {
          z-index: 2 !important;
        }
        :host([data-official-modal="true"]) #panel {
          z-index: 1 !important;
        }
        * { box-sizing: border-box; }
        button, input { font: inherit; }
        #toggle {
          position: fixed; right: 10px; top: 46%; z-index: 2147483646;
          width: 42px; height: 42px; border: 1px solid rgba(127,127,127,.35);
          border-radius: 12px; background: rgba(35,35,35,.96); color: white;
          cursor: pointer; font-size: 20px; box-shadow: 0 8px 30px rgba(0,0,0,.22);
        }
        #panel {
          position: fixed; top: 0; right: 0; bottom: 0; z-index: 2147483645;
          transform: translateX(calc(100% + 30px)); opacity: 0; pointer-events: none;
          border: 0; border-left: 2px solid #555; border-radius: 0;
          background: #181818; color: #f2f2f2; box-shadow: -3px 0 10px rgba(0,0,0,.28);
          overflow: hidden; display: flex; flex-direction: column;
          transition: transform .16s ease, opacity .16s ease;
          font: 13px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
        }
        #panel.open { transform: translateX(0); opacity: 1; pointer-events: auto; }
        #resizer { position:absolute; left:-5px; top:0; bottom:0; width:10px; cursor:ew-resize; z-index:30; background:linear-gradient(to right, transparent 0 4px, #6f6f6f 4px 6px, transparent 6px); }
        .head { height: 48px; padding: 8px 10px 8px 14px; border-bottom: 1px solid #343434; display: flex; align-items: center; gap: 7px; }
        .head strong { font-size: 14px; flex: 1; }
        .action { border: 1px solid #444; color: #eee; background: #2b2b2b; border-radius: 7px; padding: 6px 8px; cursor: pointer; }
        .action:hover { background: #393939; }
        .navbar { padding: 7px 10px; border-bottom: 1px solid #343434; display: flex; align-items: center; gap: 6px; min-height: 44px; }
        .navbtn { width: 32px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
        #crumb { flex: 1; display: flex; min-width: 0; align-items: center; height: 30px; border: 1px solid #414141; border-radius: 6px; padding: 0 4px; overflow-x: auto; overflow-y: hidden; white-space: nowrap; background:#202020; }
        .crumb-part { border:0; color:#ddd; background:transparent; padding:4px 6px; border-radius:4px; cursor:pointer; white-space:nowrap; }
        .crumb-part:hover { background:#363636; }
        .crumb-sep { color:#777; }
        .crumb-placeholder { color:#888; padding:0 6px; }
        #workspaceBody { flex: 1; min-height: 0; display:flex; }
        #navPane { width:230px; flex:0 0 230px; min-width:0; border-right:0; overflow:hidden; padding:0; background:#1c1c1c; }
        #workspaceSplitter { flex:0 0 7px; width:7px; cursor:ew-resize; touch-action:none; background:linear-gradient(to right,transparent 0 2px,#454545 2px 4px,transparent 4px); }
        #workspaceSplitter:hover, #workspaceSplitter.dragging { background:linear-gradient(to right,transparent 0 2px,#777 2px 5px,transparent 5px); }
        #tree { height:100%; min-height:0; display:flex; flex-direction:column; overflow:hidden; }
        .nav-block { min-height:56px; display:flex; flex-direction:column; overflow:hidden; }
        .nav-section-scroll { flex:1; min-height:0; overflow:auto; padding:0 5px 6px; scrollbar-gutter:stable; }
        .nav-splitter { flex:0 0 7px; cursor:ns-resize; background:linear-gradient(to bottom,transparent 0 2px,#4a4a4a 2px 4px,transparent 4px); }
        .nav-splitter:hover { background:linear-gradient(to bottom,transparent 0 2px,#7b7b7b 2px 5px,transparent 5px); }
        #contentPane { flex:1; min-width:0; overflow:auto; background:#181818; position:relative; }
        .nav-section-title { flex:0 0 auto; padding: 8px 9px 4px; color:#aaa; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
        .project-title { margin-top:0; border-top:0; padding-top:8px; }
        .nav-row { min-height:30px; display:flex; align-items:center; gap:5px; border-radius:6px; padding:3px 6px 3px calc(5px + var(--depth, 0) * 14px); cursor:pointer; user-select:none; }
        .nav-row:hover { background:#303030; }
        .nav-row[draggable="true"] { cursor:grab; }
        .nav-row[draggable="true"]:active { cursor:grabbing; }
        .nav-row.active { background:#3a3a3a; outline:1px solid #505050; }
        .twisty { width:14px; min-width:14px; text-align:center; line-height:18px; }
        .twisty-toggle { cursor:pointer; border-radius:4px; }
        .twisty-toggle:hover { background:#4a4a4a; }
        .twisty { width:14px; flex:0 0 14px; text-align:center; color:#888; font-size:11px; }
        .quick-row .twisty { color:#e6bd5a; }
        .pinned-row .twisty { color:#ffbf63; }
        .pinned-row { background:rgba(160,105,20,.08); }
        .nav-icon { width:20px; flex:0 0 20px; }
        .nav-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .nav-empty { color:#777; padding:7px 10px; font-size:12px; line-height:1.45; }
        .details-head, .file-row { display:grid; grid-template-columns:minmax(230px, 1fr) 150px 150px; align-items:center; }
        .details-head { position:sticky; top:0; z-index:2; min-height:32px; color:#aaa; background:#202020; border-bottom:1px solid #363636; font-size:12px; }
        .details-head > div, .file-row > div { padding:6px 10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .file-row { min-height:38px; border-bottom:1px solid #242424; cursor:default; user-select:none; }
        .file-row:hover { background:#292929; }
        .file-row.selected { background:#354151; outline:1px solid #4c6079; outline-offset:-1px; }
        .file-row.current-chat-flash { animation:ceFlash .9s ease; }
        @keyframes ceFlash { 0%,100%{box-shadow:none} 35%{box-shadow:inset 0 0 0 2px #79a8d8} }
        #selectionMarquee { position:absolute; z-index:8; border:1px solid #6fa8dc; background:rgba(80,140,200,.18); pointer-events:none; display:none; }
        .file-row[draggable="true"] { cursor:grab; }
        .file-row[draggable="true"]:active { cursor:grabbing; }
        .drop-target-active { background:#284766 !important; outline:2px solid #5b9bd5 !important; outline-offset:-2px; }
        .reorder-before { box-shadow:inset 0 2px 0 #7fb3e6; }
        .reorder-after { box-shadow:inset 0 -2px 0 #7fb3e6; }
        .file-name { display:flex; align-items:center; gap:8px; min-width:0; }
        .file-name span:last-child { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .file-icon { flex:0 0 20px; font-size:16px; }
        .file-type, .file-date { color:#aaa; font-size:12px; }
        #content:not([data-view-mode="details"]) { padding:10px; }
        .icon-grid { display:grid; gap:8px; align-content:start; }
        #content[data-view-mode="small"] .icon-grid { grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); }
        #content[data-view-mode="medium"] .icon-grid { grid-template-columns:repeat(auto-fill,minmax(125px,1fr)); }
        #content[data-view-mode="large"] .icon-grid { grid-template-columns:repeat(auto-fill,minmax(165px,1fr)); }
        #content[data-view-mode="xlarge"] .icon-grid { grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
        #content:not([data-view-mode="details"]) .file-row { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px; border:1px solid transparent; border-radius:8px; padding:10px 8px; text-align:center; }
        #content[data-view-mode="small"] .file-row { min-height:82px; }
        #content[data-view-mode="medium"] .file-row { min-height:112px; }
        #content[data-view-mode="large"] .file-row { min-height:150px; }
        #content[data-view-mode="xlarge"] .file-row { min-height:200px; }
        #content:not([data-view-mode="details"]) .file-row:hover { border-color:#353535; }
        #content:not([data-view-mode="details"]) .file-name { width:100%; flex-direction:column; gap:6px; justify-content:center; }
        #content[data-view-mode="small"] .file-icon { width:auto; font-size:26px; line-height:1; }
        #content[data-view-mode="medium"] .file-icon { width:auto; font-size:40px; line-height:1; }
        #content[data-view-mode="large"] .file-icon { width:auto; font-size:58px; line-height:1; }
        #content[data-view-mode="xlarge"] .file-icon { width:auto; font-size:82px; line-height:1; }
        #content:not([data-view-mode="details"]) .file-name span:last-child { width:100%; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
        #content:not([data-view-mode="details"]) .file-type, #content:not([data-view-mode="details"]) .file-date { display:none; }
        .view-select, .sort-select { height:30px; border:1px solid #444; border-radius:7px; background:#252525; color:#eee; padding:0 7px; }
        .search-box { height:30px; min-width:150px; flex:1; border:1px solid #444; border-radius:7px; background:#202020; color:#eee; padding:0 9px; }
        .commandbar { display:flex; gap:6px; align-items:center; padding:6px 10px; border-bottom:1px solid #343434; background:#1d1d1d; }
        .content-empty { color:#888; text-align:center; padding:70px 20px; line-height:1.7; }
        .content-empty span { color:#666; font-size:12px; }
        .toolbar { display:flex; gap:6px; padding:7px 10px; border-top:1px solid #343434; background:#1d1d1d; }
        .toolbar .spacer { flex:1; }
        #status { padding:6px 11px; border-top:1px solid #343434; color:#8f8f8f; font-size:11px; min-height:26px; background:#191919; }
        #wizard { padding:20px; flex:1; overflow:auto; }
        #wizard h2 { font-size:18px; margin:0 0 10px; }
        #wizard p { color:#bbb; line-height:1.6; }
        .primary { margin-top:8px; padding:10px 13px !important; background:#f4f4f4 !important; color:#171717 !important; font-weight:600; }
        .note { margin-top:14px; padding:10px; background:#202020; border-radius:9px; color:#aaa; font-size:12px; line-height:1.55; white-space:pre-line; }
        #contextMenu { position:absolute; z-index:20; width:235px; padding:5px; border:1px solid #494949; border-radius:8px; background:#252525; box-shadow:0 12px 30px rgba(0,0,0,.45); }
        #contextMenu[hidden] { display:none; }
        .ctx-item { display:block; width:100%; text-align:left; border:0; border-radius:5px; background:transparent; color:#eee; padding:7px 9px; cursor:pointer; }
        .ctx-item:hover { background:#3b3b3b; }
        .ctx-item.danger { color:#ff9b9b; }
        .ctx-sep { height:1px; background:#3b3b3b; margin:4px 3px; }

        #settingsOverlay[hidden] { display:none !important; }
        #settingsOverlay { position:absolute; inset:0; z-index:60; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(0,0,0,.45); backdrop-filter:blur(2px); }
        .settings-card { width:min(560px, calc(100% - 20px)); max-height:calc(100% - 24px); overflow:auto; border:1px solid #4a4a4a; border-radius:14px; background:#202020; color:#eee; box-shadow:0 22px 70px rgba(0,0,0,.5); }
        .settings-head { display:flex; align-items:flex-start; gap:12px; padding:18px 18px 14px; border-bottom:1px solid #373737; }
        .settings-head-copy { flex:1; min-width:0; }
        .settings-head h2 { margin:0 0 5px; font-size:18px; }
        .settings-subtitle { margin:0; color:#aaa; font-size:12px; line-height:1.5; }
        .settings-body { padding:4px 18px 14px; }
        .settings-section { padding:15px 0; border-bottom:1px solid #343434; }
        .settings-section:last-child { border-bottom:0; }
        .settings-section h3 { margin:0 0 7px; font-size:14px; }
        .settings-desc, .settings-note { margin:6px 0 0; color:#aaa; font-size:12px; line-height:1.55; }
        .settings-note { padding:9px 10px; border-radius:8px; background:#292929; }
        .settings-row { display:flex; align-items:center; justify-content:space-between; gap:18px; }
        .settings-toggle-label { display:flex; align-items:center; gap:9px; font-size:13px; font-weight:600; }
        .settings-toggle-label input { width:17px; height:17px; accent-color:#7aa7d8; }
        .settings-select { min-width:180px; height:34px; border:1px solid #4a4a4a; border-radius:8px; background:#292929; color:#eee; padding:0 9px; }
        .settings-footer { display:flex; justify-content:flex-end; padding:0 18px 18px; }
        .settings-gear { width:34px; height:30px; padding:0; font-size:16px; }
        .brand-block { display:flex; flex-direction:column; justify-content:center; min-width:0; margin-right:auto; line-height:1.15; }
        .brand-line { display:flex; align-items:center; gap:7px; min-width:0; }
        .brand-line strong { flex:0 1 auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .version-badge { flex:0 0 auto; padding:2px 6px; border:1px solid #4a4a4a; border-radius:999px; color:#b9c0c8; font-size:10px; font-weight:700; letter-spacing:.2px; }
        .brand-author { width:max-content; margin-top:3px; color:#8fb7e3; font-size:11px; text-decoration:none; }
        .brand-author:hover { text-decoration:underline; }
        .about-product { margin:0 0 10px; font-size:15px; font-weight:700; }
        .about-meta { display:grid; grid-template-columns:minmax(92px,auto) 1fr; gap:7px 12px; align-items:baseline; margin:8px 0 12px; font-size:12px; }
        .about-meta-label { color:#aaa; }
        .about-link { color:#8fb7e3; text-decoration:none; width:max-content; }
        .about-link:hover { text-decoration:underline; }
        .copyright-line { margin:8px 0 0; font-size:12px; font-weight:700; }
        .legal-copy { margin:7px 0 0; color:#aaa; font-size:11px; line-height:1.55; }
        .legal-card { margin-top:12px; padding:11px 12px; border:1px solid #3d3d3d; border-radius:10px; background:#292929; }
        .legal-card h4 { margin:0 0 5px; font-size:12px; }
        .legal-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:9px; }
        .legal-actions .action { font-size:11px; }

        :host([data-ce-theme="light"]) #toggle { background:#fff; color:#202124; border-color:#c9cdd2; box-shadow:0 5px 18px rgba(0,0,0,.18); }
        #panel[data-ce-theme="light"] { background:#f7f8fa; color:#202124; border-color:#cfd3d8; box-shadow:-10px 0 35px rgba(0,0,0,.16); }
        #panel[data-ce-theme="light"] .head,
        #panel[data-ce-theme="light"] .navbar,
        #panel[data-ce-theme="light"] .commandbar,
        #panel[data-ce-theme="light"] .toolbar { background:#f7f8fa; border-color:#d8dce1; }
        #panel[data-ce-theme="light"] #status { background:#f3f4f6; color:#656b73; border-color:#d8dce1; }
        #panel[data-ce-theme="light"] #navPane { background:#f4f5f7; }
        #panel[data-ce-theme="light"] #contentPane { background:#fff; }
        #panel[data-ce-theme="light"] .action { background:#fff; color:#24272b; border-color:#c9cdd2; }
        #panel[data-ce-theme="light"] .action:hover { background:#eceff3; }
        #panel[data-ce-theme="light"] .action:disabled { color:#9aa0a6; background:#f4f5f6; }
        #panel[data-ce-theme="light"] #crumb,
        #panel[data-ce-theme="light"] .search-box,
        #panel[data-ce-theme="light"] .view-select,
        #panel[data-ce-theme="light"] .sort-select { background:#fff; color:#202124; border-color:#c9cdd2; }
        #panel[data-ce-theme="light"] .crumb-part { color:#30343a; }
        #panel[data-ce-theme="light"] .crumb-part:hover,
        #panel[data-ce-theme="light"] .nav-row:hover { background:#e8ebef; }
        #panel[data-ce-theme="light"] .nav-row.active { background:#dfe7f1; outline-color:#b9c9dc; }
        #panel[data-ce-theme="light"] .pinned-row { background:rgba(214,145,32,.08); }
        #panel[data-ce-theme="light"] .nav-section-title,
        #panel[data-ce-theme="light"] .file-type,
        #panel[data-ce-theme="light"] .file-date,
        #panel[data-ce-theme="light"] .details-head { color:#62676e; }
        #panel[data-ce-theme="light"] .details-head { background:#f2f4f6; border-color:#d8dce1; }
        #panel[data-ce-theme="light"] .file-row { border-color:#eceef1; }
        #panel[data-ce-theme="light"] .file-row:hover { background:#f2f4f7; }
        #panel[data-ce-theme="light"] .file-row.selected { background:#dce8f5; outline-color:#a9bfd7; }
        #panel[data-ce-theme="light"] #workspaceSplitter { background:linear-gradient(to right,transparent 0 2px,#c6cbd1 2px 4px,transparent 4px); }
        #panel[data-ce-theme="light"] .nav-splitter { background:linear-gradient(to bottom,transparent 0 2px,#c6cbd1 2px 4px,transparent 4px); }
        #panel[data-ce-theme="light"] #contextMenu { background:#fff; color:#202124; border-color:#c9cdd2; box-shadow:0 12px 30px rgba(0,0,0,.18); }
        #panel[data-ce-theme="light"] .ctx-item { color:#202124; }
        #panel[data-ce-theme="light"] .ctx-item:hover { background:#eceff3; }
        #panel[data-ce-theme="light"] .ctx-sep { background:#e0e3e7; }
        #panel[data-ce-theme="light"] .settings-card { background:#fff; color:#202124; border-color:#c9cdd2; box-shadow:0 22px 70px rgba(0,0,0,.25); }
        #panel[data-ce-theme="light"] .settings-head,
        #panel[data-ce-theme="light"] .settings-section { border-color:#e0e3e7; }
        #panel[data-ce-theme="light"] .settings-subtitle,
        #panel[data-ce-theme="light"] .settings-desc,
        #panel[data-ce-theme="light"] .settings-note { color:#656b73; }
        #panel[data-ce-theme="light"] .settings-note { background:#f3f5f7; }
        #panel[data-ce-theme="light"] .note { background:#f3f5f7; color:#656b73; }
        #panel[data-ce-theme="light"] .content-empty, #panel[data-ce-theme="light"] .nav-empty { color:#70757a; }
        #panel[data-ce-theme="light"] .content-empty span { color:#858b92; }
        #panel[data-ce-theme="light"] .settings-select { background:#fff; color:#202124; border-color:#c9cdd2; }
        #panel[data-ce-theme="light"] .version-badge { border-color:#c9cdd2; color:#656b73; }
        #panel[data-ce-theme="light"] .brand-author,
        #panel[data-ce-theme="light"] .about-link { color:#315f91; }
        #panel[data-ce-theme="light"] .about-meta-label,
        #panel[data-ce-theme="light"] .legal-copy { color:#656b73; }
        #panel[data-ce-theme="light"] .legal-card { background:#f7f8fa; border-color:#d8dce1; }
      </style>
      <button id="toggle" title="Ai Chat Explorer">📁</button>
      <section id="panel">
        <div id="resizer"></div>
        <div class="head">
          <div class="brand-block">
            <div class="brand-line"><strong>${APP_NAME}</strong><span class="version-badge">v${APP_VERSION}</span></div>
            <a class="brand-author" href="${AUTHOR_URL}" target="_blank" rel="noopener noreferrer" title="GitHub · ${AUTHOR_HANDLE}">${AUTHOR_HANDLE}</a>
          </div>
          <button class="action settings-gear" id="settingsBtn" title="设置">⚙</button>
          <button class="action" id="syncAll" title="同步官方项目和项目聊天">↻ 同步</button>
          <button class="action" id="close">×</button>
        </div>
        <div id="wizard">
          <h2 id="wizardTitle">创建本地工作区</h2>
          <p id="wizardText">选择一个 Windows 文件夹保存该 ChatGPT 账号专属的 workspace.&lt;账号指纹&gt;.json。聊天正文和附件仍保存在 ChatGPT；本插件只保存目录、索引和快速访问。</p>
          <button class="action primary" id="chooseWorkspace">选择工作区文件夹</button>
          <div class="note" id="wizardNote">官方 Project = 根目录。<br>本地文件夹 = 无限层级目录。<br>初始化后会自动读取每个官方 Project 中的聊天标题与 ID；若标题末尾带有 ⟦CE:路径⟧，会自动重建对应的本地子文件夹。</div>
        </div>
        <div class="navbar">
          <button class="action navbtn" id="back" title="后退">←</button>
          <button class="action navbtn" id="forward" title="前进">→</button>
          <button class="action navbtn" id="up" title="上一级">↑</button>
          <div id="crumb"><span class="crumb-placeholder">尚未初始化</span></div>
        </div>
        <div class="commandbar">
          <input id="searchInput" class="search-box" placeholder="搜索当前文件夹" />
          <select id="sortBy" class="sort-select" title="排序依据"><option value="name">名称</option><option value="type">类型</option><option value="date">修改日期</option></select>
          <button class="action" id="sortDirection" title="切换升序/降序">↑</button>
          <select id="viewMode" class="view-select" title="查看方式">
            <option value="details">详细信息</option><option value="small">小图标</option><option value="medium">中图标</option><option value="large">大图标</option><option value="xlarge">超大图标</option>
          </select>
        </div>
        <div id="workspaceBody" hidden>
          <aside id="navPane"><div id="tree"></div></aside>
          <div id="workspaceSplitter" title="拖动调整左侧导航与右侧内容区域宽度"></div>
          <main id="contentPane" tabindex="0" data-drop-target="current"><div id="content"></div><div id="selectionMarquee"></div></main>
        </div>
        <div class="toolbar">
          <button class="action" id="newChatBtn" title="在当前所选位置新建聊天">＋ 新聊天</button>
          <button class="action" id="newProjectBtn" title="后台创建新的 ChatGPT 官方 Project">＋ 新建项目</button>
          <button class="action" id="undoBtn" title="撤销 Ctrl+Z">↶ 撤销</button>
          <button class="action" id="redoBtn" title="重做 Ctrl+Y">↷ 重做</button>
          <button class="action" id="cutBtn" title="剪切选中聊天 Ctrl+X">剪切</button>
          <button class="action" id="pasteBtn" title="粘贴 Ctrl+V">粘贴</button>
          <button class="action" id="newFolder">＋ 新建文件夹</button>
          <button class="action" id="addChat">＋ 当前聊天</button>
          <button class="action" id="writeMarkers" title="根据本地文件夹结构，将 ⟦CE:路径⟧ 写到官方聊天标题末尾">写入路径标识</button>
          <button class="action" id="removeMarkers" title="只移除官方聊天标题末尾的 ⟦CE:路径⟧，不删除聊天或本地目录">移除路径标识</button>
          <div class="spacer"></div>
          <button class="action" id="permission">工作区权限</button>
        </div>
        <div id="status"></div>
        <div id="contextMenu" hidden></div>

        <div id="settingsOverlay" hidden>
          <section class="settings-card" role="dialog" aria-modal="true" aria-labelledby="settingsTitle">
            <div class="settings-head">
              <div class="settings-head-copy">
                <h2 id="settingsTitle">Ai Chat Explorer 设置</h2>
                <p class="settings-subtitle" id="settingsSubtitle"></p>
              </div>
              <button class="action" id="settingsCloseTop" title="关闭">×</button>
            </div>
            <div class="settings-body">
              <section class="settings-section">
                <div class="settings-row">
                  <div><h3 id="settingsPathTitle">路径标识</h3></div>
                  <label class="settings-toggle-label"><input type="checkbox" id="settingsPathMarkers"><span id="settingsPathToggleLabel">开启路径标识</span></label>
                </div>
                <p class="settings-desc" id="settingsPathDesc"></p>
                <p class="settings-note" id="settingsPathOffNote"></p>
              </section>
              <section class="settings-section">
                <div class="settings-row">
                  <div><h3 id="settingsLanguageTitle">语言</h3></div>
                  <select class="settings-select" id="settingsLanguage">
                    <option value="auto">跟随 ChatGPT</option><option value="zh-CN">中文</option><option value="en">English</option>
                  </select>
                </div>
                <p class="settings-desc" id="settingsLanguageDesc"></p>
              </section>
              <section class="settings-section">
                <div class="settings-row">
                  <div><h3 id="settingsThemeTitle">画面</h3></div>
                  <select class="settings-select" id="settingsTheme">
                    <option value="auto">跟随 ChatGPT</option><option value="light">浅色</option><option value="dark">深色</option>
                  </select>
                </div>
                <p class="settings-desc" id="settingsThemeDesc"></p>
              </section>
              <section class="settings-section">
                <h3 id="settingsAboutTitle">关于</h3>
                <p class="about-product" id="settingsAboutProduct">Ai Chat Explorer 1.0</p>
                <div class="about-meta">
                  <span class="about-meta-label" id="settingsAuthorTitle">作者 / GitHub</span>
                  <a class="about-link" href="${AUTHOR_URL}" target="_blank" rel="noopener noreferrer">${AUTHOR_HANDLE}</a>
                </div>
                <h3 id="settingsCopyrightTitle">版权与使用声明</h3>
                <p class="copyright-line" id="settingsCopyrightLine">© 2026 Wzzz603. All rights reserved.</p>
                <p class="legal-copy" id="settingsRightsNotice"></p>
                <div class="legal-card">
                  <h4 id="settingsLicenseTitle">软件许可</h4>
                  <p class="legal-copy" id="settingsLicenseSummary"></p>
                  <div class="legal-actions"><button class="action" id="settingsViewLicense">查看 LICENSE</button></div>
                </div>
                <div class="legal-card">
                  <h4 id="settingsPrivacyTitle">隐私政策</h4>
                  <p class="legal-copy" id="settingsPrivacySummary"></p>
                  <div class="legal-actions"><button class="action" id="settingsViewPrivacy">查看隐私政策</button></div>
                </div>
                <p class="legal-copy" id="settingsThirdPartyNotice"></p>
              </section>
            </div>
            <div class="settings-footer"><button class="action primary" id="settingsDone">完成</button></div>
          </section>
        </div>
      </section>`;

    panel = shadow.getElementById('panel');
    treeEl = shadow.getElementById('tree');
    contentEl = shadow.getElementById('content');
    navPaneEl = shadow.getElementById('navPane');
    workspaceBodyEl = shadow.getElementById('workspaceBody');
    breadcrumbEl = shadow.getElementById('crumb');
    statusEl = shadow.getElementById('status');
    wizardEl = shadow.getElementById('wizard');
    contextMenuEl = shadow.getElementById('contextMenu');

    applyTheme();
    applyStaticUiLocalization();

    shadow.getElementById('toggle').addEventListener('click', async () => {
      state.panelOpen = !state.panelOpen;
      render();
      persistStateSoon({ snapshot: false });
      if (state.panelOpen && state.initialized) {
        setTimeout(() => autoLocateCurrentChat(), 40);
        const age = Date.now() - toEpoch(state.lastFullSyncAt);
        if (!state.lastFullSyncAt || age > AUTO_FULL_SYNC_MS) syncAllData({ silent: true }).catch(() => {});
      }
    });

    shadow.getElementById('close').addEventListener('click', async () => {
      state.panelOpen = false;
      hideContextMenu();
      render();
      persistStateSoon({ snapshot: false });
    });

    shadow.getElementById('settingsBtn').addEventListener('click', openSettings);
    shadow.getElementById('settingsCloseTop').addEventListener('click', closeSettings);
    shadow.getElementById('settingsDone').addEventListener('click', closeSettings);
    shadow.getElementById('settingsViewLicense').addEventListener('click', () => window.open(chrome.runtime.getURL('LICENSE'), '_blank', 'noopener,noreferrer'));
    shadow.getElementById('settingsViewPrivacy').addEventListener('click', () => window.open(chrome.runtime.getURL('PRIVACY.md'), '_blank', 'noopener,noreferrer'));
    shadow.getElementById('settingsOverlay').addEventListener('click', event => { if (event.target.id === 'settingsOverlay') closeSettings(); });
    shadow.getElementById('settingsPathMarkers').addEventListener('change', event => {
      state.settings = normalizeSettings({ ...state.settings, pathMarkersEnabled: !!event.target.checked });
      applyStaticUiLocalization();
      persistStateSoon({ snapshot:true });
      if (statusEl) statusEl.textContent = state.settings.pathMarkersEnabled
        ? (effectiveLanguage()==='zh-CN' ? '路径标识已开启；后续目录移动/重命名会自动更新官方标题。' : 'Path markers enabled; future folder moves/renames will update official titles automatically.')
        : (effectiveLanguage()==='zh-CN' ? '路径标识已关闭；不会批量删除已有标识。' : 'Path markers disabled; existing markers were not bulk-deleted.');
    });
    shadow.getElementById('settingsLanguage').addEventListener('change', event => {
      state.settings = normalizeSettings({ ...state.settings, language:event.target.value });
      applyStaticUiLocalization();
      renderNavigationTree(); renderContentPane(); renderBreadcrumb();
      persistStateSoon({ snapshot:true });
    });
    shadow.getElementById('settingsTheme').addEventListener('change', event => {
      state.settings = normalizeSettings({ ...state.settings, theme:event.target.value });
      applyTheme(); renderSettingsControls(); persistStateSoon({ snapshot:true });
    });

    shadow.getElementById('chooseWorkspace').addEventListener('click', chooseWorkspace);
    shadow.getElementById('newChatBtn').addEventListener('click', startNewChatAtCurrentLocation);
    shadow.getElementById('newProjectBtn').addEventListener('click', createOfficialProject);
    shadow.getElementById('undoBtn').addEventListener('click', undoLocalMutation);
    shadow.getElementById('redoBtn').addEventListener('click', redoLocalMutation);
    shadow.getElementById('cutBtn').addEventListener('click',()=>{ if(selectedChatIds.size) setClipboard('cut',[...selectedChatIds].map(id=>({kind:'chat',id}))); else statusEl.textContent='请先选择聊天'; });
    shadow.getElementById('pasteBtn').addEventListener('click',()=>pasteClipboard().catch(err=>statusEl.textContent=`粘贴失败：${err.message||err}`));
    shadow.getElementById('syncAll').addEventListener('click', () => syncAllData({ silent: false }));
    shadow.getElementById('newFolder').addEventListener('click', () => addFolder());
    shadow.getElementById('addChat').addEventListener('click', addCurrentChat);
    shadow.getElementById('writeMarkers').addEventListener('click', writeAllPathMarkers);
    shadow.getElementById('removeMarkers').addEventListener('click', removeAllPathMarkers);
    shadow.getElementById('permission').addEventListener('click', refreshWorkspacePermission);
    shadow.getElementById('back').addEventListener('click', goBack);
    shadow.getElementById('forward').addEventListener('click', goForward);
    shadow.getElementById('up').addEventListener('click', goUp);
    const viewModeSelect = shadow.getElementById('viewMode');
    viewModeSelect.value = state.viewMode;
    viewModeSelect.addEventListener('change', event => {
      state.viewMode = ['details','small','medium','large','xlarge'].includes(event.target.value) ? event.target.value : 'details';
      renderContentPane(); recordLocalMutation('view-mode',{viewMode:state.viewMode},{snapshot:false});
    });
    const searchInput=shadow.getElementById('searchInput'); searchInput.value=state.searchQuery || '';
    searchInput.addEventListener('input', event=>{ state.searchQuery=event.target.value; renderContentPane(); persistStateSoon({snapshot:false}); });
    const sortBy=shadow.getElementById('sortBy'); sortBy.value=state.sortBy;
    sortBy.addEventListener('change',event=>{state.sortBy=event.target.value; renderContentPane(); recordLocalMutation('sort',{sortBy:state.sortBy},{snapshot:false});});
    const sortDir=shadow.getElementById('sortDirection');
    sortDir.addEventListener('click',()=>{state.sortDirection=state.sortDirection==='asc'?'desc':'asc'; sortDir.textContent=state.sortDirection==='asc'?'↑':'↓'; renderContentPane(); recordLocalMutation('sort-direction',{sortDirection:state.sortDirection},{snapshot:false});});

    breadcrumbEl.addEventListener('click', event => {
      const btn = event.target.closest?.('.crumb-part');
      if (!btn) return;
      navigateTo(btn.dataset.projectId, btn.dataset.folderId || null);
    });

    treeEl.addEventListener('click', event => {
      const twisty = event.target.closest?.('.twisty-toggle');
      if (twisty) {
        event.preventDefault();
        event.stopPropagation();
        toggleNavCollapsed(twisty.dataset.twistyKind, twisty.dataset.twistyId);
        return;
      }
      const row = event.target.closest?.('.nav-row');
      if (!row) return;
      const kind = row.dataset.kind;
      const id = row.dataset.id;
      if (kind === 'project' || kind === 'unassigned') navigateTo(id, null);
      else if (kind === 'folder') navigateTo(row.dataset.projectId || getFolder(id)?.projectId, id);
      else if (kind === 'pinned-chat') { const chat=getChat(id); if(chat) navigateTo(chat.projectId, chat.folderId || null); }
    });

    treeEl.addEventListener('dblclick', event => {
      const row = event.target.closest?.('.nav-row');
      if (!row) return;
      const kind = row.dataset.kind;
      const id = row.dataset.id;
      if (kind === 'project' || kind === 'unassigned') navigateTo(id, null);
      else if (kind === 'folder') navigateTo(row.dataset.projectId || getFolder(id)?.projectId, id);
      else if (kind === 'pinned-chat') { const chat=getChat(id); if(chat) openChatInPlace(chat); }
    });

    treeEl.addEventListener('contextmenu', event => {
      const row = event.target.closest?.('.nav-row');
      if (!row) return;
      event.preventDefault();
      const kind = row.dataset.kind;
      if (kind === 'project') {
        const project = getProject(row.dataset.id);
        if (project) showContextMenu(event.clientX, event.clientY, projectContextItems(project));
      } else if (kind === 'unassigned') {
        showContextMenu(event.clientX, event.clientY, [
          {label:'打开',action:()=>navigateTo(UNASSIGNED_PROJECT_ID,null)},
          {label:'新建聊天',action:()=>startNewChat(UNASSIGNED_PROJECT_ID,null)},
          {separator:true},
          {label:'同步未归项目聊天',action:()=>syncUnassignedChats({silent:false})}
        ]);
      } else if (kind === 'folder') {
        const folder = getFolder(row.dataset.id);
        if (folder) showContextMenu(event.clientX, event.clientY, folderContextItems(folder));
      } else if (kind === 'pinned-chat') {
        const chat = getChat(row.dataset.id);
        if (chat) showContextMenu(event.clientX, event.clientY, [
          {label:'打开聊天',action:()=>openChatInPlace(chat)},
          {label:'定位到所在文件夹',action:()=>navigateTo(chat.projectId,chat.folderId||null)},
          {label:'取消官方置顶',action:()=>togglePinnedChat(chat.id)},
          {separator:true},
          {label:'归档',action:()=>archiveChat(chat.id)},
          {label:'删除',danger:true,action:()=>deleteChat(chat.id)}
        ]);
      }
    });

    contentEl.addEventListener('click', event => {
      shadow.getElementById('contentPane')?.focus({ preventScroll: true });
      const row = event.target.closest?.('.file-row');
      if (!row) {
        if (!event.ctrlKey && !event.metaKey && !event.shiftKey) clearChatSelection();
        selectedEntry = null;
        return;
      }
      if (row.dataset.kind === 'chat') {
        selectChatFromClick(row.dataset.id, event);
        return;
      }
      clearChatSelection();
      contentEl.querySelectorAll('.file-row.selected').forEach(el => el.classList.remove('selected'));
      row.classList.add('selected');
      selectedEntry = { kind: row.dataset.kind, id: row.dataset.id };
    });

    contentEl.addEventListener('dblclick', event => {
      const row = event.target.closest?.('.file-row');
      if (!row) return;
      if (row.dataset.kind === 'folder') navigateTo(row.dataset.projectId, row.dataset.id);
      if (row.dataset.kind === 'chat') { const chat=getChat(row.dataset.id); if(chat) openChatInPlace(chat); }
      if (row.dataset.kind === 'shortcut') { const sc=getShortcut(row.dataset.id); const chat=sc?getChat(sc.targetChatId):null; if(chat) openChatInPlace(chat); }
    });

    contentEl.addEventListener('dragstart', event => {
      const row = event.target.closest?.('.file-row[draggable="true"]');
      if (!row) return;
      if (row.dataset.kind === 'folder') {
        const folder = getFolder(row.dataset.id);
        if (folder) setFolderDragData(event, folder);
        return;
      }
      if (row.dataset.kind !== 'chat') return;
      const chat = getChat(row.dataset.id);
      if (!chat) return;

      // 若拖动的是一个已选聊天，则一起拖动当前多选集合；拖动未选聊天时只移动它自己。
      if (!selectedChatIds.has(chat.id)) {
        selectedChatIds.clear();
        selectedChatIds.add(chat.id);
        selectionAnchorChatId = chat.id;
        updateSelectionClasses();
      }
      const selected = [...selectedChatIds].map(getChat).filter(Boolean);
      if (selected.length > 1) {
        setChatDragData(event, {
          items: selected.map(dragPayloadForChat),
          title: `${selected.length} 个聊天`,
          count: selected.length,
          source: 'explorer-multi'
        });
      } else {
        setChatDragData(event, dragPayloadForChat(chat));
      }
    });

    treeEl.addEventListener('dragstart', event => {
      const row = event.target.closest?.('.nav-row[draggable="true"]');
      if (!row) return;
      if (row.dataset.kind === 'folder') {
        const folder = getFolder(row.dataset.id);
        if (folder) setFolderDragData(event, folder);
      } else if (row.dataset.kind === 'project') {
        const project = getProject(row.dataset.id);
        if (project) setProjectOrderDragData(event, project);
      }
    });

    shadow.addEventListener('dragend', () => {
      activeTreeDrag = null;
      clearDropHighlights();
    });

    shadow.addEventListener('dragover', event => {
      const target = event.target.closest?.('[data-drop-target]');
      if (!target || !event.dataTransfer) return;
      const types = [...event.dataTransfer.types];
      const hasChat = types.includes('application/x-chatgpt-explorer-chat');
      const hasFolder = types.includes('application/x-chatgpt-explorer-folder');
      const hasProjectOrder = types.includes('application/x-chatgpt-explorer-project-order');
      if (!hasChat && !hasFolder && !hasProjectOrder) return;

      clearDropHighlights();
      if (hasProjectOrder) {
        if (target.dataset.kind !== 'project') return;
        const position = treeReorderPosition(event, target, 'project');
        if (!position) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        target.classList.add(position === 'before' ? 'reorder-before' : 'reorder-after');
        return;
      }

      if (hasFolder && target.dataset.kind === 'folder') {
        const position = treeReorderPosition(event, target, 'folder');
        if (position) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          target.classList.add(position === 'before' ? 'reorder-before' : 'reorder-after');
          return;
        }
      }

      if (hasFolder && target.dataset.kind === 'unassigned') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      target.classList.add('drop-target-active');
    });

    shadow.addEventListener('dragleave', event => {
      const target = event.target.closest?.('[data-drop-target]');
      if (target && !target.contains(event.relatedTarget)) target.classList.remove('drop-target-active','reorder-before','reorder-after');
    });

    shadow.addEventListener('drop', event => {
      const target = event.target.closest?.('[data-drop-target]');
      clearDropHighlights();
      if (!target) return;
      event.preventDefault();
      const kind = target.dataset.kind;
      const projectOrderPayload = readProjectOrderDragData(event);
      if (projectOrderPayload && kind === 'project') {
        const position = target.classList.contains('reorder-before') ? 'before' : target.classList.contains('reorder-after') ? 'after' : treeReorderPosition(event, target, 'project');
        if (position) reorderProject(projectOrderPayload.id, target.dataset.id, position);
        activeTreeDrag = null;
        return;
      }

      const rawTargetProjectId = target.dataset.projectId || target.dataset.id || state.selectedProjectId;
      const projectId = rawTargetProjectId === UNASSIGNED_PROJECT_ID ? UNASSIGNED_PROJECT_ID : (canonicalProjectId(rawTargetProjectId) || rawTargetProjectId);
      const folderId = kind === 'folder' ? target.dataset.id : (kind === 'current' ? (target.dataset.folderId || null) : null);
      const folderPayload = readFolderDragData(event);
      if (folderPayload) {
        if (kind === 'folder') {
          const position = target.classList.contains('reorder-before') ? 'before' : target.classList.contains('reorder-after') ? 'after' : treeReorderPosition(event, target, 'folder');
          if (position && reorderFolder(folderPayload.id, folderId, position)) {
            activeTreeDrag = null;
            return;
          }
        }
        activeTreeDrag = null;
        Promise.resolve(moveFolderTree(folderPayload.id, projectId, folderId, { recordHistory:true, source:'drag' })).catch(err => {
          statusEl.textContent = `文件夹拖拽失败：${err.message || err}`;
        });
        return;
      }
      const payload = readChatDragData(event);
      if (!payload) return;
      Promise.resolve(dropChatsIntoLocation(payload, projectId, folderId)).catch(err => {
        statusEl.textContent = `拖拽失败：${err.message || err}`;
      });
    });

    treeEl.addEventListener('pointerdown', event => {
      const splitter = event.target.closest?.('.nav-splitter');
      if (!splitter) return;
      event.preventDefault();
      const above = splitter.dataset.above, below = splitter.dataset.below;
      const ratios = normalizeNavSectionRatios(state.navSectionRatios);
      const pairTotal = ratios[above] + ratios[below];
      const available = Math.max(100, treeEl.clientHeight - 21);
      const startY = event.clientY;
      const startAbove = ratios[above];
      const minRatio = 0.07;
      splitter.setPointerCapture?.(event.pointerId);
      const move = e => {
        const delta = (e.clientY - startY) / available;
        let nextAbove = Math.max(minRatio, Math.min(pairTotal - minRatio, startAbove + delta));
        let nextBelow = pairTotal - nextAbove;
        state.navSectionRatios = { ...ratios, [above]:nextAbove, [below]:nextBelow };
        const a = treeEl.querySelector(`[data-nav-section="${above}"]`);
        const b = treeEl.querySelector(`[data-nav-section="${below}"]`);
        if (a) a.style.flex = `${nextAbove} 1 0`;
        if (b) b.style.flex = `${nextBelow} 1 0`;
      };
      const up = e => {
        splitter.removeEventListener('pointermove', move);
        splitter.removeEventListener('pointerup', up);
        try { splitter.releasePointerCapture?.(e.pointerId); } catch (_) {}
        state.navSectionRatios = normalizeNavSectionRatios(state.navSectionRatios);
        persistStateSoon({ snapshot:true });
      };
      splitter.addEventListener('pointermove', move);
      splitter.addEventListener('pointerup', up);
    });

    shadow.getElementById('contentPane').addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === 'a') {
        event.preventDefault();
        selectedChatIds = new Set(visibleChatIds());
        selectionAnchorChatId = visibleChatIds()[0] || null;
        updateSelectionClasses();
        statusEl.textContent = selectedChatIds.size ? `已选择当前文件夹全部 ${selectedChatIds.size} 个聊天` : '当前文件夹没有聊天';
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'x' && selectedChatIds.size) {
        event.preventDefault(); setClipboard('cut',[...selectedChatIds].map(id=>({kind:'chat',id})));
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') {
        event.preventDefault(); pasteClipboard().catch(err=>statusEl.textContent=`粘贴失败：${err.message||err}`);
      } else if (event.key === 'Escape') {
        clearChatSelection(); statusEl.textContent='已取消选择';
      }
    });

    shadow.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !shadow.getElementById('settingsOverlay')?.hidden) {
        event.preventDefault(); closeSettings(); return;
      }
      const target = event.target;
      if (target?.matches?.('input,textarea,select') || target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key === 'z') { event.preventDefault(); undoLocalMutation(); }
      else if (((event.ctrlKey || event.metaKey) && key === 'y') || ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'z')) { event.preventDefault(); redoLocalMutation(); }
    });

    const contentPane = shadow.getElementById('contentPane');
    contentPane.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest?.('.file-row') || event.target.closest?.('.details-head')) return;
      contentPane.setPointerCapture?.(event.pointerId);
      const marquee = shadow.getElementById('selectionMarquee');
      const paneRect = contentPane.getBoundingClientRect();
      marqueeState = { startX:event.clientX, startY:event.clientY, base:new Set((event.ctrlKey||event.metaKey)?selectedChatIds:[]), pointerId:event.pointerId };
      marquee.style.left=`${event.clientX-paneRect.left+contentPane.scrollLeft}px`; marquee.style.top=`${event.clientY-paneRect.top+contentPane.scrollTop}px`;
      marquee.style.width='0px'; marquee.style.height='0px'; marquee.style.display='block';
      if (!(event.ctrlKey||event.metaKey)) selectedChatIds.clear();
    });
    contentPane.addEventListener('pointermove', event => {
      if (!marqueeState || event.pointerId !== marqueeState.pointerId) return;
      const paneRect=contentPane.getBoundingClientRect(); const x1=Math.min(marqueeState.startX,event.clientX), y1=Math.min(marqueeState.startY,event.clientY), x2=Math.max(marqueeState.startX,event.clientX), y2=Math.max(marqueeState.startY,event.clientY);
      const marquee=shadow.getElementById('selectionMarquee'); marquee.style.left=`${x1-paneRect.left+contentPane.scrollLeft}px`; marquee.style.top=`${y1-paneRect.top+contentPane.scrollTop}px`; marquee.style.width=`${x2-x1}px`; marquee.style.height=`${y2-y1}px`;
      selectedChatIds = new Set(marqueeState.base);
      contentEl.querySelectorAll('.file-row[data-kind="chat"]').forEach(row=>{const r=row.getBoundingClientRect(); if(!(r.right<x1||r.left>x2||r.bottom<y1||r.top>y2)) selectedChatIds.add(row.dataset.id);});
      updateSelectionClasses(); statusEl.textContent=`框选 ${selectedChatIds.size} 个聊天`;
    });
    const finishMarquee = event => { if(!marqueeState) return; shadow.getElementById('selectionMarquee').style.display='none'; marqueeState=null; try{contentPane.releasePointerCapture?.(event.pointerId);}catch(_){} };
    contentPane.addEventListener('pointerup', finishMarquee); contentPane.addEventListener('pointercancel', finishMarquee);

    contentEl.addEventListener('contextmenu', event => {
      event.preventDefault();
      const row = event.target.closest?.('.file-row');
      if (!row) {
        if (state.selectedProjectId) {
          const items = isUnassignedProject(state.selectedProjectId)
            ? [
                { label:'新建聊天', action:()=>startNewChat(UNASSIGNED_PROJECT_ID,null) },
                { separator:true },
                { label:'同步未归项目聊天', action:()=>syncUnassignedChats({silent:false}) }
              ]
            : [
                { label:'粘贴', action:()=>pasteClipboard() },
                { separator:true },
                { label:'新建聊天', action:()=>startNewChat(state.selectedProjectId,state.selectedFolderId||null) },
                { label:'新建文件夹', action:()=>addFolder() },
                { label:'同步当前项目聊天', action:()=>syncProjectChats(state.selectedProjectId,{silent:false}) }
              ];
          showContextMenu(event.clientX, event.clientY, items);
        }
        return;
      }
      if (row.dataset.kind === 'folder') {
        const folder = getFolder(row.dataset.id);
        if (folder) showContextMenu(event.clientX, event.clientY, folderContextItems(folder));
      } else if (row.dataset.kind === 'chat') {
        const chat=getChat(row.dataset.id);
        if(chat) showContextMenu(event.clientX,event.clientY,[
          {label:'打开聊天',action:()=>openChatInPlace(chat)},
          {label:'重命名标题',action:()=>renameChatTitle(chat.id)},
          {label:isPinnedChat(chat.id)?'取消官方置顶':'官方置顶',action:()=>togglePinnedChat(chat.id)},
          {separator:true},
          {label:'剪切（Ctrl+X）',action:()=>setClipboard('cut',clipboardItemsForRow('chat',chat.id))},
          {label:'归档',action:()=>archiveChat(chat.id)},
          {label:'删除',danger:true,action:()=>deleteChat(chat.id)},
          {separator:true},
          ...(!isUnassignedProject(chat.projectId) ? [
            {label:'从 Project 移到未归项目',action:()=>dropChatIntoLocation(dragPayloadForChat(chat),UNASSIGNED_PROJECT_ID,null)},
            {label:'从当前本地文件夹移到项目根目录',action:()=>dropChatIntoLocation(dragPayloadForChat(chat),chat.projectId,null)}
          ] : [])
        ]);
      } else if (row.dataset.kind === 'shortcut') {
        const sc=getShortcut(row.dataset.id);
        if(sc) showContextMenu(event.clientX,event.clientY,[
          {label:'打开目标聊天',action:()=>{const chat=getChat(sc.targetChatId);if(chat)openChatInPlace(chat);}},
          {label:'剪切快捷方式',action:()=>setClipboard('cut',[{kind:'shortcut',id:sc.id}])},
          {separator:true},
          {label:'删除快捷方式',danger:true,action:()=>{state.shortcuts=state.shortcuts.filter(x=>x.id!==sc.id);render();recordLocalMutation('shortcut-delete',{id:sc.id});}}
        ]);
      }
    });

    contextMenuEl.addEventListener('click', event => {
      const btn = event.target.closest?.('.ctx-item');
      if (!btn) return;
      const item = contextMenuEl._items?.[Number(btn.dataset.ctxIndex)];
      hideContextMenu();
      if (item?.action) Promise.resolve(item.action()).catch(err => { statusEl.textContent = `操作失败：${err.message || err}`; });
    });

    shadow.addEventListener('click', event => {
      if (!event.target.closest?.('#contextMenu')) hideContextMenu();
    });

    const workspaceSplitter = shadow.getElementById('workspaceSplitter');
    workspaceSplitter.addEventListener('pointerdown', event => {
      event.preventDefault();
      workspaceSplitter.setPointerCapture(event.pointerId);
      workspaceSplitter.classList.add('dragging');
      const startX = event.clientX;
      const startWidth = navPaneEl?.getBoundingClientRect().width || state.navPaneWidth || 230;
      const move = e => {
        state.navPaneWidth = clampedNavPaneWidth(startWidth + (e.clientX - startX));
        applyNavPaneWidth();
      };
      const up = e => {
        workspaceSplitter.removeEventListener('pointermove', move);
        workspaceSplitter.removeEventListener('pointerup', up);
        workspaceSplitter.removeEventListener('pointercancel', up);
        workspaceSplitter.classList.remove('dragging');
        try { workspaceSplitter.releasePointerCapture(e.pointerId); } catch (_) {}
        recordLocalMutation('nav-pane-resize', { navPaneWidth:state.navPaneWidth }, { snapshot:true, undoable:false, label:'调整导航区宽度' });
      };
      workspaceSplitter.addEventListener('pointermove', move);
      workspaceSplitter.addEventListener('pointerup', up);
      workspaceSplitter.addEventListener('pointercancel', up);
    });

    const resizer = shadow.getElementById('resizer');
    resizer.addEventListener('pointerdown', event => {
      event.preventDefault();
      resizer.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startWidth = panel.getBoundingClientRect().width;
      const move = e => {
        state.panelWidth = Math.min(1100, Math.max(560, startWidth + (startX - e.clientX)));
        panel.style.width = `${state.panelWidth}px`;
        applyNavPaneWidth();
        applyPageInset();
      };
      const up = async e => {
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', up);
        try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
        persistStateSoon({ snapshot: false });
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', up);
    });
  }

  window.addEventListener('pagehide', () => { try { persistStateSoon({ snapshot:true }); } catch (_) {} });

  window.addEventListener('resize', () => {
    if (state.panelOpen) {
      applyNavPaneWidth();
      applyPageInset();
    }
  }, { passive: true });

  (async () => {
    await loadState();
    inject();
    syncOfficialModalSuspension();
    render();
    setupAutoSync();
    setupOfficialSidebarDrag();
    if (state.initialized && state.pendingOperations.length) setTimeout(() => processOfficialQueue().catch(() => {}), 500);
    if (state.initialized && state.pendingNewChatTarget) setTimeout(() => capturePendingNewChat().catch(()=>{}), 700);
    if (state.initialized) {
      mirrorOfficialPinsFromDom();
      setTimeout(() => {
        syncOfficialProjects({ silent: true })
          .then(async () => {
            const age = Date.now() - toEpoch(state.lastFullSyncAt);
            // On a stale/new workspace, synchronize Project and unassigned membership first; syncAllData
            // imports pins only after those authoritative membership lists. This prevents a pinned Project chat
            // from being created as “未归项目” merely because its pinned href is /c/ID.
            if (!state.lastFullSyncAt || age > AUTO_FULL_SYNC_MS) return syncAllData({ silent: true });
            return syncOfficialPins({ silent:true });
          })
          .catch(() => {});
      }, 700);
    }
  })().catch(console.error);
})();
