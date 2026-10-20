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
      <span class="metric-pill" id="session-spent" style="color:var(--green); border-color:#23863644;">Spent: $0.0000</span>

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
      <span id="status-spent" style="color:var(--green);">Spent: $0.0000</span>
      <span id="status-workspace">Workspace: Active</span>
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

        <!-- Workload Quick Presets -->
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:6px; display:block;">Suggested Workload Presets:</label>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="btn" onclick="applyWorkloadPreset('light')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="8k context, 4k output, 10 tools, 20 turns">💬 Light Convo</button>
            <button type="button" class="btn btn-primary" onclick="applyWorkloadPreset('deep')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="24k context, 8k output, 25 tools, 50 turns">🛠 Deep Development (Rec)</button>
            <button type="button" class="btn" onclick="applyWorkloadPreset('big')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="64k context, 16k output, 50 tools, 100 turns">🏗 Big Codebase & Audit</button>
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
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Plain English:</b> How much past conversation and project code the AI can remember at once.</div>
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
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Plain English:</b> Maximum length of a single AI reply or file written in one step.</div>
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
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Plain English:</b> Max actions (reading/writing files, shell commands) before pausing for your approval.</div>
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
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Plain English:</b> Number of conversational rounds kept before summarizing earlier turns.</div>
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

        <!-- Webfetch Online Access Toggle -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:600; font-size:13px; color:var(--text); user-select:none;">
            <input type="checkbox" id="setup-webfetch-checkbox" checked style="cursor:pointer;" />
            <span>🌐 Web Access (webfetch tool for live docs & web pages)</span>
          </label>
          <div style="font-size:10.5px; color:#58a6ff; margin-top:4px;">• <b>Plain English:</b> Allows the AI to fetch remote documentation, APIs, and web pages online.</div>
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

  <script>
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
      ws = new WebSocket(\`\${protocol}//\${location.host}/ws\`);

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
              const costText = 'Spent: $' + cost.toFixed(4);
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

    async function refreshFiles() {
      try {
        const res = await fetch('/api/files');
        if (res.ok) {
          const data = await res.json();
          workspaceFiles = data.files;
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
      updateCostEstimate();
    }

    function syncSliderFromInput(field) {
      const slider = document.getElementById('slider-' + field);
      const input = document.getElementById('setup-' + field);
      if (slider && input) {
        slider.value = input.value;
      }
      updateCostEstimate();
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

      const turboCb = document.getElementById('setup-turbo-checkbox');
      if (turboCb) turboCb.checked = currentTurboMode;
      onTurboCheckboxChange();
      updateCostEstimate();
      document.getElementById('session-setup-modal').classList.add('open');
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

      // 1. Update model if changed
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
