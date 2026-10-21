export function getWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mugil IDE — Two-Paned Autonomous Terminal & IDE</title>
  <link rel="stylesheet" href="/vendor/xterm/xterm.css" />
  <script src="/vendor/xterm/xterm.js"></script>
  <script src="/vendor/xterm/addon-fit.js"></script>
  <script src="/vendor/xterm/addon-web-links.js"></script>
  <style>
    :root {
      --bg: #0d1117;
      --panel-bg: #161b22;
      --card-bg: #21262d;
      --border: #30363d;
      --text: #e6edf3;
      --text-dim: #8b949e;
      --accent: #58a6ff;
      --green: #3fb950;
      --magenta: #bc8cff;
      --yellow: #d29922;
      --red: #ff7b72;
      --diff-add: #1f6feb22;
      --diff-add-text: #56d364;
      --diff-del: #da363322;
      --diff-del-text: #ffa198;
      --font-scale: 1;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      scrollbar-width: thin;
      scrollbar-color: #30363d #0d1117;
    }
    ::-webkit-scrollbar {
      width: 8px;
      height: 8px;
    }
    ::-webkit-scrollbar-track {
      background: #0d1117;
    }
    ::-webkit-scrollbar-thumb {
      background: #30363d;
      border-radius: 4px;
      border: 1px solid #0d1117;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #484f58;
    }
    ::-webkit-scrollbar-corner {
      background: #0d1117;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: calc(13px * var(--font-scale));
      background: var(--bg);
      color: var(--text);
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: var(--panel-bg);
      border-bottom: 1px solid var(--border);
      padding: 6px 16px 5px 16px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 48px;
      height: auto;
      flex-shrink: 0;
      z-index: 10;
    }
    .logo-container {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: bold;
      font-size: calc(15px * var(--font-scale));
      color: var(--accent);
      user-select: none;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .shimmer-logo {
      background: linear-gradient(
        90deg,
        #ff3b30,
        #ff9500,
        #ffcc00,
        #34c759,
        #00c7be,
        #30b0c7,
        #32ade6,
        #007aff,
        #5856d6,
        #af52de,
        #ff2d55,
        #ff3b30
      );
      background-size: 300% 100%;
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      animation: rgbShimmer 5s linear infinite;
      font-weight: 800;
      letter-spacing: 0.5px;
      display: inline-block;
    }
    @keyframes rgbShimmer {
      0% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
      100% { background-position: 0% 50%; }
    }
    .logo-badge {
      background: #1f6feb33;
      color: var(--accent);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: calc(11px * var(--font-scale));
      font-weight: 700;
      border: 1px solid #1f6feb66;
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn {
      background: var(--card-bg);
      border: 1px solid var(--border);
      color: var(--text);
      padding: 5px 11px;
      border-radius: 4px;
      font-size: calc(12px * var(--font-scale));
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: background 0.2s;
    }
    .btn:hover { background: #30363d; }
    .btn-primary { background: #1f6feb; border-color: #388bfd; color: #fff; font-weight: 600; }
    .btn-primary:hover { background: #388bfd; }
    .btn-undo { color: var(--yellow); border-color: #d2992266; }
    .btn-undo:hover { background: #d2992222; }
    .metric-pill {
      background: #23863622;
      color: var(--green);
      border: 1px solid #23863666;
      padding: 3px 8px;
      border-radius: 12px;
      font-size: calc(11.5px * var(--font-scale));
      font-weight: 600;
      white-space: nowrap;
    }

    /* Header Collapsible Menu Dropdown */
    .menu-dropdown {
      position: relative;
      display: inline-block;
    }
    .menu-dropdown-content {
      display: none;
      position: absolute;
      right: 0;
      top: calc(100% + 4px);
      background: #161b22;
      border: 1px solid var(--border);
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
      min-width: 200px;
      z-index: 1000;
      padding: 6px;
      flex-direction: column;
      gap: 2px;
    }
    .menu-dropdown-content.show {
      display: flex;
    }
    .menu-item-btn {
      width: 100%;
      text-align: left;
      background: transparent;
      border: none;
      color: var(--text);
      padding: 8px 12px;
      border-radius: 6px;
      font-size: 12.5px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .menu-item-btn:hover {
      background: #21262d;
    }
    .menu-divider {
      height: 1px;
      background: var(--border);
      margin: 4px 0;
    }

    /* Split Two-Pane Layout */
    #workspace {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .pane {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      position: relative;
    }
    #left-pane {
      flex: 1.1;
      border-right: 1px solid var(--border);
      min-width: 380px;
    }
    #right-pane {
      flex: 0.9;
      min-width: 380px;
      background: var(--panel-bg);
    }
    .pane-header {
      background: var(--panel-bg);
      border-bottom: 1px solid var(--border);
      padding: 6px 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 40px;
    }
    .pane-tabs {
      display: flex;
      gap: 4px;
    }
    .tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-dim);
      padding: 5px 12px;
      font-size: calc(12.5px * var(--font-scale));
      font-weight: 500;
      cursor: pointer;
      border-radius: 4px;
      transition: all 0.2s;
    }
    .tab-btn.active {
      background: var(--card-bg);
      color: var(--text);
      border-color: var(--border);
      font-weight: 600;
    }
    .turn-chips {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding: 5px 10px;
      background: #11151c;
      border-bottom: 1px solid var(--border);
      font-size: calc(11.5px * var(--font-scale));
    }
    .turn-chip {
      background: #161b22;
      border: 1px solid var(--border);
      padding: 2px 9px;
      border-radius: 12px;
      white-space: nowrap;
      cursor: pointer;
      color: var(--text-dim);
    }
    .turn-chip:hover {
      border-color: var(--accent);
      color: var(--text);
    }

    /* Terminal Container */
    #terminal-container {
      flex: 1;
      position: relative;
      background: #000;
      overflow: hidden;
    }
    .terminal-view {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      padding: 4px 6px;
      display: none;
    }
    .terminal-view.active { display: block; }
    .xterm { height: 100%; }

    /* Quick Chat Input Bar */
    .quick-input-container {
      background: #161b22;
      border-top: 1px solid var(--border);
      padding: 8px 12px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .quick-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 7px 11px;
      border-radius: 6px;
      font-size: calc(13px * var(--font-scale));
      outline: none;
    }
    .quick-input:focus { border-color: var(--accent); }

    /* Right Pane Views */
    .right-view {
      flex: 1;
      display: none;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .right-view.active { display: flex; }

    /* Search Boxes */
    .search-box {
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      background: #11151c;
      flex-shrink: 0;
    }
    .search-input {
      width: 100%;
      background: #0d1117;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: calc(12.5px * var(--font-scale));
      outline: none;
    }
    .search-input:focus { border-color: var(--accent); }

    /* File Explorer */
    .file-explorer-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .file-tree {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      padding: 6px 12px;
      font-family: monospace;
      font-size: calc(12.5px * var(--font-scale));
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .tree-node {
      padding: 4px 6px;
      border-radius: 4px;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      user-select: none;
      flex-shrink: 0;
    }
    .tree-node:hover { background: #21262d; }
    .tree-node.selected { background: #1f6feb33; color: var(--accent); }

    /* Code & Diff Viewer */
    .code-viewer-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      height: 100%;
      min-height: 0;
      background: #0d1117;
    }
    .code-header {
      padding: 6px 12px;
      background: #161b22;
      border-bottom: 1px solid var(--border);
      font-size: calc(12.5px * var(--font-scale));
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    }
    .code-content {
      flex: 1;
      overflow: auto;
      min-height: 0;
      padding: 12px;
      font-family: "Consolas", "Fira Code", monospace;
      font-size: calc(13px * var(--font-scale));
      line-height: 1.55;
      white-space: pre;
      color: var(--text);
    }

    /* CodeGraph Tab */
    .graph-stats-bar {
      padding: 8px 12px;
      background: #11151c;
      border-bottom: 1px solid var(--border);
      display: flex;
      gap: 12px;
      font-size: calc(11.5px * var(--font-scale));
      color: var(--text-dim);
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .graph-stat-pill {
      background: #21262d;
      padding: 2px 6px;
      border-radius: 4px;
      border: 1px solid var(--border);
    }
    .graph-symbols-list {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      min-height: 0;
      padding: 8px 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .symbol-card {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: border-color 0.2s;
    }
    .symbol-card:hover { border-color: var(--accent); }
    .symbol-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .symbol-kind {
      font-size: calc(10.5px * var(--font-scale));
      font-weight: 700;
      text-transform: uppercase;
      padding: 1px 5px;
      border-radius: 3px;
      background: #1f6feb33;
      color: var(--accent);
    }
    .symbol-sig {
      font-family: monospace;
      font-size: calc(12.5px * var(--font-scale));
      color: var(--green);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .symbol-loc {
      font-size: calc(11.5px * var(--font-scale));
      color: var(--text-dim);
    }

    /* Modals (Model Picker & Account Login) */
    .modal-overlay {
      display: none;
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(2px);
      z-index: 1000;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.open { display: flex; }
    .modal-dialog {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      width: 680px;
      max-width: 92vw;
      max-height: 85vh;
      box-shadow: 0 12px 32px rgba(0,0,0,0.8);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .modal-title-bar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 14px;
      font-weight: 600;
    }
    .modal-tabs {
      display: flex;
      background: #11151c;
      border-bottom: 1px solid var(--border);
      padding: 6px 12px;
      gap: 6px;
    }
    .modal-tab-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-dim);
      padding: 4px 12px;
      font-size: 12px;
      border-radius: 4px;
      cursor: pointer;
    }
    .modal-tab-btn.active {
      background: var(--card-bg);
      color: var(--text);
      border-color: var(--border);
      font-weight: 600;
    }
    .modal-body {
      padding: 16px;
      overflow-y: auto;
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .modal-item-card {
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
      cursor: pointer;
      display: flex;
      justify-content: space-between;
      align-items: center;
      transition: all 0.2s;
    }
    .modal-item-card:hover {
      border-color: var(--accent);
      background: #161b22;
    }
    .modal-item-card.active {
      border-color: var(--green);
      background: #23863611;
    }
    .provider-row {
      display: flex;
      flex-direction: column;
      gap: 6px;
      background: #0d1117;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
    }
    .input-field {
      width: 100%;
      background: #161b22;
      border: 1px solid var(--border);
      color: var(--text);
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 12px;
      outline: none;
    }
    .input-field:focus { border-color: var(--accent); }

    /* Status Bar */
    .status-bar {
      background: var(--panel-bg);
      border-top: 1px solid var(--border);
      padding: 4px 16px;
      font-size: 11px;
      color: var(--text-dim);
      display: flex;
      justify-content: space-between;
      align-items: center;
      height: 26px;
    }
    .status-left {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    .dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      margin-right: 4px;
    }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:16px;">
      <div class="logo-container">
        <span>☁️ <span class="shimmer-logo">MUGIL IDE</span></span>
        <span class="logo-badge">TOKEN EFFICIENT</span>
        <span id="logo-model-sub" style="font-size:11px; color:var(--text-dim); font-weight:normal; margin-left:6px; white-space:nowrap;">Active: <b id="sub-active-model" style="color:var(--accent);">Detecting...</b></span>
      </div>

    <div class="controls">
      <!-- Direct ribbon metrics -->
      <span class="metric-pill" id="token-savings">Savings: 0%</span>
      <span class="metric-pill" id="session-spent" style="color:var(--green); border-color:#23863644;">Est. Spent: $0.0000</span>

      <!-- Zoom controls directly on ribbon -->
      <div class="zoom-controls" style="display:flex; align-items:center; background:var(--card-bg); border:1px solid var(--border); border-radius:4px; overflow:hidden;" title="Adjust text & terminal zoom size">
        <button class="btn" style="border:none; border-radius:0; padding:3px 7px; font-weight:bold; font-size:11px;" onclick="changeZoom(-0.1)" title="Zoom Out (Ctrl -)">A−</button>
        <span id="zoom-label" style="font-size:11px; color:var(--text-dim); padding:0 4px; min-width:36px; text-align:center; user-select:none;">100%</span>
        <button class="btn" style="border:none; border-radius:0; padding:3px 7px; font-weight:bold; font-size:11px;" onclick="changeZoom(0.1)" title="Zoom In (Ctrl +)">A+</button>
      </div>

      <!-- Main Action: Session Setup -->
      <button class="btn btn-primary" onclick="openSessionSetupModal()" title="Configure session budgets, limits & turbo mode">
        <span>🚀 Session Setup</span>
      </button>

      <!-- Collapsible Menu for remaining controls -->
      <div class="menu-dropdown">
        <button class="btn" onclick="toggleMenuDropdown(event)" id="header-menu-btn" title="Tools & Options Menu">
          <span>☰ Menu</span> ▾
        </button>
        <div class="menu-dropdown-content" id="header-menu-dropdown">
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openModelModal();">
            <span>🤖 Switch Model</span> (<span id="header-active-model" style="color:var(--accent);">Detecting...</span>)
          </button>
          <button class="menu-item-btn" id="turbo-toggle" onclick="closeMenuDropdown(); toggleTurboMode();">
            <span id="turbo-icon">⚡</span> <span id="turbo-label">Turbo Mode: Off</span>
          </button>
          <button class="menu-item-btn" id="mode-toggle" onclick="closeMenuDropdown(); toggleMode();">
            <span id="mode-icon">⚡</span> <span>Agent Mode: <b id="mode-label">Act</b></span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openAccountModal();">
            <span>🔑 Accounts & API Keys</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openWorkspaceModal();">
            <span>📂 Switch Project Folder</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openModulesModal();">
            <span>⚡ Token Modules & Rules</span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); triggerUndo();" style="color:var(--yellow);">
            <span>↩ Undo Last Edit</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); sendAgentCmd('/stats');">
            <span>📊 Session Stats</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); sendAgentCmd('/clear');">
            <span>🧹 Clear Screen</span>
          </button>
        </div>
      </div>
    </div>
    </div>

    <div class="header-credits-bar" style="font-size:10px; color:var(--text-dim); display:flex; gap:6px; align-items:center; white-space:nowrap; overflow-x:auto; padding-top:2px; border-top:1px solid #21262d44; width:100%;">
      <span style="font-weight:600; color:var(--text);">Credited:</span>
      <a href="https://github.com/JuliusBrussee/caveman" target="_blank" style="color:var(--accent); text-decoration:none;">Caveman</a> ·
      <a href="https://github.com/rtk-ai/rtk" target="_blank" style="color:var(--accent); text-decoration:none;">RTK</a> ·
      <a href="https://github.com/DietrichGebert/ponytail" target="_blank" style="color:var(--accent); text-decoration:none;">Ponytail</a> ·
      <a href="https://github.com/conorbronsdon/avoid-ai-writing" target="_blank" style="color:var(--accent); text-decoration:none;">De-AI</a> ·
      <a href="https://github.com/guillaumemeyer/watermarks-remover" target="_blank" style="color:var(--accent); text-decoration:none;">Watermarks</a> ·
      <a href="https://github.com/colbymchenry/codegraph" target="_blank" style="color:var(--accent); text-decoration:none;">CodeGraph</a> ·
      <a href="https://github.com/sst/opencode" target="_blank" style="color:var(--accent); text-decoration:none;">OpenCode</a>
    </div>
  </header>

  <div id="workspace">
    <!-- LEFT PANE: Chat, Conversations & Terminal -->
    <div id="left-pane" class="pane">
      <div class="pane-header">
        <div class="pane-tabs">
          <button id="tab-agent" class="tab-btn active" onclick="switchLeftTab('agent')">🤖 AI Assistant & Tools</button>
          <button id="tab-pty" class="tab-btn" onclick="switchLeftTab('pty')">💻 Shell Terminal</button>
        </div>
        <div style="display:flex; gap:6px;">
          <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="openModelModal()">Switch Model ▾</button>
          <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="sendAgentCmd('/reset')">Reset Context</button>
        </div>
      </div>

      <div class="turn-chips" id="turn-chips">
        <span style="color:var(--text-dim);">Turns:</span>
        <span class="turn-chip" onclick="sendAgentCmd('/history')">#1 (Session Start)</span>
      </div>

      <div id="terminal-container">
        <div id="agent-view" class="terminal-view active"></div>
        <div id="pty-view" class="terminal-view"></div>
      </div>

      <div class="quick-input-container">
        <input type="text" class="quick-input" id="chat-input" placeholder="Type prompt or command (/models, /undo, /stats, /help)..." onkeydown="handleQuickInput(event)" />
        <button class="btn btn-primary" onclick="submitQuickInput()">Send ↵</button>
      </div>
    </div>

    <!-- RIGHT PANE: File Exploration, Diff Viewer & CodeGraph -->
    <div id="right-pane" class="pane">
      <div class="pane-header">
        <div class="pane-tabs">
          <button id="tab-files" class="tab-btn active" onclick="switchRightTab('files')">📁 File Explorer</button>
          <button id="tab-viewer" class="tab-btn" onclick="switchRightTab('viewer')">📄 File Viewer</button>
          <button id="tab-diff" class="tab-btn" onclick="switchRightTab('diff')">🔍 Diff Viewer (<span id="diff-count">0</span>)</button>
          <button id="tab-graph" class="tab-btn" onclick="switchRightTab('graph')">🌳 CodeGraph</button>
        </div>
        <button class="btn" style="padding:2px 6px; font-size:10px;" onclick="refreshRightPane()">↻ Refresh</button>
      </div>

      <!-- View 1: File Explorer -->
      <div id="view-files" class="right-view active">
        <div class="file-explorer-container">
          <div style="padding:6px 10px; background:#11151c; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:11px; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:240px;" id="explorer-root-label" title="Current Workspace Root">Root: .</div>
            <button class="btn" style="padding:2px 7px; font-size:10.5px;" onclick="openWorkspaceModal()" title="Change Project Workspace Folder">📂 Switch Folder</button>
          </div>
          <div class="search-box">
            <input type="text" class="search-input" id="file-search" placeholder="Search workspace files..." oninput="filterFiles(this.value)" />
          </div>
          <div class="file-tree" id="file-tree-list">
            <div style="color:var(--text-dim); padding:8px;">Loading workspace files...</div>
          </div>
        </div>
      </div>

      <!-- View 2: Code / File Viewer -->
      <div id="view-viewer" class="right-view">
        <div class="code-viewer-container">
          <div class="code-header">
            <strong id="current-view-file">Select a file from Explorer</strong>
            <button class="btn" onclick="copyViewerContent()">Copy</button>
          </div>
          <div class="code-content" id="viewer-content">// File content will appear here when selected in the File Explorer</div>
        </div>
      </div>

      <!-- View 3: Diff Viewer -->
      <div id="view-diff" class="right-view">
        <div class="code-viewer-container">
          <div class="code-header">
            <strong id="diff-file-title">No Modified Files</strong>
            <button class="btn btn-undo" onclick="triggerUndo()">Revert Last Edit</button>
          </div>
          <div class="code-content" id="diff-content">// Tool edit modifications and file diffs will appear here in real-time</div>
        </div>
      </div>

      <!-- View 4: CodeGraph -->
      <div id="view-graph" class="right-view">
        <div class="graph-stats-bar" id="graph-stats-bar">
          <span class="graph-stat-pill">Files: <b id="g-files">-</b></span>
          <span class="graph-stat-pill">Symbols: <b id="g-symbols">-</b></span>
          <span class="graph-stat-pill">Imports: <b id="g-imports">-</b></span>
          <span class="graph-stat-pill">Calls: <b id="g-calls">-</b></span>
        </div>
        <div class="search-box">
          <input type="text" class="search-input" id="graph-search" placeholder="Search functions, classes, interfaces in codebase..." oninput="searchGraph(this.value)" />
        </div>
        <div class="graph-symbols-list" id="graph-symbols-list">
          <div style="color:var(--text-dim); padding:8px;">Analyzing codebase knowledge graph...</div>
        </div>
      </div>
    </div>
  </div>

  <div class="status-bar">
    <div class="status-left">
      <span><span class="dot" id="status-dot"></span><span id="connection-status">Connecting…</span></span>
      <span id="status-model">Model: auto</span>
      <span id="status-tokens">Used: 0 tok</span>
      <span id="status-spent" style="color:var(--green);">Est. Spent: $0.0000</span>
      <span id="status-workspace" onclick="openWorkspaceModal()" style="cursor:pointer; text-decoration:underline;" title="Click to view or switch workspace directory">Workspace: Active</span>
    </div>
    <div>
      <span>Left: Chat & Autonomous Tools · Right: File Tree, Diffs & CodeGraph</span>
    </div>
  </div>

  <!-- Model Selector Modal with Unmixed Local & Cloud Tabs -->
  <div class="modal-overlay" id="model-modal">
    <div class="modal-dialog">
      <div class="modal-title-bar">
        <span>Select Available Model</span>
        <button class="btn" onclick="closeModelModal()">✕</button>
      </div>
      <div class="modal-tabs">
        <button class="modal-tab-btn active" id="mtab-local" onclick="switchModelModalTab('local')">🟢 Local Models (<span id="local-count">0</span>)</button>
        <button class="modal-tab-btn" id="mtab-cloud" onclick="switchModelModalTab('cloud')">☁ Configured Cloud (<span id="cloud-count">0</span>)</button>
        <button class="modal-tab-btn" id="mtab-all" onclick="switchModelModalTab('all')">All Models (<span id="all-count">0</span>)</button>
      </div>
      <div class="search-box" style="background:var(--panel-bg);">
        <input type="text" class="search-input" id="model-search" placeholder="Filter models by name or provider..." oninput="filterModels(this.value)" />
      </div>
      <div class="modal-body" id="model-list-container">
        <div style="color:var(--text-dim); text-align:center; padding:20px;">Scanning available models...</div>
      </div>
    </div>
  </div>

  <!-- Account & API Keys Modal -->
  <div class="modal-overlay" id="account-modal">
    <div class="modal-dialog">
      <div class="modal-title-bar">
        <span>Provider Accounts & API Keys</span>
        <button class="btn" onclick="closeAccountModal()">✕</button>
      </div>
      <div class="modal-body" id="provider-list-container">
        <div style="color:var(--text-dim); text-align:center; padding:20px;">Loading provider accounts...</div>
      </div>
    </div>
  </div>

  <!-- Mid-task Question Modal (agent question tool) -->
  <div class="modal-overlay" id="question-modal">
    <div class="modal-dialog" style="max-width:560px;">
      <div class="modal-title-bar">
        <span id="question-modal-header">Agent Question</span>
        <button class="btn" onclick="dismissQuestion()">✕</button>
      </div>
      <div class="modal-body">
        <div id="question-modal-text" style="font-size:14px; color:var(--text); margin-bottom:4px;"></div>
        <div id="question-modal-options" style="display:flex; flex-direction:column; gap:8px; margin-top:8px;"></div>
      </div>
    </div>
  </div>

  <!-- Tool Permission Approval Modal (ask-gated calls) -->
  <div class="modal-overlay" id="approval-modal">
    <div class="modal-dialog" style="max-width:560px;">
      <div class="modal-title-bar">
        <span id="approval-modal-header">🔒 Permission Required</span>
        <button class="btn" onclick="denyApproval()">✕</button>
      </div>
      <div class="modal-body">
        <div style="font-size:13px; color:var(--text); margin-bottom:8px;">The agent wants to <b id="approval-tool"></b>:</div>
        <pre id="approval-args" style="background:#0d1117; border:1px solid var(--border); border-radius:6px; padding:10px; font-size:12px; color:var(--text-dim); max-height:220px; overflow:auto; white-space:pre-wrap; word-break:break-word; margin:0 0 12px 0;"></pre>
        <div style="display:flex; gap:8px; justify-content:flex-end;">
          <button class="btn" onclick="denyApproval()">✕ Deny</button>
          <button class="btn btn-primary" onclick="allowApproval()">✓ Allow</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Pre-Session Configuration & Economics Modal -->
  <div class="modal-overlay" id="session-setup-modal">
    <div class="modal-dialog" style="max-width:680px; max-height:90vh; display:flex; flex-direction:column;">
      <div class="modal-title-bar">
        <span>🚀 Session Setup & Token Economics</span>
        <button class="btn" onclick="closeSessionSetupModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:16px; overflow-y:auto;">
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:6px; display:block;">Active Model & Provider:</label>
          <select id="setup-model-select" onchange="onSetupModelChange()" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:13px; font-family:inherit;">
            <option value="">Loading models...</option>
          </select>
          <div id="setup-model-badge" style="margin-top:6px; font-size:11px; color:var(--text-dim); display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
            <span id="setup-model-provider" style="color:var(--accent);">Provider: Auto</span>
            <span id="setup-model-context" style="color:var(--text-dim);">Context: 128k</span>
            <span id="setup-model-pricing" style="color:var(--green); font-weight:600;">Pricing: Detecting...</span>
          </div>
        </div>

        <!-- Project Workspace Folder Selector inside Setup -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="font-size:12px; font-weight:600; color:var(--text);">📂 Project Workspace Folder:</label>
            <span style="font-size:10.5px; color:var(--text-dim); font-family:monospace;" id="setup-workspace-current-badge">.</span>
          </div>
          <div style="display:flex; gap:8px; margin-bottom:10px;">
            <button type="button" class="btn btn-primary" id="setup-tab-existing" onclick="switchSetupWorkspaceTab('existing')" style="font-size:11px; padding:4px 10px;">Open Existing Folder</button>
            <button type="button" class="btn" id="setup-tab-create" onclick="switchSetupWorkspaceTab('create')" style="font-size:11px; padding:4px 10px;">✨ Create New Project</button>
          </div>
          <div id="setup-ws-existing-pane">
            <div style="display:flex; gap:8px;">
              <input type="text" id="setup-workspace-input" placeholder="e.g. C:\\projects\\myapp or /home/user/code" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:12px; font-family:monospace;" />
              <button type="button" class="btn" onclick="openDirPicker('setup-workspace-input')" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">📁 Browse...</button>
              <button type="button" class="btn btn-primary" onclick="applySetupWorkspaceFolder(false)" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">Open Folder</button>
            </div>
            <div style="font-size:10.5px; color:var(--text-dim); margin-top:4px;">Enter the path or click <b>Browse...</b> to navigate your computer's folders.</div>
          </div>
          <div id="setup-ws-create-pane" style="display:none;">
            <div style="display:flex; gap:8px;">
              <input type="text" id="setup-workspace-create-input" placeholder="e.g. C:\\projects\\my-new-app or ./new-project" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:12px; font-family:monospace;" />
              <button type="button" class="btn" onclick="openDirPicker('setup-workspace-create-input')" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">📁 Browse Parent...</button>
              <button type="button" class="btn btn-primary" onclick="applySetupWorkspaceFolder(true)" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">Create & Open</button>
            </div>
            <div style="font-size:10.5px; color:#58a6ff; margin-top:4px;">✨ Browse to choose location or type new project path. Creates folder automatically.</div>
          </div>
          <div id="setup-workspace-msg" style="display:none; font-size:11px; margin-top:6px;"></div>
        </div>

        <!-- Workload Quick Presets -->
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:6px; display:block;">Suggested Workload Presets:</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="preset-btn-light" class="btn preset-btn" onclick="applyWorkloadPreset('light')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="8k context, 4k output, 10 tools, 20 turns">💬 Light Convo</button>
            <button type="button" id="preset-btn-deep" class="btn preset-btn btn-primary" onclick="applyWorkloadPreset('deep')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="24k context, 8k output, 25 tools, 50 turns">🛠 Deep Development (Rec)</button>
            <button type="button" id="preset-btn-big" class="btn preset-btn" onclick="applyWorkloadPreset('big')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="64k context, 16k output, 50 tools, 100 turns">🏗 Big Codebase & Audit</button>
          </div>
        </div>

        <!-- Sliders with synced inputs & dual explanations -->
        <div style="display:flex; flex-direction:column; gap:14px; background:#0d1117; border:1px solid var(--border); border-radius:8px; padding:14px;">
          <!-- 1. Context Token Budget -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-history-budget">Context Token Budget:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-history-budget" value="16000" step="1000" min="1000" max="128000" oninput="syncSliderFromInput('history-budget')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">tok</span>
              </div>
            </div>
            <input type="range" id="slider-history-budget" min="1000" max="128000" step="1000" value="16000" oninput="syncInputFromSlider('history-budget')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> How much past conversation and project code the AI can remember at once.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> History sliding-window budget for history compaction before sending prompt.</div>
          </div>

          <!-- 2. Max Output Tokens -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-output">Max Output Tokens:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-output" value="8192" step="512" min="1024" max="32768" oninput="syncSliderFromInput('max-output')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">tok</span>
              </div>
            </div>
            <input type="range" id="slider-max-output" min="1024" max="32768" step="512" value="8192" oninput="syncInputFromSlider('max-output')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> Maximum length of a single AI reply or file written in one step.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Model completion max_tokens ceiling; stops responses or reports from truncating.</div>
          </div>

          <!-- 3. Max Tool Iterations per Turn -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-tool-iters">Max Tool Calls per Turn:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-tool-iters" value="20" min="5" max="100" oninput="syncSliderFromInput('max-tool-iters')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">calls</span>
              </div>
            </div>
            <input type="range" id="slider-max-tool-iters" min="5" max="100" step="1" value="20" oninput="syncInputFromSlider('max-tool-iters')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> Max actions (reading/writing files, shell commands) before pausing for your approval.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Bounded iteration limit for ToolLoop; if reached mid-task, prompts user to extend.</div>
          </div>

          <!-- 4. Max History Turns -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-turns">Max History Turns:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-turns" value="50" min="5" max="200" oninput="syncSliderFromInput('max-turns')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">turns</span>
              </div>
            </div>
            <input type="range" id="slider-max-turns" min="5" max="200" step="5" value="50" oninput="syncInputFromSlider('max-turns')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> Number of conversational rounds kept before summarizing earlier turns.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Message eviction threshold in budgetConversationHistory.</div>
          </div>
        </div>

        <!-- Estimated Budget per million & per turn -->
        <div style="background:#0d1117; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-size:12px; color:var(--text-dim); font-weight:600;">📊 Estimated Cost / Single Turn:</span>
            <span id="setup-estimated-cost" style="font-size:14px; font-weight:700; color:var(--green);">$0.0000</span>
          </div>
          <div id="setup-pricing-detail" style="font-size:11px; color:var(--text-dim); margin-top:4px;">
            Pricing per 1M tokens: $0.00 In · $0.00 Out
          </div>
        </div>

        <!-- Thinking / Reasoning Effort Selector -->
        <div id="setup-thinking-container" style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <label style="font-size:12px; font-weight:600; color:var(--text);">🧠 Reasoning / Thinking Effort:</label>
            <span id="setup-thinking-support-badge" style="font-size:10.5px; color:var(--cyan);">Supported</span>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="thinking-btn-off" class="btn thinking-btn" onclick="setThinkingLevel('off')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;">Off</button>
            <button type="button" id="thinking-btn-low" class="btn thinking-btn" onclick="setThinkingLevel('low')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="~1k tokens / quick reasoning">Low</button>
            <button type="button" id="thinking-btn-medium" class="btn thinking-btn btn-primary" onclick="setThinkingLevel('medium')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="~4k tokens / balanced coding (default)">Medium (Rec)</button>
            <button type="button" id="thinking-btn-high" class="btn thinking-btn" onclick="setThinkingLevel('high')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="~16k+ tokens / deep audits & complex logic">High</button>
          </div>
          <div style="font-size:10.5px; color:#58a6ff; margin-top:6px;">• <b>Def:</b> Controls how deeply the AI thinks before writing code or running tools.</div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Sets reasoning_effort (OpenAI/OpenRouter) or budget_tokens (Anthropic).</div>
        </div>

        <!-- Webfetch Online Access Toggle -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; font-size:13px; color:var(--text); user-select:none;">
            <input type="checkbox" id="setup-webfetch-checkbox" checked style="cursor:pointer;" />
            <span>🌐 Web Access (webfetch tool for live docs & web pages)</span>
          </label>
          <div style="font-size:10.5px; color:#58a6ff; margin-top:4px;">• <b>Def:</b> Allows the AI to fetch remote documentation, APIs, and web pages online.</div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Exposes webfetch tool in the agent tool registry; uncheck to enforce offline air-gap mode.</div>
        </div>

        <!-- Turbo Mode & Caution -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; font-size:13px; color:var(--text); user-select:none;">
            <input type="checkbox" id="setup-turbo-checkbox" onchange="onTurboCheckboxChange()" style="cursor:pointer;" />
            <span>⚡ Turbo Mode (Autonomous Execution)</span>
          </label>
          <div id="setup-turbo-caution" style="display:none; background:#2a1705; border:1px solid #d29922; border-radius:6px; padding:10px 12px; margin-top:10px; font-size:11.5px; color:#f0883e; line-height:1.45;">
            ⚠ <b>CAUTION:</b> Turbo Mode allows execution without user confirmation prompts.
            File modifications, writes, deletions, and shell terminal commands will execute immediately without pausing for approval.
            Enable only in trusted workspaces with a clean git status or backed up code.
          </div>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:4px;">
          <button class="btn" onclick="closeSessionSetupModal()">Cancel</button>
          <button class="btn btn-primary" style="padding:6px 20px; font-size:13px;" onclick="applySessionSetup()">🚀 Start Session</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Token Saving Modules & Superpowers Modal -->
  <div class="modal-overlay" id="modules-modal">
    <div class="modal-dialog" style="max-width:720px;">
      <div class="modal-title-bar">
        <span>⚡ Token-Saving Modules & Superpowers</span>
        <button class="btn" onclick="closeModulesModal()">✕</button>
      </div>
      <div style="padding:12px 16px; background:var(--panel-bg); border-bottom:1px solid var(--border);">
        <div style="font-weight:600; font-size:12.5px; margin-bottom:6px; color:var(--text);">⚙ Context Token Limiter & History Budget</div>
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-history-budget">Budget (Tokens):</label>
            <input type="number" id="cfg-history-budget" style="width:90px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="16000" step="1000" min="1000" />
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-max-turns">Max History Turns:</label>
            <input type="number" id="cfg-max-turns" style="width:70px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="50" min="2" max="500" />
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-max-output">Max Output Tokens:</label>
            <input type="number" id="cfg-max-output" style="width:80px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="8192" step="512" min="1024" />
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-max-tool-iters">Max Tool Calls:</label>
            <input type="number" id="cfg-max-tool-iters" style="width:65px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="20" min="5" max="200" />
          </div>
          <button class="btn btn-primary" style="padding:3px 10px; font-size:11px;" onclick="saveConfigLimits()">Save Limits</button>
          <span id="cfg-save-status" style="font-size:11px; color:var(--green); display:none;">✓ Saved</span>
        </div>
      </div>
      <div style="padding:10px 16px; background:var(--panel-bg); border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
        <span style="font-size:12px; color:var(--text-dim);">Independent modular rules, token compression & AI clean-pass layers</span>
        <button class="btn btn-primary" id="btn-update-modules" onclick="triggerUpdateModules()">🔄 Check & Update Rules</button>
      </div>
      <div class="modal-body" id="modules-list-container" style="max-height:480px; overflow-y:auto;">
        <div style="color:var(--text-dim); text-align:center; padding:20px;">Loading modules...</div>
      </div>
    </div>
  </div>

  <!-- Workspace Project Selector Modal -->
  <div class="modal-overlay" id="workspace-modal">
    <div class="modal-dialog" style="max-width:560px;">
      <div class="modal-title-bar">
        <span>📂 Project Workspace Selector</span>
        <button class="btn" onclick="closeWorkspaceModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:14px;">
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:4px; display:block;">Active Project Directory:</label>
          <div id="current-workspace-display" style="font-size:12px; font-family:monospace; color:var(--accent); background:#0d1117; padding:8px 10px; border-radius:6px; border:1px solid var(--border); word-break:break-all;">Loading...</div>
        </div>

        <div style="display:flex; gap:8px;">
          <button type="button" class="btn btn-primary" id="modal-ws-tab-existing" onclick="switchModalWorkspaceTab('existing')" style="font-size:11.5px; padding:4px 12px;">Open Existing Folder</button>
          <button type="button" class="btn" id="modal-ws-tab-create" onclick="switchModalWorkspaceTab('create')" style="font-size:11.5px; padding:4px 12px;">✨ Create New Project</button>
        </div>

        <div id="modal-ws-existing-pane">
          <label for="workspace-path-input" style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:4px; display:block;">Switch to Folder Path:</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="workspace-path-input" placeholder="e.g. C:\\projects\\myapp or /home/user/mycode" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px; font-family:monospace;" />
            <button type="button" class="btn" onclick="openDirPicker('workspace-path-input')" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">📁 Browse...</button>
          </div>
          <div style="font-size:10.5px; color:var(--text-dim); margin-top:4px;">Enter an absolute or relative directory path or click <b>Browse...</b> to navigate.</div>
        </div>

        <div id="modal-ws-create-pane" style="display:none;">
          <label for="workspace-create-input" style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:4px; display:block;">New Project Location / Path:</label>
          <div style="display:flex; gap:8px;">
            <input type="text" id="workspace-create-input" placeholder="e.g. C:\\projects\\my-new-app or ./new-project" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px; font-family:monospace;" />
            <button type="button" class="btn" onclick="openDirPicker('workspace-create-input')" style="font-size:11.5px; padding:6px 12px; white-space:nowrap;">📁 Browse Parent...</button>
          </div>
          <div style="font-size:10.5px; color:#58a6ff; margin-top:4px;">Creates the folder recursively if it does not exist and immediately opens it as your workspace.</div>
        </div>

        <div id="workspace-error-msg" style="display:none; color:var(--red); font-size:11.5px;"></div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:6px;">
          <button class="btn" onclick="closeWorkspaceModal()">Cancel</button>
          <button class="btn btn-primary" id="btn-submit-workspace" onclick="submitChangeWorkspace()">✓ Switch Project</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Directory Browser Modal -->
  <div class="modal-overlay" id="dirpicker-modal" style="z-index:10000;">
    <div class="modal-dialog" style="max-width:580px; max-height:85vh; display:flex; flex-direction:column;">
      <div class="modal-title-bar">
        <span>📁 Select Folder</span>
        <button class="btn" onclick="closeDirPicker()">✕</button>
      </div>
      <div class="modal-body" style="padding:14px 18px; display:flex; flex-direction:column; gap:12px; overflow-y:auto;">
        <!-- Shortcuts -->
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <span style="font-size:11px; color:var(--text-dim); font-weight:600;">Shortcuts:</span>
          <div id="dirpicker-shortcuts" style="display:flex; gap:6px; flex-wrap:wrap;"></div>
        </div>

        <!-- Current Path Navigation Bar -->
        <div style="display:flex; gap:8px; align-items:center;">
          <button class="btn" id="dirpicker-up-btn" onclick="dirPickerGoUp()" title="Go up to parent folder" style="padding:5px 10px; font-size:12px;">⬆ Up</button>
          <div id="dirpicker-current-path" style="flex:1; font-family:monospace; font-size:11.5px; background:#0d1117; padding:6px 10px; border-radius:6px; border:1px solid var(--border); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--accent);"></div>
          <button class="btn" onclick="refreshDirPicker()" title="Refresh directory" style="padding:5px 10px; font-size:12px;">🔄</button>
        </div>

        <!-- Directory Subfolders List -->
        <div id="dirpicker-folder-list" style="max-height:280px; min-height:180px; overflow-y:auto; background:#0d1117; border:1px solid var(--border); border-radius:6px; padding:6px; display:flex; flex-direction:column; gap:2px;">
          <div style="color:var(--text-dim); text-align:center; padding:20px; font-size:12px;">Loading folders...</div>
        </div>

        <!-- New Folder Inside Current Location -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:10px 12px;">
          <label style="font-size:11.5px; font-weight:600; color:var(--text); margin-bottom:4px; display:block;">Or Create New Subfolder Here:</label>
          <div style="display:flex; gap:6px;">
            <input type="text" id="dirpicker-newfolder-name" placeholder="subfolder-name" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:5px 8px; border-radius:4px; font-size:12px; font-family:monospace;" />
            <button type="button" class="btn" onclick="dirPickerAppendSubfolder()" style="font-size:11px; padding:5px 10px; white-space:nowrap;">+ Use Subfolder</button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <span style="font-size:11px; color:var(--text-dim);" id="dirpicker-selected-summary"></span>
          <div style="display:flex; gap:8px;">
            <button class="btn" onclick="closeDirPicker()">Cancel</button>
            <button class="btn btn-primary" onclick="confirmDirPicker()">✓ Select This Folder</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentThinkingLevel = "medium";

    function highlightThinkingButtons(lvl) {
      currentThinkingLevel = lvl || "medium";
      ["off", "low", "medium", "high"].forEach(k => {
        const btn = document.getElementById("thinking-btn-" + k);
        if (!btn) return;
        if (k === currentThinkingLevel) btn.classList.add("btn-primary");
        else btn.classList.remove("btn-primary");
      });
    }

    function setThinkingLevel(lvl) {
      highlightThinkingButtons(lvl);
    }

    function checkModelThinkingSupport(modelId) {
      const m = (allAvailableModels || []).find(x => x.id === modelId);
      const badge = document.getElementById("setup-thinking-support-badge");
      const container = document.getElementById("setup-thinking-container");
      const isSupported = m ? Boolean(m.supportsThinking) : false;
      if (badge) {
        badge.textContent = isSupported ? "Supported by Model" : "Standard (Non-Thinking)";
        badge.style.color = isSupported ? "var(--cyan)" : "var(--text-dim)";
      }
    }
    let currentTurboMode = false;
    let configuredHistoryBudget = 16000;
    let configuredMaxOutputTokens = 8192;
    let configuredMaxToolIters = 20;
    let activeLeftTab = 'agent';
    let activeRightTab = 'files';
    let activeModelTab = 'local';
    let agentTerm, ptyTerm;
    let agentFit, ptyFit;
    let ws;
    let availableLocalModels = [];
    let availableCloudModels = [];
    let allAvailableModels = [];
    let activeModelId = '';
    let workspaceFiles = [];
    let sessionTurns = [];
    let modifiedFiles = [];
    let currentSelectedPath = '';

    // --- UI Font Scaling & Zoom ---
    let currentZoom = parseFloat(localStorage.getItem('mugil_ui_zoom') || '1.0');
    if (isNaN(currentZoom) || currentZoom < 0.7 || currentZoom > 2.0) currentZoom = 1.0;

    function applyZoom(zoom) {
      currentZoom = Math.min(1.8, Math.max(0.8, Math.round(zoom * 100) / 100));
      localStorage.setItem('mugil_ui_zoom', currentZoom.toString());
      document.documentElement.style.setProperty('--font-scale', currentZoom.toString());
      const zoomLabel = document.getElementById('zoom-label');
      if (zoomLabel) zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
      const termFont = Math.round(14 * currentZoom);
      if (agentTerm) {
        agentTerm.options.fontSize = termFont;
        if (agentFit) agentFit.fit();
      }
      if (ptyTerm) {
        ptyTerm.options.fontSize = termFont;
        if (ptyFit) ptyFit.fit();
      }
      notifyResize();
    }

    function changeZoom(delta) {
      applyZoom(currentZoom + delta);
    }

    // Apply saved zoom immediately on load
    document.documentElement.style.setProperty('--font-scale', currentZoom.toString());
    window.addEventListener('DOMContentLoaded', () => {
      const zoomLabel = document.getElementById('zoom-label');
      if (zoomLabel) zoomLabel.textContent = Math.round(currentZoom * 100) + '%';
    });

    // Keyboard shortcuts for zooming (Ctrl + / Ctrl - / Ctrl 0)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        changeZoom(0.1);
      } else if ((e.ctrlKey || e.metaKey) && (e.key === '-' || e.key === '_')) {
        e.preventDefault();
        changeZoom(-0.1);
      } else if ((e.ctrlKey || e.metaKey) && e.key === '0') {
        e.preventDefault();
        applyZoom(1.0);
      }
    });

    function initTerminals() {
      const termFontSize = Math.round(14 * currentZoom);
      agentTerm = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: termFontSize,
        fontFamily: 'Consolas, "Fira Code", "Courier New", monospace',
        theme: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: 'transparent',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
          brightBlack: '#6e7681',
          brightRed: '#ffa198',
          brightGreen: '#56d364',
          brightYellow: '#e3b341',
          brightBlue: '#79c0ff',
          brightMagenta: '#d2a8ff',
          brightCyan: '#56d4dd',
          brightWhite: '#ffffff'
        }
      });
      agentFit = new FitAddon.FitAddon();
      agentTerm.loadAddon(agentFit);
      if (window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon) {
        agentTerm.loadAddon(new window.WebLinksAddon.WebLinksAddon());
      }
      agentTerm.open(document.getElementById('agent-view'));
      agentFit.fit();

      // Forward Ctrl+C from agentTerm to cancel active turns
      agentTerm.attachCustomKeyEventHandler(e => {
        if (e.ctrlKey && e.key === 'c' && e.type === 'keydown') {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'agent_input', data: '\x03' }));
          }
          return false;
        }
        return true;
      });

      document.getElementById('agent-view').addEventListener('click', () => {
        if (!window.getSelection().toString()) {
          const chatInput = document.getElementById('chat-input');
          if (chatInput) chatInput.focus();
        }
      });

      ptyTerm = new Terminal({
        cursorBlink: true,
        fontSize: termFontSize,
        fontFamily: 'Consolas, "Fira Code", "Courier New", monospace',
        theme: {
          background: '#000000',
          foreground: '#f0f6fc',
          cursor: '#3fb950'
        }
      });
      ptyFit = new FitAddon.FitAddon();
      ptyTerm.loadAddon(ptyFit);
      if (window.WebLinksAddon && window.WebLinksAddon.WebLinksAddon) {
        ptyTerm.loadAddon(new window.WebLinksAddon.WebLinksAddon());
      }
      ptyTerm.open(document.getElementById('pty-view'));

      agentTerm.onData(data => {
        // Output-only view: only forward Ctrl+C cancel signal
        if (data === '\x03' && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'agent_input', data }));
        }
      });

      ptyTerm.onData(data => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'pty_input', data }));
        }
      });

      window.addEventListener('resize', () => {
        if (activeLeftTab === 'agent') agentFit.fit();
        else ptyFit.fit();
        notifyResize();
      });
    }

    function switchLeftTab(tab) {
      activeLeftTab = tab;
      document.getElementById('tab-agent').classList.toggle('active', tab === 'agent');
      document.getElementById('tab-pty').classList.toggle('active', tab === 'pty');
      document.getElementById('agent-view').classList.toggle('active', tab === 'agent');
      document.getElementById('pty-view').classList.toggle('active', tab === 'pty');
      setTimeout(() => {
        if (tab === 'agent') {
          agentFit.fit();
          const chatInput = document.getElementById('chat-input');
          if (chatInput) chatInput.focus();
        } else {
          ptyFit.fit();
          ptyTerm.focus();
        }
        notifyResize();
      }, 40);
    }

    function switchRightTab(tab) {
      activeRightTab = tab;
      document.getElementById('tab-files').classList.toggle('active', tab === 'files');
      document.getElementById('tab-viewer').classList.toggle('active', tab === 'viewer');
      document.getElementById('tab-diff').classList.toggle('active', tab === 'diff');
      document.getElementById('tab-graph').classList.toggle('active', tab === 'graph');

      document.getElementById('view-files').classList.toggle('active', tab === 'files');
      document.getElementById('view-viewer').classList.toggle('active', tab === 'viewer');
      document.getElementById('view-diff').classList.toggle('active', tab === 'diff');
      document.getElementById('view-graph').classList.toggle('active', tab === 'graph');

      if (tab === 'graph') loadGraph();
      if (tab === 'diff') loadDiffs();
    }

    function notifyResize() {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (activeLeftTab === 'agent' && agentTerm) {
        ws.send(JSON.stringify({ type: 'resize_agent', cols: agentTerm.cols, rows: agentTerm.rows }));
      } else if (activeLeftTab === 'pty' && ptyTerm) {
        ws.send(JSON.stringify({ type: 'resize_pty', cols: ptyTerm.cols, rows: ptyTerm.rows }));
      }
    }

    function sendAgentCmd(cmd) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        // NOTE: this line lives inside a TS template literal, so escape
        // sequences are evaluated once before the browser sees them. Two
        // backslashes here ship a real carriage return (good); one backslash
        // ships a literal backslash-r and the submit never fires.
        ws.send(JSON.stringify({ type: 'agent_input', data: cmd + '\\r' }));
      }
    }

    function handleQuickInput(e) {
      if (e.key === 'Enter') {
        submitQuickInput();
      }
    }

    function submitQuickInput() {
      const input = document.getElementById('chat-input');
      const val = input.value.trim();
      if (!val) return;
      if (val === '/models' || val === '/model') {
        openModelModal();
        input.value = '';
        return;
      }
      sendAgentCmd(val);
      input.value = '';
      switchLeftTab('agent');
    }

    function connectWs() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = \`\${protocol}//\${location.host}/ws\`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        document.getElementById('status-dot').style.background = '#3fb950';
        document.getElementById('connection-status').textContent = 'Connected';
        notifyResize();
      };

      ws.onclose = () => {
        document.getElementById('status-dot').style.background = '#ff7b72';
        document.getElementById('connection-status').textContent = 'Disconnected (Reconnecting...)';
        setTimeout(connectWs, 2000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'agent_data') {
            agentTerm.write(msg.data);
            agentTerm.scrollToBottom();
          } else if (msg.type === 'pty_data') {
            ptyTerm.write(msg.data);
            ptyTerm.scrollToBottom();
          } else if (msg.type === 'turn_complete') {
            addTurnChip(msg.turn);
            refreshFiles();
          } else if (msg.type === 'question') {
            showQuestion(msg);
          } else if (msg.type === 'approval') {
            showApproval(msg);
          } else if (msg.type === 'status') {
            if (msg.turboMode !== undefined) {
              updateTurboUI(msg.turboMode);
            }
            if (msg.activeModel) {
              activeModelId = msg.activeModel;
              const subEl = document.getElementById('sub-active-model');
              if (subEl) subEl.textContent = msg.activeModel;
              document.getElementById('header-active-model').textContent = msg.activeModel;
              const modeLabel = msg.mode === 'plan' ? 'plan' : 'act';
              document.getElementById('status-model').textContent = 'Model: ' + msg.activeModel + ' · Mode: ' + modeLabel;
              updateModeUI(msg.mode);
            }
            if (msg.stats) {
              document.getElementById('status-tokens').textContent = 'Used: ' + msg.stats.totalTokens + ' tok';
              const cost = typeof msg.stats.estimatedCost === 'number' ? msg.stats.estimatedCost : 0;
              const costText = 'Est. Spent: $' + cost.toFixed(4);
              const headerSpent = document.getElementById('session-spent');
              if (headerSpent) headerSpent.textContent = costText;
              const statusSpent = document.getElementById('status-spent');
              if (statusSpent) statusSpent.textContent = costText;

              const pct = msg.stats.promptTokens + msg.stats.tokensSaved > 0
                ? Math.round((msg.stats.tokensSaved / (msg.stats.promptTokens + msg.stats.tokensSaved)) * 100)
                : 0;
              document.getElementById('token-savings').textContent = 'Savings: ' + pct + '% (' + msg.stats.tokensSaved + ' tok)';
              if (msg.stats.filesModified) {
                modifiedFiles = msg.stats.filesModified;
                document.getElementById('diff-count').textContent = modifiedFiles.length;
                if (modifiedFiles.length > 0) renderDiffSummary(modifiedFiles);
              }
            }
          }
        } catch (e) {
          agentTerm.write(event.data);
          agentTerm.scrollToBottom();
        }
      };
    }

    function toggleMenuDropdown(e) {
      if (e) e.stopPropagation();
      const dd = document.getElementById('header-menu-dropdown');
      if (dd) dd.classList.toggle('show');
    }

    function closeMenuDropdown() {
      const dd = document.getElementById('header-menu-dropdown');
      if (dd) dd.classList.remove('show');
    }

    document.addEventListener('click', (e) => {
      const dd = document.getElementById('header-menu-dropdown');
      const btn = document.getElementById('header-menu-btn');
      if (dd && dd.classList.contains('show')) {
        if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          dd.classList.remove('show');
        }
      }
    });

    // --- Plan/Act mode toggle ---
    let currentMode = 'act';

    function toggleMode() {
      currentMode = currentMode === 'act' ? 'plan' : 'act';
      ws.send(JSON.stringify({ type: 'set_mode', mode: currentMode }));
      updateModeUI(currentMode);
    }

    function updateModeUI(mode) {
      currentMode = mode;
      const icon = document.getElementById('mode-icon');
      const label = document.getElementById('mode-label');
      if (mode === 'plan') {
        icon.textContent = '🔒';
        label.textContent = 'Plan';
        label.style.color = 'var(--warning, #f0ad4e)';
      } else {
        icon.textContent = '⚡';
        label.textContent = 'Act';
        label.style.color = 'var(--accent, #58a6ff)';
      }
    }

    // --- Mid-task question picker (server -> browser -> server) ---
    let pendingQuestionId = null;

    function showQuestion(q) {
      pendingQuestionId = q.id;
      document.getElementById('question-modal-header').textContent = q.header || 'Agent Question';
      document.getElementById('question-modal-text').textContent = q.question || '';
      const container = document.getElementById('question-modal-options');
      container.innerHTML = '';
      (q.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'modal-item-card';
        btn.style.cssText = 'text-align:left; width:100%; font-size:13px; color:var(--text); border-radius:6px;';
        btn.textContent = '[' + (idx + 1) + '] ' + opt;
        btn.onclick = () => answerQuestion(opt);
        container.appendChild(btn);
      });
      document.getElementById('question-modal').classList.add('open');
    }

    function sendQuestionAnswer(id, answer) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'question_answer', id, answer }));
      }
    }

    function answerQuestion(answer) {
      if (pendingQuestionId == null) return;
      const id = pendingQuestionId;
      pendingQuestionId = null;
      document.getElementById('question-modal').classList.remove('open');
      sendQuestionAnswer(id, answer);
    }

    function dismissQuestion() {
      if (pendingQuestionId == null) return;
      const id = pendingQuestionId;
      pendingQuestionId = null;
      document.getElementById('question-modal').classList.remove('open');
      sendQuestionAnswer(id, '(dismissed)');
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const qm = document.getElementById('question-modal');
        if (qm && qm.classList.contains('open')) dismissQuestion();
        const am = document.getElementById('approval-modal');
        if (am && am.classList.contains('open')) denyApproval();
      }
    });

    // --- Tool permission approval modal (ask-gated calls) ---
    let pendingApprovalId = null;

    function showApproval(msg) {
      pendingApprovalId = msg.id;
      document.getElementById('approval-tool').textContent = msg.tool || 'run a tool';
      document.getElementById('approval-args').textContent = msg.args || '{}';
      document.getElementById('approval-modal').classList.add('open');
    }

    function sendApprovalAnswer(id, granted) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'approval_answer', id, granted }));
      }
    }

    function allowApproval() {
      if (pendingApprovalId == null) return;
      const id = pendingApprovalId;
      pendingApprovalId = null;
      document.getElementById('approval-modal').classList.remove('open');
      sendApprovalAnswer(id, true);
    }

    function denyApproval() {
      if (pendingApprovalId == null) return;
      const id = pendingApprovalId;
      pendingApprovalId = null;
      document.getElementById('approval-modal').classList.remove('open');
      sendApprovalAnswer(id, false);
    }

    function addTurnChip(turn) {
      sessionTurns.push(turn);
      const container = document.getElementById('turn-chips');
      const chip = document.createElement('span');
      chip.className = 'turn-chip';
      chip.textContent = '#' + turn.id + ' ' + (turn.prompt.length > 20 ? turn.prompt.slice(0, 20) + '…' : turn.prompt);
      chip.onclick = () => {
        switchRightTab('diff');
        document.getElementById('diff-file-title').textContent = 'Turn #' + turn.id + ' Summary';
        document.getElementById('diff-content').textContent = \`Prompt: \${turn.prompt}\n\nModel: \${turn.model}\nTokens: \${turn.tokens.total}\nTools Called: \${turn.toolsCalled.length}\nModified Files: \${turn.filesModified.join(', ') || 'none'}\n\nResponse:\n\${turn.response}\`;
      };
      container.appendChild(chip);
    }

    async function refreshRightPane() {
      if (activeRightTab === 'files') refreshFiles();
      else if (activeRightTab === 'graph') loadGraph();
    }

    let currentWorkspaceRoot = '';
    let currentWorkspaceModalTab = 'existing';
    let currentSetupWorkspaceTab = 'existing';

    // --- Directory Browser State & Functions ---
    let dirPickerTargetInputId = '';
    let dirPickerCurrentPath = '';
    let dirPickerParentPath = null;

    async function openDirPicker(targetInputId) {
      dirPickerTargetInputId = targetInputId;
      const targetInput = document.getElementById(targetInputId);
      const initialPath = targetInput && targetInput.value.trim() ? targetInput.value.trim() : (currentWorkspaceRoot || '');
      const modal = document.getElementById('dirpicker-modal');
      if (modal) modal.classList.add('open');
      await navigateDirPicker(initialPath);
    }

    function closeDirPicker() {
      const modal = document.getElementById('dirpicker-modal');
      if (modal) modal.classList.remove('open');
    }

    async function navigateDirPicker(targetPath) {
      const pathEl = document.getElementById('dirpicker-current-path');
      const listEl = document.getElementById('dirpicker-folder-list');
      const upBtn = document.getElementById('dirpicker-up-btn');
      const shortcutsEl = document.getElementById('dirpicker-shortcuts');
      const summaryEl = document.getElementById('dirpicker-selected-summary');
      if (listEl) listEl.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px; font-size:12px;">Scanning folders...</div>';

      try {
        const url = '/api/fs/browse' + (targetPath ? '?path=' + encodeURIComponent(targetPath) : '');
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load folder');
        const data = await res.json();
        dirPickerCurrentPath = data.current;
        dirPickerParentPath = data.parent;

        if (pathEl) {
          pathEl.textContent = data.current;
          pathEl.title = data.current;
        }
        if (upBtn) {
          upBtn.disabled = !data.parent;
          upBtn.style.opacity = data.parent ? '1' : '0.4';
        }
        if (summaryEl) {
          summaryEl.textContent = 'Selected: ' + data.current;
        }

        // Render Shortcuts
        if (shortcutsEl && data.shortcuts) {
          shortcutsEl.innerHTML = '';
          data.shortcuts.forEach(s => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn';
            btn.style.fontSize = '10.5px';
            btn.style.padding = '2px 8px';
            btn.textContent = s.label;
            btn.onclick = () => navigateDirPicker(s.path);
            shortcutsEl.appendChild(btn);
          });
        }

        // Render Folder List
        if (listEl) {
          listEl.innerHTML = '';
          if (!data.dirs || data.dirs.length === 0) {
            listEl.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:16px; font-size:11.5px;">(No subdirectories here)</div>';
          } else {
            data.dirs.forEach(d => {
              const row = document.createElement('div');
              row.style.display = 'flex';
              row.style.alignItems = 'center';
              row.style.justifyContent = 'space-between';
              row.style.padding = '5px 8px';
              row.style.borderRadius = '4px';
              row.style.cursor = 'pointer';
              row.style.fontSize = '12px';
              row.style.color = 'var(--text)';
              row.style.transition = 'background 0.1s';
              row.onmouseenter = () => { row.style.background = '#161b22'; };
              row.onmouseleave = () => { row.style.background = 'transparent'; };

              const nameSpan = document.createElement('span');
              nameSpan.innerHTML = '📁 ' + escapeHtml(d.name);
              nameSpan.style.overflow = 'hidden';
              nameSpan.style.textOverflow = 'ellipsis';
              nameSpan.style.whiteSpace = 'nowrap';
              row.appendChild(nameSpan);

              const openBtn = document.createElement('button');
              openBtn.type = 'button';
              openBtn.className = 'btn';
              openBtn.style.fontSize = '10px';
              openBtn.style.padding = '2px 6px';
              openBtn.textContent = 'Open →';
              openBtn.onclick = (e) => {
                e.stopPropagation();
                navigateDirPicker(d.path);
              };
              row.appendChild(openBtn);

              row.onclick = () => navigateDirPicker(d.path);
              listEl.appendChild(row);
            });
          }
        }
      } catch (err) {
        if (listEl) listEl.innerHTML = '<div style="color:var(--red); text-align:center; padding:16px; font-size:12px;">Failed to read folder: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function dirPickerGoUp() {
      if (dirPickerParentPath) {
        navigateDirPicker(dirPickerParentPath);
      }
    }

    function refreshDirPicker() {
      navigateDirPicker(dirPickerCurrentPath);
    }

    function dirPickerAppendSubfolder() {
      const nameInp = document.getElementById('dirpicker-newfolder-name');
      const subName = nameInp ? nameInp.value.trim() : '';
      if (!subName) return;
      const sep = dirPickerCurrentPath.indexOf('/') >= 0 ? '/' : String.fromCharCode(92);
      const full = dirPickerCurrentPath.endsWith(sep) ? dirPickerCurrentPath + subName : dirPickerCurrentPath + sep + subName;
      const targetInput = document.getElementById(dirPickerTargetInputId);
      if (targetInput) targetInput.value = full;
      if (nameInp) nameInp.value = '';
      closeDirPicker();
    }

    function confirmDirPicker() {
      const targetInput = document.getElementById(dirPickerTargetInputId);
      if (targetInput && dirPickerCurrentPath) {
        targetInput.value = dirPickerCurrentPath;
      }
      closeDirPicker();
    }

    function switchModalWorkspaceTab(tab) {
      currentWorkspaceModalTab = tab;
      const btnEx = document.getElementById('modal-ws-tab-existing');
      const btnCr = document.getElementById('modal-ws-tab-create');
      const paneEx = document.getElementById('modal-ws-existing-pane');
      const paneCr = document.getElementById('modal-ws-create-pane');
      const btnSubmit = document.getElementById('btn-submit-workspace');
      const err = document.getElementById('workspace-error-msg');
      if (err) { err.style.display = 'none'; err.textContent = ''; }

      if (tab === 'existing') {
        if (btnEx) btnEx.classList.add('btn-primary');
        if (btnCr) btnCr.classList.remove('btn-primary');
        if (paneEx) paneEx.style.display = 'block';
        if (paneCr) paneCr.style.display = 'none';
        if (btnSubmit) btnSubmit.textContent = '✓ Switch Project';
        const inp = document.getElementById('workspace-path-input');
        if (inp) setTimeout(() => inp.focus(), 50);
      } else {
        if (btnEx) btnEx.classList.remove('btn-primary');
        if (btnCr) btnCr.classList.add('btn-primary');
        if (paneEx) paneEx.style.display = 'none';
        if (paneCr) paneCr.style.display = 'block';
        if (btnSubmit) btnSubmit.textContent = '✨ Create & Open Project';
        const inp = document.getElementById('workspace-create-input');
        if (inp) setTimeout(() => inp.focus(), 50);
      }
    }

    function switchSetupWorkspaceTab(tab) {
      currentSetupWorkspaceTab = tab;
      const btnEx = document.getElementById('setup-tab-existing');
      const btnCr = document.getElementById('setup-tab-create');
      const paneEx = document.getElementById('setup-ws-existing-pane');
      const paneCr = document.getElementById('setup-ws-create-pane');
      const msg = document.getElementById('setup-workspace-msg');
      if (msg) { msg.style.display = 'none'; msg.textContent = ''; }

      if (tab === 'existing') {
        if (btnEx) btnEx.classList.add('btn-primary');
        if (btnCr) btnCr.classList.remove('btn-primary');
        if (paneEx) paneEx.style.display = 'block';
        if (paneCr) paneCr.style.display = 'none';
        const inp = document.getElementById('setup-workspace-input');
        if (inp) setTimeout(() => inp.focus(), 50);
      } else {
        if (btnEx) btnEx.classList.remove('btn-primary');
        if (btnCr) btnCr.classList.add('btn-primary');
        if (paneEx) paneEx.style.display = 'none';
        if (paneCr) paneCr.style.display = 'block';
        const inp = document.getElementById('setup-workspace-create-input');
        if (inp) setTimeout(() => inp.focus(), 50);
      }
    }

    function openWorkspaceModal() {
      const modal = document.getElementById('workspace-modal');
      const cur = document.getElementById('current-workspace-display');
      const err = document.getElementById('workspace-error-msg');
      if (cur) cur.textContent = currentWorkspaceRoot || 'Detecting...';
      if (err) { err.style.display = 'none'; err.textContent = ''; }
      const inpEx = document.getElementById('workspace-path-input');
      const inpCr = document.getElementById('workspace-create-input');
      if (inpEx) inpEx.value = '';
      if (inpCr) inpCr.value = '';
      switchModalWorkspaceTab('existing');
      if (modal) modal.classList.add('open');
    }

    function closeWorkspaceModal() {
      const modal = document.getElementById('workspace-modal');
      if (modal) modal.classList.remove('open');
    }

    async function submitChangeWorkspace() {
      const isCreate = currentWorkspaceModalTab === 'create';
      const inp = isCreate
        ? document.getElementById('workspace-create-input')
        : document.getElementById('workspace-path-input');
      const err = document.getElementById('workspace-error-msg');
      const p = inp ? inp.value.trim() : '';
      if (!p) {
        if (err) {
          err.textContent = isCreate ? 'Please enter a path for the new project.' : 'Please enter a directory path.';
          err.style.display = 'block';
        }
        return;
      }
      try {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p, create: isCreate }),
        });
        const data = await res.json();
        if (res.ok && data.root) {
          currentWorkspaceRoot = data.root;
          closeWorkspaceModal();
          await refreshFiles();
          if (activeRightTab === 'graph') loadGraph();
        } else {
          if (err) { err.textContent = data.error || 'Failed to switch workspace.'; err.style.display = 'block'; }
        }
      } catch (e) {
        if (err) { err.textContent = 'Error: ' + e.message; err.style.display = 'block'; }
      }
    }

    async function refreshFiles() {
      try {
        const res = await fetch('/api/files');
        if (res.ok) {
          const data = await res.json();
          workspaceFiles = data.files || [];
          if (data.root) {
            currentWorkspaceRoot = data.root;
            const rootLabel = document.getElementById('explorer-root-label');
            const parts = data.root.split(/[\\\\/]/);
            const base = parts[parts.length - 1] || data.root;
            if (rootLabel) {
              rootLabel.textContent = '📂 ' + base;
              rootLabel.title = data.root;
            }
            const statusWs = document.getElementById('status-workspace');
            if (statusWs) {
              statusWs.textContent = 'Workspace: ' + base;
              statusWs.title = data.root;
            }
          }
          renderFileTree(workspaceFiles);
        }
      } catch (err) {
        console.error('Failed to load files:', err);
      }
    }

    function renderFileTree(files) {
      const container = document.getElementById('file-tree-list');
      container.innerHTML = '';
      if (files.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim); padding:8px;">No files found.</div>';
        return;
      }
      files.forEach(f => {
        const item = document.createElement('div');
        item.className = 'tree-node' + (currentSelectedPath === f.path ? ' selected' : '');
        const isModified = modifiedFiles.includes(f.path);
        const icon = f.isDir ? '📁' : isModified ? '📝' : '📄';
        const modBadge = isModified ? ' <span style="color:var(--green); font-size:10px;">[modified]</span>' : '';
        item.innerHTML = \`<span>\${icon} \${escapeHtml(f.path)}\${modBadge}</span>\`;
        if (!f.isDir) {
          item.onclick = () => openFile(f.path);
        }
        container.appendChild(item);
      });
    }

    function filterFiles(query) {
      if (!query) {
        renderFileTree(workspaceFiles);
        return;
      }
      const q = query.toLowerCase();
      const filtered = workspaceFiles.filter(f => f.path.toLowerCase().includes(q));
      renderFileTree(filtered);
    }

    async function openFile(filePath) {
      currentSelectedPath = filePath;
      renderFileTree(workspaceFiles);
      switchRightTab('viewer');
      document.getElementById('current-view-file').textContent = filePath;
      const contentEl = document.getElementById('viewer-content');
      contentEl.textContent = 'Loading file...';
      try {
        const res = await fetch('/api/file?path=' + encodeURIComponent(filePath));
        if (res.ok) {
          const text = await res.text();
          contentEl.textContent = text;
        } else {
          contentEl.textContent = 'Error loading file.';
        }
      } catch (err) {
        contentEl.textContent = 'Error loading file: ' + err.message;
      }
    }

    async function loadDiffs() {
      const diffContent = document.getElementById('diff-content');
      try {
        const res = await fetch('/api/diffs');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const diffs = data.diffs || [];
        document.getElementById('diff-count').textContent = diffs.length;
        document.getElementById('diff-file-title').textContent = diffs.length > 0
          ? 'Modified Files (' + diffs.length + ')'
          : 'No Modified Files';

        if (diffs.length === 0) {
          diffContent.innerHTML = '<div style="color:var(--text-dim); padding:16px;">No files modified in current session yet.<br>Edits made by autonomous tools (<code>write_file</code>, <code>edit_file</code>, <code>apply_patch</code>) will show real-time diffs here.</div>';
          return;
        }

        diffContent.innerHTML = '';
        diffs.forEach((d) => {
          const card = document.createElement('div');
          card.style.cssText = 'border:1px solid var(--border); border-radius:6px; margin-bottom:16px; overflow:hidden; background:#0d1117;';

          const actionColor = d.action === 'created' ? 'var(--green)' : d.action === 'deleted' ? 'var(--red)' : 'var(--accent)';
          const header = document.createElement('div');
          header.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#161b22; border-bottom:1px solid var(--border);';
          const titleDiv = document.createElement('div');
          titleDiv.innerHTML = '<strong style="color:var(--text)">📄 ' + escapeHtml(d.rel) + '</strong> <span style="font-size:10px; padding:1px 6px; border-radius:3px; font-weight:bold; background:#1f6feb33; color:' + actionColor + '; text-transform:uppercase;">' + escapeHtml(d.action) + '</span>';
          header.appendChild(titleDiv);
          const openBtn = document.createElement('button');
          openBtn.className = 'btn';
          openBtn.style.cssText = 'padding:2px 8px; font-size:11px;';
          openBtn.textContent = 'View Full File';
          openBtn.onclick = () => openFile(d.rel);
          header.appendChild(openBtn);
          card.appendChild(header);

          const pre = document.createElement('pre');
          pre.style.cssText = 'margin:0; padding:8px 0; font-family:Consolas, monospace; font-size:11.5px; line-height:1.45; overflow-x:auto; background:#0d1117;';

          if (d.skipped) {
            // Oversized edit — the server skips the O(N·M) patch computation so
            // the request can't block. Point the user at the file viewer instead.
            const row = document.createElement('div');
            row.style.cssText = 'padding:8px 12px; color:var(--yellow);';
            row.textContent = 'File too large to diff — use the File Viewer to review changes.';
            pre.appendChild(row);
          } else {
            const lines = (d.patch || '').split(String.fromCharCode(10)).map(l => l.replace(String.fromCharCode(13), ''));
            lines.forEach((line) => {
              const row = document.createElement('div');
              row.style.cssText = 'padding:1px 12px; white-space:pre;';
              if (line.startsWith('+++') || line.startsWith('---')) {
                row.style.color = 'var(--text-dim)';
                row.style.fontWeight = 'bold';
              } else if (line.startsWith('+')) {
                row.style.background = 'var(--diff-add)';
                row.style.color = 'var(--diff-add-text)';
              } else if (line.startsWith('-')) {
                row.style.background = 'var(--diff-del)';
                row.style.color = 'var(--diff-del-text)';
              } else if (line.startsWith('@@')) {
                row.style.color = 'var(--accent)';
                row.style.background = '#1f6feb15';
                row.style.fontWeight = '600';
              } else {
                row.style.color = 'var(--text-dim)';
              }
              row.textContent = line;
              pre.appendChild(row);
            });
          }

          card.appendChild(pre);
          diffContent.appendChild(card);
        });
      } catch (err) {
        diffContent.innerHTML = '<div style="color:var(--red); padding:16px;">Failed to load diffs: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function renderDiffSummary(files) {
      loadDiffs();
    }

    async function triggerUndo() {
      try {
        const res = await fetch('/api/undo', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          if (data.result) {
            sendAgentCmd('/undo');
            refreshFiles();
          }
        }
      } catch (e) {
        console.error('Undo failed:', e);
      }
    }

    function copyViewerContent() {
      const text = document.getElementById('viewer-content').textContent;
      navigator.clipboard.writeText(text);
    }

    // CodeGraph Logic
    async function loadGraph() {
      try {
        const res = await fetch('/api/graph');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('g-files').textContent = data.stats.files;
          document.getElementById('g-symbols').textContent = data.stats.symbols;
          document.getElementById('g-imports').textContent = data.stats.importEdges;
          document.getElementById('g-calls').textContent = data.stats.callEdges;
          renderGraphSymbols(data.symbols);
        }
      } catch (err) {
        console.error('Failed to load graph:', err);
      }
    }

    function renderGraphSymbols(symbols) {
      const container = document.getElementById('graph-symbols-list');
      container.innerHTML = '';
      if (!symbols || symbols.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim); padding:8px;">No symbols found in graph.</div>';
        return;
      }
      symbols.slice(0, 40).forEach(sym => {
        const card = document.createElement('div');
        card.className = 'symbol-card';
        card.innerHTML = \`
          <div class="symbol-header">
            <span class="symbol-kind">\${escapeHtml(sym.kind)}</span>
            <button class="btn btn-inject-sym" style="padding:1px 6px; font-size:10px;">Inject in Chat ⚡</button>
          </div>
          <div class="symbol-sig" title="\${escapeHtml(sym.signature)}">\${escapeHtml(sym.signature)}</div>
          <div class="symbol-loc">📄 \${escapeHtml(sym.file)}:line \${Number(sym.line) || 1}</div>
        \`;
        const btn = card.querySelector('.btn-inject-sym');
        if (btn) {
          btn.addEventListener('click', () => injectSymbolContext(sym.name));
        }
        container.appendChild(card);
      });
    }

    async function searchGraph(query) {
      if (!query) {
        loadGraph();
        return;
      }
      try {
        const res = await fetch('/api/graph/query?q=' + encodeURIComponent(query));
        if (res.ok) {
          const data = await res.json();
          const symbols = data.results.map(r => r.symbol);
          renderGraphSymbols(symbols);
        }
      } catch (err) {
        console.error('Graph search failed:', err);
      }
    }

    function injectSymbolContext(symName) {
      sendAgentCmd('/graph ' + symName);
      switchLeftTab('agent');
    }

    // Model Modal & Selector with Local vs Cloud separation
    async function openModelModal() {
      document.getElementById('model-modal').classList.add('open');
      document.getElementById('model-search').value = '';
      await loadModels();
      setTimeout(() => document.getElementById('model-search').focus(), 50);
    }
    function closeModelModal() {
      document.getElementById('model-modal').classList.remove('open');
    }

    function switchModelModalTab(tab) {
      activeModelTab = tab;
      document.getElementById('mtab-local').classList.toggle('active', tab === 'local');
      document.getElementById('mtab-cloud').classList.toggle('active', tab === 'cloud');
      document.getElementById('mtab-all').classList.toggle('active', tab === 'all');
      filterModels(document.getElementById('model-search').value);
    }

    async function loadModels() {
      try {
        const res = await fetch('/api/models');
        if (res.ok) {
          const data = await res.json();
          availableLocalModels = data.localModels || [];
          availableCloudModels = data.cloudModels || [];
          allAvailableModels = data.models || [];
          document.getElementById('local-count').textContent = availableLocalModels.length;
          document.getElementById('cloud-count').textContent = availableCloudModels.length;
          const allCountEl = document.getElementById('all-count');
          if (allCountEl) allCountEl.textContent = allAvailableModels.length;

          if (data.activeModel) {
            activeModelId = data.activeModel;
            document.getElementById('header-active-model').textContent = activeModelId;
            const subEl = document.getElementById('sub-active-model');
            if (subEl) subEl.textContent = activeModelId;
            const statusModelEl = document.getElementById('status-model');
            if (statusModelEl) statusModelEl.textContent = 'Model: ' + activeModelId;
          }

          // Default tab: if cloud models exist and active is cloud/openrouter, open cloud; else if local exists open local; else cloud
          const isLocalActive = ['ollama', 'lmstudio', 'local'].includes(data.activeProvider);
          if (activeModelTab === 'all') {
            switchModelModalTab('all');
          } else if (availableCloudModels.length > 0 && !isLocalActive) {
            switchModelModalTab('cloud');
          } else if (availableLocalModels.length > 0) {
            switchModelModalTab('local');
          } else {
            switchModelModalTab('cloud');
          }
        }
      } catch (err) {
        console.error('Failed to load models:', err);
      }
    }

    function renderModelCards(models) {
      const container = document.getElementById('model-list-container');
      container.innerHTML = '';
      if (models.length === 0) {
        const msg = activeModelTab === 'local'
          ? '<div style="color:var(--text-dim); text-align:center; padding:24px;">No running local LLM found (Ollama or LM Studio).<br><br><button class="btn btn-primary" onclick="openAccountModal()">Configure Local Port / URL ↗</button></div>'
          : activeModelTab === 'cloud'
            ? '<div style="color:var(--text-dim); text-align:center; padding:24px;">No configured cloud models found.<br><br><button class="btn btn-primary" onclick="openAccountModal()">Add API Key in Accounts ↗</button></div>'
            : '<div style="color:var(--text-dim); text-align:center; padding:24px;">No active local or cloud models found.<br><br><button class="btn btn-primary" onclick="openAccountModal()">Configure in Accounts & Keys ↗</button></div>';
        container.innerHTML = msg;
        return;
      }

      models.forEach(m => {
        const card = document.createElement('div');
        const isActive = m.id === activeModelId;
        card.className = 'modal-item-card' + (isActive ? ' active' : '');
        const toolsBadge = m.supportsTools ? '<span style="color:var(--accent); font-size:10px; font-weight:bold;">[Tools]</span>' : '';
        const thinkBadge = m.supportsThinking ? '<span style="color:var(--magenta); font-size:10px; font-weight:bold;">[Thinking]</span>' : '';
        const providerBadge = m.isLocal
          ? '<span style="color:var(--green); font-size:10px; font-weight:bold;">[Local · Free]</span>'
          : \`<span style="color:var(--text-dim); font-size:10px;">[\${escapeHtml(m.provider || 'cloud')}]</span>\`;
        const activeBadge = isActive ? '<span style="color:var(--green); font-weight:bold; font-size:11px;">● Active</span>' : '<button class="btn btn-primary" style="padding:2px 8px; font-size:10px;">Select</button>';
        
        card.onclick = () => selectModel(m.id, m.provider);
        card.innerHTML = \`
          <div>
            <div style="font-weight:600; font-size:13px; color:var(--text);">\${escapeHtml(m.id)}</div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">
              \${providerBadge} · Tier: <span style="text-transform:capitalize;">\${escapeHtml(m.tier || 'standard')}</span> · \${toolsBadge} \${thinkBadge}
            </div>
          </div>
          <div>\${activeBadge}</div>
        \`;
        container.appendChild(card);
      });
    }

    function filterModels(query) {
      const q = (query || '').toLowerCase();
      let sourceList = allAvailableModels;
      if (activeModelTab === 'local') sourceList = availableLocalModels;
      else if (activeModelTab === 'cloud') sourceList = availableCloudModels;

      const filtered = sourceList.filter(m => m.id.toLowerCase().includes(q) || (m.provider && m.provider.toLowerCase().includes(q)));
      renderModelCards(filtered);
    }

    async function selectModel(modelId, provider) {
      try {
        await fetch('/api/model', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: modelId, provider })
        });
        activeModelId = modelId;
        document.getElementById('header-active-model').textContent = modelId;
        const subEl = document.getElementById('sub-active-model');
        if (subEl) subEl.textContent = modelId;
        document.getElementById('status-model').textContent = 'Model: ' + modelId;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'set_model', model: modelId, provider }));
        }
        closeModelModal();
      } catch (err) {
        console.error('Failed to select model:', err);
      }
    }

    // Account & Keys Modal
    async function openAccountModal() {
      closeModelModal();
      document.getElementById('account-modal').classList.add('open');
      const container = document.getElementById('provider-list-container');
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">Loading provider accounts...</div>';
      try {
        const res = await fetch('/api/keys');
        if (res.ok) {
          const data = await res.json();
          renderProviders(data.providers);
        }
      } catch (err) {
        container.innerHTML = '<div style="color:var(--red); padding:12px;">Failed to load accounts.</div>';
      }
    }
    function closeAccountModal() {
      document.getElementById('account-modal').classList.remove('open');
    }

    function renderProviders(providers) {
      const container = document.getElementById('provider-list-container');
      container.innerHTML = '';
      providers.forEach(p => {
        const row = document.createElement('div');
        row.className = 'provider-row';
        const isConn = p.isConfigured;
        const statusPill = isConn
          ? \`<span style="color:var(--green); font-size:11px; font-weight:600;">🟢 Connected (\${escapeHtml(p.maskedKey || p.baseUrl)})</span>\`
          : \`<span style="color:var(--text-dim); font-size:11px;">⚪ Not Configured</span>\`;

        row.innerHTML = \`
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong style="font-size:13px;">\${escapeHtml(p.label)}</strong>
              <div style="font-size:11px; color:var(--text-dim); margin-top:2px;">\${statusPill}</div>
            </div>
            \${p.url && !p.custom ? \`<a href="\${p.url}" target="_blank" style="color:var(--accent); font-size:11px;">Get Key ↗</a>\` : ''}
          </div>
          <div style="display:flex; gap:8px; margin-top:6px;">
            <input type="\${p.custom ? 'text' : 'password'}" class="input-field" id="key-input-\${p.id}" placeholder="\${p.custom ? 'Base URL (e.g. ' + p.url + ')' : 'Enter ' + p.keyVar}" value="\${p.custom ? p.baseUrl : ''}" />
            <button class="btn btn-primary" onclick="saveProviderKey('\${p.id}', '\${p.keyVar}', '\${p.baseVar || ''}', \${Boolean(p.custom)})">Save</button>
          </div>
        \`;
        container.appendChild(row);
      });
    }

    async function saveProviderKey(providerId, keyVar, baseVar, isCustom) {
      const inputVal = document.getElementById('key-input-' + providerId).value.trim();
      if (!inputVal) return;
      try {
        const payload = isCustom
          ? { provider: providerId, baseVar: keyVar, baseUrl: inputVal }
          : { provider: providerId, keyVar, value: inputVal };
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          alert('Saved successfully!');
          openAccountModal();
          loadModels();
        }
      } catch (err) {
        alert('Failed to save key: ' + err.message);
      }
    }

    function escapeHtml(str) {
      return (str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    // Token-Saving Modules & Superpowers Modal
    async function openModulesModal() {
      document.getElementById('modules-modal').classList.add('open');
      await Promise.all([loadModules(), loadConfigLimits()]);
    }
    function closeModulesModal() {
      document.getElementById('modules-modal').classList.remove('open');
    }

    async function loadConfigLimits() {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const cfg = await res.json();
          if (cfg.historyBudget) {
            configuredHistoryBudget = cfg.historyBudget;
            const el = document.getElementById('cfg-history-budget');
            if (el) el.value = cfg.historyBudget;
            const setupEl = document.getElementById('setup-history-budget');
            if (setupEl) setupEl.value = cfg.historyBudget;
          }
          if (cfg.maxTurns) {
            const el = document.getElementById('cfg-max-turns');
            if (el) el.value = cfg.maxTurns;
          }
          if (cfg.maxOutputTokens) {
            configuredMaxOutputTokens = cfg.maxOutputTokens;
            const el = document.getElementById('cfg-max-output');
            if (el) el.value = cfg.maxOutputTokens;
            const setupEl = document.getElementById('setup-max-output');
            if (setupEl) setupEl.value = cfg.maxOutputTokens;
          }
          if (cfg.maxToolIterations) {
            configuredMaxToolIters = cfg.maxToolIterations;
            const el = document.getElementById('cfg-max-tool-iters');
            if (el) el.value = cfg.maxToolIterations;
            const setupEl = document.getElementById('setup-max-tool-iters');
            if (setupEl) setupEl.value = cfg.maxToolIterations;
            const sliderEl = document.getElementById('slider-max-tool-iters');
            if (sliderEl) sliderEl.value = cfg.maxToolIterations;
          }
          if (cfg.turboMode !== undefined) {
            updateTurboUI(cfg.turboMode);
          }
          if (cfg.webfetchEnabled !== undefined) {
            const wfCb = document.getElementById('setup-webfetch-checkbox');
            if (wfCb) wfCb.checked = Boolean(cfg.webfetchEnabled);
          }
        }
      } catch (e) {}
    }

    async function saveConfigLimits() {
      const budget = Number(document.getElementById('cfg-history-budget').value);
      const turns = Number(document.getElementById('cfg-max-turns').value);
      const maxOutput = Number(document.getElementById('cfg-max-output').value);
      const maxToolIters = Number(document.getElementById('cfg-max-tool-iters')?.value || 20);
      try {
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ historyBudget: budget, maxTurns: turns, maxOutputTokens: maxOutput, maxToolIterations: maxToolIters }),
        });
        if (res.ok) {
          configuredHistoryBudget = budget;
          configuredMaxOutputTokens = maxOutput;
          configuredMaxToolIters = maxToolIters;
          const status = document.getElementById('cfg-save-status');
          if (status) {
            status.style.display = 'inline';
            setTimeout(() => { status.style.display = 'none'; }, 2000);
          }
        }
      } catch (e) {
        alert('Failed to save config limits');
      }
    }

    function syncInputFromSlider(field) {
      const slider = document.getElementById('slider-' + field);
      const input = document.getElementById('setup-' + field);
      if (slider && input) {
        input.value = slider.value;
      }
      updateActivePresetButton();
      updateCostEstimate();
      checkModelThinkingSupport(chosenId);
    }

    function syncSliderFromInput(field) {
      const slider = document.getElementById('slider-' + field);
      const input = document.getElementById('setup-' + field);
      if (slider && input) {
        slider.value = input.value;
      }
      updateActivePresetButton();
      updateCostEstimate();
    }

    function highlightPresetButton(preset) {
      ['light', 'deep', 'big'].forEach((p) => {
        const btn = document.getElementById('preset-btn-' + p);
        if (btn) {
          if (p === preset) {
            btn.classList.add('btn-primary');
          } else {
            btn.classList.remove('btn-primary');
          }
        }
      });
    }

    function updateActivePresetButton() {
      const b = Number(document.getElementById('setup-history-budget')?.value);
      const o = Number(document.getElementById('setup-max-output')?.value);
      const i = Number(document.getElementById('setup-max-tool-iters')?.value);
      const t = Number(document.getElementById('setup-max-turns')?.value);
      if (b === 8000 && o === 4096 && i === 10 && t === 20) {
        highlightPresetButton('light');
      } else if (b === 24000 && o === 8192 && i === 25 && t === 50) {
        highlightPresetButton('deep');
      } else if (b === 64000 && o === 16384 && i === 50 && t === 100) {
        highlightPresetButton('big');
      } else {
        highlightPresetButton(null);
      }
    }

    function applyWorkloadPreset(preset) {
      let budget = 16000, output = 8192, iters = 20, turns = 50;
      if (preset === 'light') {
        budget = 8000; output = 4096; iters = 10; turns = 20;
      } else if (preset === 'deep') {
        budget = 24000; output = 8192; iters = 25; turns = 50;
      } else if (preset === 'big') {
        budget = 64000; output = 16384; iters = 50; turns = 100;
      }
      const setField = (name, val) => {
        const inp = document.getElementById('setup-' + name);
        if (inp) inp.value = val;
        const sld = document.getElementById('slider-' + name);
        if (sld) sld.value = val;
      };
      setField('history-budget', budget);
      setField('max-output', output);
      setField('max-tool-iters', iters);
      setField('max-turns', turns);
      highlightPresetButton(preset);
      updateCostEstimate();
    }

    function openSessionSetupModal() {
      populateSetupModels();
      const setField = (name, val) => {
        const inp = document.getElementById('setup-' + name);
        if (inp) inp.value = val;
        const sld = document.getElementById('slider-' + name);
        if (sld) sld.value = val;
      };
      setField('history-budget', configuredHistoryBudget);
      setField('max-output', configuredMaxOutputTokens);
      setField('max-tool-iters', configuredMaxToolIters);
      const maxTurnsEl = document.getElementById('cfg-max-turns');
      setField('max-turns', maxTurnsEl ? Number(maxTurnsEl.value) || 50 : 50);

      const wsBadge = document.getElementById('setup-workspace-current-badge');
      if (wsBadge) wsBadge.textContent = currentWorkspaceRoot || '.';
      const wsInp = document.getElementById('setup-workspace-input');
      if (wsInp) wsInp.value = currentWorkspaceRoot || '';
      const wsCrInp = document.getElementById('setup-workspace-create-input');
      if (wsCrInp) wsCrInp.value = '';
      switchSetupWorkspaceTab('existing');
      const wsMsg = document.getElementById('setup-workspace-msg');
      if (wsMsg) { wsMsg.style.display = 'none'; wsMsg.textContent = ''; }

      const turboCb = document.getElementById('setup-turbo-checkbox');
      if (turboCb) turboCb.checked = currentTurboMode;
      onTurboCheckboxChange();
      updateActivePresetButton();
      updateCostEstimate();
      document.getElementById('session-setup-modal').classList.add('open');
    }

    async function applySetupWorkspaceFolder(isCreate = false) {
      const inp = isCreate
        ? document.getElementById('setup-workspace-create-input')
        : document.getElementById('setup-workspace-input');
      const msg = document.getElementById('setup-workspace-msg');
      const p = inp ? inp.value.trim() : '';
      if (!p) {
        if (msg) {
          msg.style.color = 'var(--red)';
          msg.textContent = isCreate ? '⚠ Please enter a path for the new project.' : '⚠ Please enter a folder path.';
          msg.style.display = 'block';
        }
        return;
      }
      try {
        const res = await fetch('/api/workspace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: p, create: isCreate }),
        });
        const data = await res.json();
        if (res.ok && data.root) {
          currentWorkspaceRoot = data.root;
          const wsBadge = document.getElementById('setup-workspace-current-badge');
          if (wsBadge) wsBadge.textContent = data.root;
          if (msg) {
            msg.style.color = 'var(--green)';
            msg.textContent = (data.created ? '✓ Created & opened new project: ' : '✓ Workspace updated to: ') + data.root;
            msg.style.display = 'block';
          }
          await refreshFiles();
        } else {
          if (msg) {
            msg.style.color = 'var(--red)';
            msg.textContent = '⚠ ' + (data.error || 'Failed to switch folder');
            msg.style.display = 'block';
          }
        }
      } catch (e) {
        if (msg) {
          msg.style.color = 'var(--red)';
          msg.textContent = '⚠ ' + e.message;
          msg.style.display = 'block';
        }
      }
    }

    function closeSessionSetupModal() {
      document.getElementById('session-setup-modal').classList.remove('open');
    }

    function populateSetupModels() {
      const select = document.getElementById('setup-model-select');
      if (!select) return;
      select.innerHTML = '';
      const list = (allAvailableModels && allAvailableModels.length > 0) ? allAvailableModels : [
        { id: activeModelId || 'openrouter/auto', provider: 'openrouter', costPerMTokIn: 0, costPerMTokOut: 0, contextWindow: 128000 }
      ];
      list.forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m.id;
        const providerName = m.providerLabel || m.provider || (m.isLocal ? 'Local' : 'Cloud');
        const costStr = m.isLocal
          ? 'Free · $0.00'
          : (m.costPerMTokIn || m.costPerMTokOut)
            ? '$' + m.costPerMTokIn.toFixed(2) + ' in / $' + m.costPerMTokOut.toFixed(2) + ' out'
            : 'Catalog default';
        opt.textContent = '[' + providerName + '] ' + m.id + ' (' + costStr + ')';
        if (m.id === activeModelId) opt.selected = true;
        select.appendChild(opt);
      });
      onSetupModelChange();
    }

    function onSetupModelChange() {
      const select = document.getElementById('setup-model-select');
      if (!select) return;
      const chosenId = select.value;
      const m = (allAvailableModels || []).find((x) => x.id === chosenId);
      const provEl = document.getElementById('setup-model-provider');
      const ctxEl = document.getElementById('setup-model-context');
      const priceEl = document.getElementById('setup-model-pricing');
      if (m) {
        if (provEl) provEl.textContent = 'Provider: ' + (m.providerLabel || m.provider || (m.isLocal ? 'Local' : 'Cloud'));
        if (ctxEl) ctxEl.textContent = 'Context: ' + ((m.contextWindow || 128000) / 1000).toFixed(0) + 'k tokens';
        if (priceEl) {
          priceEl.textContent = m.isLocal
            ? 'Free · Local model'
            : (m.costPerMTokIn || m.costPerMTokOut)
              ? '$' + m.costPerMTokIn.toFixed(2) + ' in / $' + m.costPerMTokOut.toFixed(2) + ' out per 1M'
              : 'Standard catalog pricing';
        }
      }
      updateCostEstimate();
    }

    function onTurboCheckboxChange() {
      const cb = document.getElementById('setup-turbo-checkbox');
      const caution = document.getElementById('setup-turbo-caution');
      if (caution) {
        caution.style.display = (cb && cb.checked) ? 'block' : 'none';
      }
    }

    function updateCostEstimate() {
      const select = document.getElementById('setup-model-select');
      const chosenId = select ? select.value : activeModelId;
      const m = (allAvailableModels || []).find((x) => x.id === chosenId);
      const budgetInput = document.getElementById('setup-history-budget');
      const maxOutputInput = document.getElementById('setup-max-output');
      const historyBudget = Number(budgetInput ? budgetInput.value : 16000) || 16000;
      const maxOutput = Number(maxOutputInput ? maxOutputInput.value : 8192) || 8192;

      const costIn = (m && typeof m.costPerMTokIn === 'number') ? m.costPerMTokIn : 0;
      const costOut = (m && typeof m.costPerMTokOut === 'number') ? m.costPerMTokOut : 0;
      const isLocal = m ? Boolean(m.isLocal) : false;

      const costEl = document.getElementById('setup-estimated-cost');
      const detailEl = document.getElementById('setup-pricing-detail');

      if (isLocal || (costIn === 0 && costOut === 0)) {
        if (costEl) costEl.textContent = 'Free ($0.00)';
        if (detailEl) detailEl.textContent = 'Local LLM / free provider (zero API token cost)';
      } else {
        const turnCost = ((historyBudget * costIn) + (maxOutput * costOut)) / 1000000;
        if (costEl) costEl.textContent = '~$' + turnCost.toFixed(4);
        if (detailEl) {
          detailEl.textContent = 'Rate: $' + costIn.toFixed(2) + ' / 1M in · $' + costOut.toFixed(2) + ' / 1M out (at ' + Math.round(historyBudget/1000) + 'k in + ' + Math.round(maxOutput/1000) + 'k out)';
        }
      }
    }

    function updateTurboUI(enabled) {
      currentTurboMode = Boolean(enabled);
      const btn = document.getElementById('turbo-toggle');
      const label = document.getElementById('turbo-label');
      if (btn && label) {
        if (currentTurboMode) {
          btn.style.borderColor = 'var(--yellow)';
          btn.style.color = 'var(--yellow)';
          label.textContent = 'Turbo: ON';
        } else {
          btn.style.borderColor = '';
          btn.style.color = '';
          label.textContent = 'Turbo: Off';
        }
      }
      const setupCb = document.getElementById('setup-turbo-checkbox');
      if (setupCb && setupCb.checked !== currentTurboMode) {
        setupCb.checked = currentTurboMode;
        onTurboCheckboxChange();
      }
    }

    function toggleTurboMode() {
      const next = !currentTurboMode;
      updateTurboUI(next);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_turbo_mode', enabled: next }));
      }
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turboMode: next }),
      }).catch(() => {});
    }

    async function applySessionSetup() {
      const select = document.getElementById('setup-model-select');
      const chosenModel = select ? select.value : activeModelId;
      const budget = Number(document.getElementById('setup-history-budget').value) || 16000;
      const maxOutput = Number(document.getElementById('setup-max-output').value) || 8192;
      const maxToolIters = Number(document.getElementById('setup-max-tool-iters')?.value || 20);
      const maxTurns = Number(document.getElementById('setup-max-turns')?.value || 50);
      const webfetchVal = Boolean(document.getElementById('setup-webfetch-checkbox')?.checked);
      const turboVal = Boolean(document.getElementById('setup-turbo-checkbox').checked);

      // 1. Update workspace if user filled a folder path
      const isCreate = currentSetupWorkspaceTab === 'create';
      const wsInputEl = isCreate
        ? document.getElementById('setup-workspace-create-input')
        : document.getElementById('setup-workspace-input');
      const wsTarget = wsInputEl ? wsInputEl.value.trim() : '';
      if (wsTarget && wsTarget !== currentWorkspaceRoot) {
        await applySetupWorkspaceFolder(isCreate);
      }

      // 2. Update model if changed
      if (chosenModel && chosenModel !== activeModelId) {
        const m = (allAvailableModels || []).find((x) => x.id === chosenModel);
        await selectModel(chosenModel, m ? m.provider : undefined);
      }

      // 2. Save config limits
      configuredHistoryBudget = budget;
      configuredMaxOutputTokens = maxOutput;
      configuredMaxToolIters = maxToolIters;
      const bEl = document.getElementById('cfg-history-budget');
      if (bEl) bEl.value = budget;
      const oEl = document.getElementById('cfg-max-output');
      if (oEl) oEl.value = maxOutput;
      const tEl = document.getElementById('cfg-max-tool-iters');
      if (tEl) tEl.value = maxToolIters;
      const trnEl = document.getElementById('cfg-max-turns');
      if (trnEl) trnEl.value = maxTurns;

      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          historyBudget: budget,
          maxOutputTokens: maxOutput,
          maxToolIterations: maxToolIters,
          maxTurns: maxTurns,
          webfetchEnabled: webfetchVal,
          turboMode: turboVal,
          thinkingLevel: currentThinkingLevel,
        }),
      });

      // 3. Update turbo mode
      if (turboVal !== currentTurboMode) {
        toggleTurboMode();
      }

      sessionStorage.setItem('mugil_session_configured', '1');
      closeSessionSetupModal();
      const chatInput = document.getElementById('chat-input');
      if (chatInput) chatInput.focus();
    }

    async function loadModules() {
      const container = document.getElementById('modules-list-container');
      container.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:20px;">Scanning module status and updates...</div>';
      try {
        const res = await fetch('/api/modules');
        if (res.ok) {
          const data = await res.json();
          renderModules(data.modules, data.checkResult);
        } else {
          container.innerHTML = '<div style="color:var(--red); padding:12px;">Failed to load modules.</div>';
        }
      } catch (err) {
        container.innerHTML = '<div style="color:var(--red); padding:12px;">Error: ' + escapeHtml(err.message) + '</div>';
      }
    }

    function renderModules(modules, checkResult) {
      const container = document.getElementById('modules-list-container');
      container.innerHTML = '';
      if (!modules || modules.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim); padding:16px; text-align:center;">No modules loaded.</div>';
        return;
      }

      modules.forEach(m => {
        const card = document.createElement('div');
        card.className = 'modal-item-card';
        card.style.cursor = 'default';
        card.style.marginBottom = '8px';
        const isUpdatable = checkResult && checkResult.updates && checkResult.updates.some(u => u.id === m.id);

        card.innerHTML = \`
          <div style="flex:1;">
            <div style="display:flex; align-items:center; gap:8px;">
              <strong style="font-size:13px; color:var(--text);">\${escapeHtml(m.name)}</strong>
              <span style="color:var(--green); font-weight:bold; font-size:11px;">● \${escapeHtml(m.status)} (v\${escapeHtml(m.version)})</span>
              \${isUpdatable ? '<span style="color:var(--yellow); font-size:10px; font-weight:bold;">[Update Available]</span>' : ''}
            </div>
            <div style="font-size:11.5px; color:var(--cyan); margin-top:2px; font-weight:500;">
              \${escapeHtml(m.role)}
            </div>
            <div style="font-size:11px; color:var(--text-dim); margin-top:3px;">
              \${escapeHtml(m.savingsStrategy)}
            </div>
            <div style="font-size:10.5px; color:var(--text-dim); margin-top:4px;">
              Upstream Project: <a href="\${escapeHtml(m.url)}" target="_blank" style="color:var(--accent); text-decoration:underline;">\${escapeHtml(m.project)} ↗</a>
            </div>
          </div>
        \`;
        container.appendChild(card);
      });
    }

    async function triggerUpdateModules() {
      const btn = document.getElementById('btn-update-modules');
      btn.disabled = true;
      btn.textContent = 'Updating...';
      try {
        const res = await fetch('/api/modules/update', { method: 'POST' });
        if (res.ok) {
          const data = await res.json();
          alert(data.applied && data.applied.length > 0
            ? 'Updated ' + data.applied.length + ' module rules!'
            : 'All token-saving modules and rules are up to date.');
          await loadModules();
        } else {
          alert('Update check failed.');
        }
      } catch (err) {
        alert('Update error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = '🔄 Check & Update Rules';
      }
    }

    window.onload = async () => {
      initTerminals();
      connectWs();
      await loadModels();
      await loadConfigLimits();
      refreshFiles();
      if (!sessionStorage.getItem('mugil_session_configured')) {
        openSessionSetupModal();
      }
      const chatInput = document.getElementById('chat-input');
      if (chatInput) chatInput.focus();
    };
  </script>
</body>
</html>`;
}
