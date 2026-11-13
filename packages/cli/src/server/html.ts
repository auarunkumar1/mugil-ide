import { VERSION } from '@mugil-ide/core';

export function getWebUiHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mugil IDE v${VERSION} — Two-Paned Autonomous Terminal & IDE</title>
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
    /* Theme Palettes */
    [data-theme="nord"] {
      --bg: #2e3440;
      --panel-bg: #3b4252;
      --card-bg: #434c5e;
      --border: #4c566a;
      --text: #eceff4;
      --text-dim: #d8dee9;
      --accent: #88c0d0;
      --green: #a3be8c;
      --magenta: #b48ead;
      --yellow: #ebcb8b;
      --red: #bf616a;
      --diff-add: #a3be8c25;
      --diff-add-text: #a3be8c;
      --diff-del: #bf616a25;
      --diff-del-text: #bf616a;
    }
    [data-theme="oled"] {
      --bg: #000000;
      --panel-bg: #0a0a0a;
      --card-bg: #141414;
      --border: #262626;
      --text: #ffffff;
      --text-dim: #888888;
      --accent: #38bdf8;
      --green: #22c55e;
      --magenta: #c084fc;
      --yellow: #eab308;
      --red: #ef4444;
      --diff-add: #22c55e25;
      --diff-add-text: #4ade80;
      --diff-del: #ef444425;
      --diff-del-text: #f87171;
    }
    [data-theme="dracula"] {
      --bg: #282a36;
      --panel-bg: #21222c;
      --card-bg: #343746;
      --border: #44475a;
      --text: #f8f8f2;
      --text-dim: #6272a4;
      --accent: #bd93f9;
      --green: #50fa7b;
      --magenta: #ff79c6;
      --yellow: #f1fa8c;
      --red: #ff5555;
      --diff-add: #50fa7b25;
      --diff-add-text: #50fa7b;
      --diff-del: #ff555525;
      --diff-del-text: #ff5555;
    }
    [data-theme="cyberpunk"] {
      --bg: #0f051d;
      --panel-bg: #180936;
      --card-bg: #261447;
      --border: #441e7a;
      --text: #f3e8ff;
      --text-dim: #a78bfa;
      --accent: #ff007f;
      --green: #05ffa1;
      --magenta: #d946ef;
      --yellow: #facc15;
      --red: #ff3366;
      --diff-add: #05ffa125;
      --diff-add-text: #05ffa1;
      --diff-del: #ff336625;
      --diff-del-text: #ff3366;
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
    .version-badge {
      color: var(--text-dim);
      font-size: calc(10.5px * var(--font-scale));
      font-weight: 600;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      text-decoration: none;
      padding: 1px 5px;
      border-radius: 4px;
      border: 1px solid transparent;
      transition: color 0.2s, border-color 0.2s;
    }
    .version-badge:hover {
      color: var(--accent);
      border-color: var(--border);
    }
    .update-badge {
      display: none;
      align-items: center;
      color: #d29922;
      background: #d299221a;
      border: 1px solid #d2992266;
      font-size: calc(10px * var(--font-scale));
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 10px;
      text-decoration: none;
      white-space: nowrap;
    }
    .update-badge:hover {
      background: #d2992233;
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

    /* Split Two-Pane Layout & Resizer */
    #workspace {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }
    .pane {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      position: relative;
      min-width: 0;
      transition: flex 0.15s ease;
    }
    #left-pane {
      flex: 1.1;
      border-right: 1px solid var(--border);
    }
    #right-pane {
      flex: 0.9;
      background: var(--panel-bg);
    }
    #pane-resizer {
      width: 6px;
      margin-left: -3px;
      margin-right: -3px;
      background: transparent;
      cursor: col-resize;
      z-index: 25;
      position: relative;
      user-select: none;
      transition: background 0.15s ease;
    }
    #pane-resizer:hover, #pane-resizer.active {
      background: var(--accent);
    }

    /* Left Pane View Mode Toggle Bar (Modern View vs Raw Terminal) */
    .view-mode-toggle-bar {
      display: flex;
      background: color-mix(in srgb, var(--panel-bg) 80%, transparent);
      border-bottom: 1px solid var(--border);
      padding: 3px 8px;
      gap: 4px;
      align-items: center;
    }
    .view-toggle-btn {
      background: transparent;
      border: 1px solid transparent;
      color: var(--text-dim);
      font-size: calc(11px * var(--font-scale));
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      font-weight: 500;
      transition: all 0.15s;
    }
    .view-toggle-btn:hover {
      color: var(--text);
      background: color-mix(in srgb, var(--card-bg) 70%, transparent);
    }
    .view-toggle-btn.active {
      background: var(--card-bg);
      color: var(--accent);
      border-color: var(--border);
      font-weight: 600;
    }

    /* Modern Stream / Chat & Thinking Container */
    #modern-agent-view {
      position: absolute;
      top: 0; left: 0; right: 0; bottom: 0;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      padding: 8px 0;
      background: var(--bg);
    }
    #modern-agent-view.hidden-view {
      display: none !important;
    }
    .thinking-container {
      margin: 6px 12px;
      background: color-mix(in srgb, var(--card-bg) 60%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
      border-radius: 8px;
      overflow: hidden;
      transition: all 0.2s ease;
    }
    .thinking-header {
      padding: 6px 12px;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      background: color-mix(in srgb, var(--panel-bg) 70%, transparent);
      font-size: calc(11.5px * var(--font-scale));
      color: var(--text-dim);
    }
    .thinking-header:hover {
      background: var(--card-bg);
      color: var(--text);
    }
    .thinking-pulse {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      animation: brainPulse 2s infinite ease-in-out;
    }
    @keyframes brainPulse {
      0%, 100% { transform: scale(1); opacity: 0.8; }
      50% { transform: scale(1.2); opacity: 1; }
    }
    .thinking-title {
      font-weight: 600;
      color: var(--accent);
      flex: 1;
    }
    .thinking-badge {
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-family: ui-monospace, monospace;
    }
    .thinking-chevron {
      transition: transform 0.2s ease;
      font-size: 10px;
    }
    .thinking-chevron.collapsed {
      transform: rotate(-90deg);
    }
    .thinking-body {
      padding: 8px 12px;
      font-family: ui-monospace, SFMono-Regular, "Fira Code", monospace;
      font-size: calc(11.5px * var(--font-scale));
      line-height: 1.5;
      color: var(--text-dim);
      border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      max-height: 220px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .thinking-body.collapsed {
      display: none;
    }

    #modern-chat-stream {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 4px 0;
    }
    .chat-bubble {
      margin: 2px 12px;
      padding: 10px 14px;
      border-radius: 8px;
      font-size: calc(12.5px * var(--font-scale));
      line-height: 1.5;
    }
    .chat-bubble.user {
      background: color-mix(in srgb, var(--card-bg) 85%, transparent);
      border: 1px solid var(--border);
      border-left: 3px solid var(--accent);
    }
    .chat-bubble.assistant {
      background: color-mix(in srgb, var(--panel-bg) 60%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
    }
    .chat-bubble-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-size: 11px;
      color: var(--text-dim);
      font-weight: 600;
    }
    .chat-bubble-content {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .tool-card {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      margin: 3px 12px;
      border-radius: 6px;
      background: color-mix(in srgb, var(--card-bg) 90%, transparent);
      border: 1px solid var(--border);
      font-family: ui-monospace, monospace;
      font-size: calc(11px * var(--font-scale));
    }
    .tool-card.running {
      border-color: var(--yellow);
      color: var(--yellow);
    }
    .tool-card.done {
      border-color: var(--green);
      color: var(--green);
    }
    .scroll-bottom-pill {
      position: absolute;
      bottom: 14px;
      right: 20px;
      background: var(--card-bg);
      border: 1px solid var(--accent);
      color: var(--accent);
      padding: 4px 12px;
      border-radius: 16px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.5);
      display: none;
      align-items: center;
      gap: 4px;
      z-index: 30;
      transition: all 0.2s;
    }
    .scroll-bottom-pill:hover {
      background: var(--accent);
      color: #fff;
    }

    /* Mobile Responsive Dock & Media Queries */
    #mobile-dock {
      display: none;
      background: var(--panel-bg);
      border-top: 1px solid var(--border);
      height: 48px;
      flex-shrink: 0;
      align-items: center;
      justify-content: space-around;
      padding: 0 4px;
      z-index: 100;
    }
    .mobile-dock-btn {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      background: transparent;
      border: none;
      color: var(--text-dim);
      font-size: 10px;
      cursor: pointer;
      padding: 4px 0;
      border-radius: 4px;
      transition: all 0.15s;
    }
    .mobile-dock-btn.active {
      color: var(--accent);
      font-weight: 700;
      background: color-mix(in srgb, var(--accent) 12%, transparent);
    }

    @media (max-width: 768px) {
      header {
        padding: 6px 10px !important;
      }
      .logo-container {
        font-size: 13px !important;
      }
      .header-credits-bar {
        display: none !important;
      }
      .hide-mobile {
        display: none !important;
      }
      #workspace {
        flex-direction: column !important;
      }
      #pane-resizer {
        display: none !important;
      }
      #left-pane, #right-pane {
        flex: 1 1 100% !important;
        width: 100% !important;
        min-width: 0 !important;
        border-right: none !important;
      }
      .pane.mobile-hidden {
        display: none !important;
      }
      #mobile-dock {
        display: flex !important;
      }
      .status-bar {
        font-size: 10px !important;
        padding: 4px 8px !important;
      }
      .status-bar > div:last-child {
        display: none !important;
      }
      .modal-dialog {
        width: 95vw !important;
        max-width: 95vw !important;
        max-height: 90vh !important;
      }
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
    .btn-stop {
      background: #3d1418;
      border-color: #f8514988;
      color: #ff7b72;
      font-weight: 600;
      white-space: nowrap;
    }
    .btn-stop:hover { background: #f8514933; border-color: #f85149; }
    .btn-kill {
      background: #3d1418;
      border-color: #f8514988;
      color: #ff7b72;
      font-weight: 600;
      white-space: nowrap;
    }
    .btn-kill:hover { background: #f8514933; border-color: #f85149; }
    .btn-kill:disabled { opacity: 0.6; cursor: not-allowed; }
    .kill-warning {
      color: var(--yellow);
      font-size: calc(12px * var(--font-scale));
      line-height: 1.5;
    }

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
    #account-modal, #welcome-modal, #model-modal {
      z-index: 2000;
    }
    #question-modal, #approval-modal {
      z-index: 3000;
    }
    #kill-server-modal {
      z-index: 3500;
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
    .busy-indicator {
      color: var(--yellow);
      font-weight: 600;
      animation: busyPulse 1.2s ease-in-out infinite;
    }
    @keyframes busyPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.45; }
    }
    @media (prefers-reduced-motion: reduce) {
      .busy-indicator { animation: none; }
    }
  </style>
</head>
<body>
  <header>
    <div style="display:flex; justify-content:space-between; align-items:center; width:100%; gap:16px;">
      <div class="logo-container">
        <span>☁️ <span class="shimmer-logo">MUGIL IDE</span></span>
        <span class="logo-badge">TOKEN EFFICIENT</span>
        <a class="version-badge" id="app-version" href="https://github.com/auarunkumar1/mugil-ide/releases/tag/v${VERSION}" target="_blank" rel="noopener noreferrer" title="Mugil IDE version ${VERSION} — view release notes">v${VERSION}</a>
        <a class="update-badge" id="version-update" href="#" target="_blank" rel="noopener noreferrer" title="" aria-label="Update available">⬆ update</a>
        <span id="logo-model-sub" style="font-size:11px; color:var(--text-dim); font-weight:normal; margin-left:6px; white-space:nowrap;">Active: <b id="sub-active-model" style="color:var(--accent);">Detecting...</b></span>
      </div>

    <div class="controls">
      <!-- Direct ribbon metrics -->
      <div style="position:relative; display:inline-block;">
        <span class="metric-pill" id="token-savings" onclick="toggleSavingsPopover(event)" style="cursor:pointer;" title="Click for token savings breakdown">Savings: ~0%</span>
        <div id="savings-popover" style="display:none; position:absolute; top:calc(100% + 6px); right:0; width:280px; background:var(--card-bg, #161b22); border:1px solid var(--border, #30363d); border-radius:6px; padding:10px 12px; box-shadow:0 8px 24px rgba(0,0,0,0.5); z-index:1000; font-size:11px; line-height:1.5;">
          <div style="font-weight:600; color:var(--text, #c9d1d9); margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
            <span>Token Savings Breakdown</span>
            <span id="savings-popover-total" style="color:var(--green, #3fb950); font-weight:bold;">0 tok</span>
          </div>
          <div style="display:flex; flex-direction:column; gap:5px;">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>🦴 <b>Caveman</b> (Prompt & History):</span>
              <span id="sp-caveman" style="color:var(--accent, #58a6ff); font-family:monospace;">0 tok</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>⚡ <b>YAGNI</b> (AST Skeletons & Code):</span>
              <span id="sp-yagni" style="color:var(--accent, #58a6ff); font-family:monospace;">0 tok</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>💾 <b>Smart Cache</b> (Exact & Semantic):</span>
              <span id="sp-cache" style="color:var(--accent, #58a6ff); font-family:monospace;">0 tok</span>
            </div>
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <span>🔌 <b>MCP & Tools</b> (RTK & Truncation):</span>
              <span id="sp-mcp" style="color:var(--accent, #58a6ff); font-family:monospace;">0 tok</span>
            </div>
          </div>
          <div style="margin-top:8px; padding-top:6px; border-top:1px solid var(--border, #30363d); color:var(--text-dim, #8b949e); font-size:10px;">
            Real compressed: <span id="sp-real" style="color:var(--text, #c9d1d9);">0 tok</span> · Overall efficiency: <span id="sp-rate" style="color:var(--green, #3fb950); font-weight:bold;">~0%</span>
          </div>
        </div>
      </div>
      <span class="metric-pill" id="session-spent" style="color:var(--green); border-color:#23863644;">Est. Spent: $0.0000</span>

      <!-- Zoom controls directly on ribbon -->
      <div class="zoom-controls" style="display:flex; align-items:center; background:var(--card-bg); border:1px solid var(--border); border-radius:4px; overflow:hidden;" title="Adjust text & terminal zoom size">
        <button class="btn" style="border:none; border-radius:0; padding:3px 7px; font-weight:bold; font-size:11px;" onclick="changeZoom(-0.1)" title="Zoom Out (Ctrl -)">A−</button>
        <span id="zoom-label" style="font-size:11px; color:var(--text-dim); padding:0 4px; min-width:36px; text-align:center; user-select:none;">100%</span>
        <button class="btn" style="border:none; border-radius:0; padding:3px 7px; font-weight:bold; font-size:11px;" onclick="changeZoom(0.1)" title="Zoom In (Ctrl +)">A+</button>
      </div>

      <!-- Image & Media Generator -->
      <button class="btn" onclick="openImageGenModal()" title="Generate AI images & visual assets">
        <span>🖼️ Generate Image</span>
      </button>

      <!-- Stream to Network Device via Secret Link & QR -->
      <button class="btn" id="stream-session-btn" onclick="openRemoteStreamModal()" title="Stream session to phone / tablet / network device via QR code & secret link">
        <span>📱 Stream</span>
      </button>

      <!-- Theme Selector Dropdown -->
      <div class="menu-dropdown">
        <button class="btn" onclick="toggleThemeDropdown(event)" id="header-theme-btn" title="Switch Theme (Nordic, OLED Dark, Dracula, Cyberpunk, GitHub Dark)">
          <span>🎨 Theme</span> ▾
        </button>
        <div class="menu-dropdown-content" id="header-theme-dropdown">
          <button class="menu-item-btn" onclick="closeThemeDropdown(); setTheme('github-dark');">
            <span style="width:10px;height:10px;border-radius:50%;background:#58a6ff;display:inline-block;"></span> GitHub Dark
          </button>
          <button class="menu-item-btn" onclick="closeThemeDropdown(); setTheme('nord');">
            <span style="width:10px;height:10px;border-radius:50%;background:#88c0d0;display:inline-block;"></span> Nordic (Nord)
          </button>
          <button class="menu-item-btn" onclick="closeThemeDropdown(); setTheme('oled');">
            <span style="width:10px;height:10px;border-radius:50%;background:#ffffff;border:1px solid #333;display:inline-block;"></span> OLED Dark (True Black)
          </button>
          <button class="menu-item-btn" onclick="closeThemeDropdown(); setTheme('dracula');">
            <span style="width:10px;height:10px;border-radius:50%;background:#bd93f9;display:inline-block;"></span> Dracula
          </button>
          <button class="menu-item-btn" onclick="closeThemeDropdown(); setTheme('cyberpunk');">
            <span style="width:10px;height:10px;border-radius:50%;background:#ff007f;display:inline-block;"></span> Cyberpunk Neon
          </button>
        </div>
      </div>

      <!-- Main Action: Session Setup -->
      <button class="btn btn-primary" onclick="openSessionSetupModal()" title="Configure session budgets, limits & turbo mode">
        <span>🚀 Session Setup</span>
      </button>

      <!-- Stop the backend process entirely (closes the terminal session too) -->
      <button class="btn btn-kill" id="kill-server-btn" onclick="openKillServerModal()" title="Stop the Mugil IDE server process">
        <span aria-hidden="true">⚠</span> Kill Server
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
          <button class="menu-item-btn" id="debugger-toggle" onclick="closeMenuDropdown(); toggleStepDebugger();">
            <span id="debugger-icon">🐛</span> <span id="debugger-label">Step Debugger: Off</span>
          </button>
          <button class="menu-item-btn" id="mode-toggle" onclick="closeMenuDropdown(); toggleMode();">
            <span id="mode-icon">⚡</span> <span>Agent Mode: <b id="mode-label">Act</b></span>
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openImageGenModal();">
            <span>🖼️ Generate Image</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openExtensionsModal();">
            <span>🧩 Pluggable Extensions & Skills</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openAccountModal();">
            <span>🔑 Accounts & API Keys</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openWorkspaceModal();">
            <span>📂 Switch Project Folder</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openModulesModal();">
            <span>⚡ Token Modules & Rules</span>
          </button>
          <button class="menu-item-btn" onclick="closeMenuDropdown(); openCreditsModal();">
            <span>📜 Open Source Credits & Attributions</span>
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

      <div class="view-mode-toggle-bar">
        <button id="view-toggle-modern" class="view-toggle-btn active" onclick="switchAgentViewMode('modern')">✨ Modern View</button>
        <button id="view-toggle-terminal" class="view-toggle-btn" onclick="switchAgentViewMode('terminal')">💻 Raw Terminal</button>
      </div>

      <div id="terminal-container">
        <!-- Modern Rich View: Thinking Container + Structured Chat Stream -->
        <div id="modern-agent-view">
          <div class="thinking-container" id="thinking-container" style="display:none;">
            <div class="thinking-header" onclick="toggleThinking()">
              <span class="thinking-pulse">🧠</span>
              <span class="thinking-title">Thinking Process</span>
              <span class="thinking-badge" id="thinking-badge">0s</span>
              <span class="thinking-chevron" id="thinking-chevron">▾</span>
            </div>
            <div class="thinking-body" id="thinking-body"></div>
          </div>
          <div id="modern-chat-stream">
            <div class="chat-bubble assistant">
              <div class="chat-bubble-header">
                <span>🤖 Mugil AI Assistant</span>
                <span style="font-size:10px; color:var(--text-dim);">Ready</span>
              </div>
              <div class="chat-bubble-content">Welcome to Mugil IDE. Type a prompt or command below to start building.</div>
            </div>
          </div>
          <div class="scroll-bottom-pill" id="scroll-bottom-pill" onclick="scrollModernToBottom()">↓ New Output</div>
        </div>
        <div id="agent-view" class="terminal-view" style="display:none;"></div>
        <div id="pty-view" class="terminal-view"></div>
      </div>

      <div class="quick-input-container">
        <input type="text" class="quick-input" id="chat-input" placeholder="Type prompt or command (/models, /undo, /stats, /help)..." onkeydown="handleQuickInput(event)" />
        <button class="btn btn-stop" id="stop-btn" onclick="stopAgentTurn()" title="Stop the running turn (Esc)" style="display:none;">■ Stop</button>
        <button class="btn btn-primary" onclick="submitQuickInput()">Send ↵</button>
      </div>
    </div>

    <div id="pane-resizer" title="Drag to resize panes"></div>

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
      <span id="status-busy" class="busy-indicator" style="display:none;">● Working…</span>
      <span id="status-model">Model: auto</span>
      <span id="status-tokens">Used: 0 tok</span>
      <span id="status-spent" style="color:var(--green);">Est. Spent: $0.0000</span>
      <span id="status-workspace" onclick="openWorkspaceModal()" style="cursor:pointer; text-decoration:underline;" title="Click to view or switch workspace directory">Workspace: Active</span>
    </div>
    <div>
      <span>Left: Chat & Autonomous Tools · Right: File Tree, Diffs & CodeGraph</span>
    </div>
  </div>

  <!-- Mobile Bottom Navigation Dock (Shown on screens < 768px) -->
  <nav id="mobile-dock">
    <button class="mobile-dock-btn active" id="dock-agent" onclick="switchMobileView('agent')">
      <span>🤖</span><span>Agent</span>
    </button>
    <button class="mobile-dock-btn" id="dock-pty" onclick="switchMobileView('pty')">
      <span>💻</span><span>Terminal</span>
    </button>
    <button class="mobile-dock-btn" id="dock-files" onclick="switchMobileView('files')">
      <span>📁</span><span>Files</span>
    </button>
    <button class="mobile-dock-btn" id="dock-diff" onclick="switchMobileView('diff')">
      <span>🔍</span><span>Diffs</span>
    </button>
    <button class="mobile-dock-btn" id="dock-more" onclick="openRemoteStreamModal()">
      <span>📱</span><span>Stream</span>
    </button>
  </nav>

  <!-- Network Device Session Streaming Modal (QR Code & Secret Link) -->
  <div class="modal-overlay" id="remote-stream-modal">
    <div class="modal-dialog" style="max-width:480px; text-align:center;">
      <div class="modal-title-bar">
        <span>📱 Stream Session to Network Device</span>
        <button class="btn" onclick="closeRemoteStreamModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px;">
        <p style="font-size:12px; color:var(--text-dim); margin-bottom:12px; line-height:1.4;">
          Scan the QR code with your phone or tablet on the same Wi-Fi / network to stream thinking processes and continue this session on the go.
        </p>
        <div id="qr-code-display" style="display:flex; justify-content:center; align-items:center; margin:12px auto; padding:12px; background:#ffffff; border-radius:12px; width:220px; height:220px; box-shadow:0 8px 24px rgba(0,0,0,0.3);">
          <div style="color:#000;">Loading QR Code...</div>
        </div>
        <div style="margin:14px 0; text-align:left;">
          <label style="font-size:11px; color:var(--text-dim); display:block; margin-bottom:4px;">Secret Session Link:</label>
          <div style="display:flex; gap:6px;">
            <input type="text" id="remote-stream-link" readonly style="flex:1; background:var(--panel-bg); border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:11px; font-family:ui-monospace, monospace;" />
            <button class="btn btn-primary" onclick="copyRemoteStreamLink()">📋 Copy</button>
          </div>
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; margin-top:14px; padding-top:10px; border-top:1px solid var(--border); font-size:11.5px;">
          <span id="remote-device-status"><span class="dot" style="background:var(--green);"></span> Stream Ready</span>
          <span id="remote-clients-count" style="color:var(--text-dim);">1 client connected</span>
        </div>
      </div>
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

  <!-- First-Launch Onboarding: Welcome & AI Setup Modal -->
  <div class="modal-overlay" id="welcome-modal">
    <div class="modal-dialog" style="max-width:620px;">
      <div class="modal-title-bar">
        <span>✨ Welcome to Mugil IDE — Quick AI Setup</span>
        <button class="btn" onclick="closeWelcomeModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:13px; color:var(--text); line-height:1.5;">
          No AI provider or API keys are currently configured. Connect a cloud provider or local offline AI to enable autonomous coding:
        </div>

        <!-- Option 1: Cloud API Key -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:8px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--accent); font-size:13px;">☁ Cloud AI (Recommended)</strong>
            <span style="font-size:11px; color:var(--text-dim);">Fastest setup · 200+ models</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-dim); margin-top:4px;">
            Works with <b>OpenRouter</b>, <b>OpenAI</b>, <b>Anthropic</b>, or <b>OpenCode</b>.
          </div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <select id="welcome-provider-select" style="background:#161b22; border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:12px;">
              <option value="openrouter|OPENROUTER_API_KEY">OpenRouter (Rec)</option>
              <option value="openai|OPENAI_API_KEY">OpenAI</option>
              <option value="anthropic|ANTHROPIC_API_KEY">Anthropic</option>
              <option value="opencode|OPENCODE_API_KEY">OpenCode</option>
            </select>
            <input type="password" id="welcome-key-input" class="input-field" placeholder="Paste your API key here (sk-...)" style="flex:1;" />
            <button class="btn btn-primary" onclick="saveWelcomeCloudKey()">Save Key</button>
          </div>
          <div style="font-size:10.5px; color:var(--text-dim); margin-top:6px;">
            Don't have a key? <a href="https://openrouter.ai/keys" target="_blank" style="color:var(--accent); text-decoration:underline;">Get OpenRouter Key ↗</a>
          </div>
        </div>

        <!-- Option 2: Local AI -->
        <div style="background:#11151c; border:1px solid var(--border); border-radius:8px; padding:12px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--green); font-size:13px;">🟢 Local AI (100% Offline & Free)</strong>
            <span style="font-size:11px; color:var(--green); font-weight:600;">No API key needed</span>
          </div>
          <div style="font-size:11.5px; color:var(--text-dim); margin-top:4px;">
            Connect to a running local model server (Ollama or LM Studio).
          </div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn" style="flex:1; justify-content:center; padding:8px 12px;" onclick="testAndSaveLocalAi('ollama', 'http://localhost:11434/v1')">
              🦙 Connect Ollama (localhost:11434)
            </button>
            <button class="btn" style="flex:1; justify-content:center; padding:8px 12px;" onclick="testAndSaveLocalAi('lmstudio', 'http://localhost:1234/v1')">
              🧪 Connect LM Studio (localhost:1234)
            </button>
          </div>
          <div id="welcome-local-status" style="font-size:11px; margin-top:6px; display:none;"></div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:4px;">
          <button class="btn" onclick="openAccountModal(); closeWelcomeModal();" style="font-size:11px;">⚙ All Provider Settings</button>
          <button class="btn" onclick="closeWelcomeModal()" style="font-size:11px; color:var(--text-dim);">Skip for now (Mock mode)</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Kill Server Confirmation Modal -->
  <div class="modal-overlay" id="kill-server-modal" role="dialog" aria-modal="true" aria-labelledby="kill-server-title">
    <div class="modal-dialog" style="max-width:480px;">
      <div class="modal-title-bar">
        <span id="kill-server-title">⚠ Kill Server</span>
        <button class="btn" onclick="closeKillServerModal()" title="Cancel" aria-label="Cancel">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; gap:14px;">
        <div style="font-size:28px; text-align:center; color:var(--yellow);" aria-hidden="true">⚠</div>
        <div class="kill-warning" style="text-align:center;">
          This <b>stops the Mugil IDE server process</b>.
        </div>
        <ul style="color:var(--text-dim); font-size:12px; line-height:1.6; margin:0; padding-left:18px;">
          <li>The browser UI and WebSocket connection will disconnect.</li>
          <li>The shell terminal and any running agent turn are terminated.</li>
          <li>Unsaved session state is written before shutdown where possible.</li>
        </ul>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:4px;">
          <button class="btn" id="kill-server-cancel" onclick="closeKillServerModal()">Cancel</button>
          <button class="btn btn-kill" id="kill-server-confirm" onclick="confirmKillServer()">⚠ Kill Server</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Shown once the shutdown response comes back -->
  <div id="server-stopped-overlay" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.9); z-index:4000; align-items:center; justify-content:center; flex-direction:column; gap:12px; text-align:center; padding:24px;">
    <div style="font-size:36px;" aria-hidden="true">⏻</div>
    <div style="font-size:16px; font-weight:600; color:var(--text);">Server stopped</div>
    <div style="font-size:12.5px; color:var(--text-dim); max-width:420px; line-height:1.6;">
      The Mugil IDE backend has exited. You can close this tab. Start it again with <code style="color:var(--accent);">mugil-ide</code>.
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

  <!-- Interactive Step Debugger Modal -->
  <div class="modal-overlay" id="step-debugger-modal" style="z-index:10005;">
    <div class="modal-dialog" style="max-width:620px;">
      <div class="modal-title-bar">
        <span>🐛 Interactive Step Debugger</span>
        <button class="btn" onclick="sendStepDebuggerAction('abort')">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:12px; color:var(--text-dim);">
          Execution paused at tool breakpoint. Inspect arguments, modify parameters, skip, or continue.
        </div>
        <div style="display:flex; align-items:center; justify-content:space-between; background:#161b22; padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
          <div>
            <span style="font-size:11px; color:var(--text-dim); text-transform:uppercase;">Tool:</span>
            <code id="debugger-tool-name" style="font-weight:bold; color:var(--accent); font-size:13px; margin-left:6px;">tool_name</code>
          </div>
          <span id="debugger-timestamp" style="font-size:11px; color:var(--text-dim);">just now</span>
        </div>
        <div>
          <label style="font-size:11.5px; font-weight:600; color:var(--text-dim); margin-bottom:4px; display:block;">Arguments (JSON — editable):</label>
          <textarea id="debugger-args-textarea" style="width:100%; height:160px; font-family:Consolas, monospace; font-size:12px; background:#0d1117; color:var(--text); border:1px solid var(--border); border-radius:6px; padding:8px; box-sizing:border-box; resize:vertical;"></textarea>
        </div>
        <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:8px;">
          <button type="button" class="btn btn-kill" onclick="sendStepDebuggerAction('abort')">⏹ Abort Turn</button>
          <button type="button" class="btn" onclick="sendStepDebuggerAction('skip')">⏭ Skip Tool</button>
          <button type="button" class="btn" onclick="sendStepDebuggerAction('edit')">✏ Edit & Run</button>
          <button type="button" class="btn btn-primary" onclick="sendStepDebuggerAction('approve')">▶ Continue</button>
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
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
            <label style="font-size:12px; font-weight:600; color:var(--text); margin-bottom:0;">Active Model & Provider:</label>
            <button type="button" class="btn" onclick="openAccountModal();" style="font-size:10.5px; padding:2px 8px; color:var(--accent);">🔑 Manage API Keys</button>
          </div>
          <select id="setup-model-select" onchange="onSetupModelChange()" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:13px; font-family:inherit;">
            <option value="">Loading models...</option>
          </select>
          <div id="setup-model-badge" style="margin-top:6px; font-size:11px; color:var(--text-dim); display:flex; gap:14px; align-items:center; flex-wrap:wrap;">
            <span id="setup-model-provider" style="color:var(--accent);">Provider: Auto</span>
            <span id="setup-model-context" style="color:var(--text-dim);">Context: 128k</span>
            <span id="setup-model-pricing" style="color:var(--green); font-weight:600;">Pricing: Detecting...</span>
          </div>
          <div id="setup-no-keys-banner" style="display:none; margin-top:8px; padding:8px 12px; background:#f851491a; border:1px solid #f8514966; border-radius:6px; font-size:11.5px; color:#ff7b72;">
            ⚠ No API keys or local AI servers configured. Responses will run in mock mode.
            <a href="javascript:void(0)" onclick="openWelcomeModal();" style="color:var(--accent); font-weight:600; text-decoration:underline; margin-left:6px;">Connect AI Provider ↗</a>
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
            <button type="button" id="preset-btn-light" class="btn preset-btn" onclick="applyWorkloadPreset('light')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="32k context, 8k output, 10 tools, 20 turns">💬 Light Convo</button>
            <button type="button" id="preset-btn-deep" class="btn preset-btn btn-primary" onclick="applyWorkloadPreset('deep')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="64k context, 32k output, 25 tools, 50 turns">🛠 Deep Development (Rec)</button>
            <button type="button" id="preset-btn-big" class="btn preset-btn" onclick="applyWorkloadPreset('big')" style="font-size:11.5px; padding:5px 12px; border-radius:6px;" title="128k context, 64k output, 60 tools, 100 turns">🏗 Big Codebase & Audit</button>
          </div>
        </div>

        <!-- Sliders with synced inputs & dual explanations -->
        <div style="display:flex; flex-direction:column; gap:14px; background:#0d1117; border:1px solid var(--border); border-radius:8px; padding:14px;">
          <!-- 1. Context Token Budget -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-history-budget">Context Token Budget:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-history-budget" value="64000" step="1000" min="1000" max="256000" oninput="syncSliderFromInput('history-budget')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">tok</span>
              </div>
            </div>
            <input type="range" id="slider-history-budget" min="1000" max="256000" step="1000" value="64000" oninput="syncInputFromSlider('history-budget')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> How much past conversation and project code the AI can remember at once.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> History sliding-window budget for history compaction before sending prompt.</div>
          </div>

          <!-- 2. Max Output Tokens -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-output">Max Output Tokens:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-output" value="32768" step="1024" min="1024" max="131072" oninput="syncSliderFromInput('max-output')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">tok</span>
              </div>
            </div>
            <input type="range" id="slider-max-output" min="1024" max="131072" step="1024" value="32768" oninput="syncInputFromSlider('max-output')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> Maximum length of a single AI reply or file written in one step.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Model completion max_tokens ceiling; stops responses or reports from truncating.</div>
          </div>

          <!-- 3. Max Tool Iterations per Turn -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-tool-iters">Max Tool Calls per Turn:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-tool-iters" value="40" min="5" max="200" oninput="syncSliderFromInput('max-tool-iters')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">calls</span>
              </div>
            </div>
            <input type="range" id="slider-max-tool-iters" min="5" max="200" step="1" value="40" oninput="syncInputFromSlider('max-tool-iters')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
            <div style="font-size:10.5px; color:#58a6ff; margin-top:2px;">• <b>Def:</b> Max actions (reading/writing files, shell commands) before pausing for your approval.</div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:1px;">• <b>Technical:</b> Bounded iteration limit for ToolLoop; if reached mid-task, prompts user to extend.</div>
          </div>

          <!-- 4. Max History Turns -->
          <div>
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
              <label style="font-size:12px; font-weight:600; color:var(--text);" for="setup-max-turns">Max History Turns:</label>
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="setup-max-turns" value="100" min="5" max="500" oninput="syncSliderFromInput('max-turns')" style="width:80px; background:#161b22; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px; text-align:right;" />
                <span style="font-size:11px; color:var(--text-dim);">turns</span>
              </div>
            </div>
            <input type="range" id="slider-max-turns" min="5" max="500" step="5" value="100" oninput="syncInputFromSlider('max-turns')" style="width:100%; accent-color:var(--accent); cursor:pointer;" />
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
            <input type="number" id="cfg-history-budget" style="width:90px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="64000" step="1000" min="1000" />
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-max-turns">Max History Turns:</label>
            <input type="number" id="cfg-max-turns" style="width:70px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="100" min="2" max="500" />
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <label style="font-size:11px; color:var(--text-dim);" for="cfg-max-output">Max Output Tokens:</label>
            <input type="number" id="cfg-max-output" style="width:80px; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:3px 6px; border-radius:4px; font-size:11px;" value="32768" step="1024" min="1024" />
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

  <!-- Pluggable Extensions & Skills Registry Modal -->
  <div class="modal-overlay" id="extensions-modal">
    <div class="modal-dialog" style="max-width:680px; max-height:85vh; display:flex; flex-direction:column;">
      <div class="modal-title-bar">
        <span>🧩 Pluggable Extensions & Skill Registry</span>
        <button class="btn" onclick="closeExtensionsModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:14px; overflow-y:auto;">
        <div style="font-size:12px; color:var(--text-dim); line-height:1.4;">
          Visual registry for agent skills, Model Context Protocol (MCP) servers, and custom tool extensions.
        </div>
        <div class="modal-tabs">
          <button class="modal-tab-btn active" id="exttab-skills" onclick="switchExtTab('skills')">Agent Skills</button>
          <button class="modal-tab-btn" id="exttab-gallery" onclick="switchExtTab('gallery')">Skills Gallery</button>
          <button class="modal-tab-btn" id="exttab-mcp" onclick="switchExtTab('mcp')">Connected MCP Servers (0)</button>
        </div>
        <div id="ext-skills-pane" style="display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <span style="font-size:11px; color:var(--text-dim);">
              Skills are discovered from <code>.mugil/skills</code>, <code>.agents/skills</code>, <code>.claude/skills</code>, your global <code>~/.config/mugil-ide/skills</code>, and built-ins.
            </span>
            <div style="display:flex; gap:6px;">
              <button class="btn" onclick="openSkillInstallModal()" style="font-size:11px; padding:4px 10px; white-space:nowrap;">📥 Install Custom</button>
              <button class="btn btn-primary" onclick="openSkillCreate()" style="font-size:11px; padding:4px 10px; white-space:nowrap;">✨ New Skill</button>
            </div>
          </div>
          <div id="skill-list" style="display:flex; flex-direction:column; gap:10px;">
            <div style="color:var(--text-dim); font-size:11.5px; padding:12px;">Loading skills…</div>
          </div>
          <div id="skill-viewer" style="display:none; border:1px solid var(--border); border-radius:6px; background:#0d1117;">
            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; border-bottom:1px solid var(--border);">
              <strong id="skill-viewer-title" style="font-size:12px;">Skill</strong>
              <button class="btn" onclick="closeSkillViewer()" style="padding:2px 8px;">✕</button>
            </div>
            <pre id="skill-viewer-body" style="margin:0; padding:12px; font-size:11px; line-height:1.5; max-height:340px; overflow:auto; white-space:pre-wrap;"></pre>
          </div>
        </div>
        <div id="ext-gallery-pane" style="display:none; flex-direction:column; gap:10px;">
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="gallery-search" placeholder="Search curated gallery skills by name, tag, or description..." oninput="filterGallery()" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:11.5px;" />
          </div>
          <div id="gallery-categories" style="display:flex; gap:5px; flex-wrap:wrap;">
            <button class="btn active-cat" id="cat-all" onclick="switchGalleryCategory('all')" style="font-size:10px; padding:2px 8px; border-radius:12px;">All</button>
            <button class="btn" id="cat-architecture" onclick="switchGalleryCategory('Architecture')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Architecture</button>
            <button class="btn" id="cat-testing" onclick="switchGalleryCategory('Testing')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Testing</button>
            <button class="btn" id="cat-security" onclick="switchGalleryCategory('Security')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Security</button>
            <button class="btn" id="cat-refactoring" onclick="switchGalleryCategory('Refactoring')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Refactoring</button>
            <button class="btn" id="cat-devops" onclick="switchGalleryCategory('DevOps')" style="font-size:10px; padding:2px 8px; border-radius:12px;">DevOps</button>
            <button class="btn" id="cat-git" onclick="switchGalleryCategory('Git & Workflow')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Git & Workflow</button>
            <button class="btn" id="cat-performance" onclick="switchGalleryCategory('Performance')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Performance</button>
            <button class="btn" id="cat-business" onclick="switchGalleryCategory('Business Logic')" style="font-size:10px; padding:2px 8px; border-radius:12px;">Business Logic</button>
          </div>
          <div id="gallery-list" style="display:flex; flex-direction:column; gap:10px; max-height:50vh; overflow-y:auto;">
            <div style="color:var(--text-dim); font-size:11.5px; padding:12px;">Loading gallery…</div>
          </div>
        </div>
        <div id="ext-mcp-pane" style="display:none; flex-direction:column; gap:10px;">
          <div style="font-size:11.5px; color:var(--text-dim); padding:16px; text-align:center; border:1px dashed var(--border); border-radius:6px;">
            Configure external MCP servers in <code>MUGIL_IDE_MCP_SERVERS</code> or <code>MUGIL_IDE_MCP_CONFIG</code>.<br>
            Lazy schema gateway pruning is active, saving 2,000–5,000 tokens per turn.
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Skill Creator Modal -->
  <div class="modal-overlay" id="skill-create-modal">
    <div class="modal-dialog" style="max-width:520px;">
      <div class="modal-title-bar">
        <span>✨ New Agent Skill</span>
        <button class="btn" onclick="closeSkillCreate()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:12px;">
        <div>
          <label for="skill-create-name" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Skill Name</label>
          <input type="text" id="skill-create-name" placeholder="e.g. security-auditor" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;" />
          <div style="font-size:10.5px; color:var(--text-dim); margin-top:4px;">Lowercase letters, digits, <code>.</code>, <code>_</code>, <code>-</code></div>
        </div>
        <div>
          <label for="skill-create-desc" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Description</label>
          <input type="text" id="skill-create-desc" placeholder="One line the model sees in its system prompt" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;" />
        </div>
        <div>
          <label for="skill-create-triggers" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Auto-trigger phrases</label>
          <input type="text" id="skill-create-triggers" placeholder="security audit, pentest (comma separated)" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;" />
        </div>
        <div>
          <label for="skill-create-source" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Where to create it</label>
          <select id="skill-create-source" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;">
            <option value="workspace">This workspace (.mugil/skills)</option>
            <option value="global">Global — all projects (~/.config/mugil-ide/skills)</option>
          </select>
        </div>
        <div id="skill-create-error" style="display:none; color:var(--red); font-size:11.5px;"></div>
        <div style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn" onclick="closeSkillCreate()">Cancel</button>
          <button class="btn btn-primary" onclick="submitSkillCreate()">Create Skill</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Install Custom Skill Modal -->
  <div class="modal-overlay" id="skill-install-modal">
    <div class="modal-dialog" style="max-width:540px;">
      <div class="modal-title-bar">
        <span>📥 Install Custom Skill</span>
        <button class="btn" onclick="closeSkillInstallModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:12px;">
        <div style="font-size:11.5px; color:var(--text-dim); line-height:1.4;">
          Install an agent skill from a GitHub repository, subfolder URL, direct raw <code>SKILL.md</code> link, or local directory.
        </div>
        <div>
          <label for="skill-install-source" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Skill Source URL or Local Path</label>
          <input type="text" id="skill-install-source" placeholder="e.g. https://github.com/org/repo/tree/main/skills/my-skill" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px; font-family:monospace;" />
        </div>
        <div>
          <label for="skill-install-name" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Custom Skill Name (Optional)</label>
          <input type="text" id="skill-install-name" placeholder="Leave empty to infer from repository / SKILL.md" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;" />
        </div>
        <div>
          <label for="skill-install-target" style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Installation Target</label>
          <select id="skill-install-target" style="width:100%; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:7px 10px; border-radius:6px; font-size:12px;">
            <option value="workspace">Workspace (.mugil/skills — this project only)</option>
            <option value="global">Global (~/.config/mugil-ide/skills — available everywhere)</option>
          </select>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <input type="checkbox" id="skill-install-force" />
          <label for="skill-install-force" style="font-size:11.5px; color:var(--text);">Overwrite if already installed</label>
        </div>
        <div id="skill-install-error" style="display:none; color:var(--red); font-size:11px; padding:6px 10px; background:#f8514915; border-radius:6px; border:1px solid #f8514933;"></div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
          <button class="btn" onclick="closeSkillInstallModal()">Cancel</button>
          <button class="btn btn-primary" id="skill-install-submit-btn" onclick="submitCustomSkillInstall()">📥 Install Skill</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Open Source Credits & Attributions Modal -->
  <div class="modal-overlay" id="credits-modal">
    <div class="modal-dialog" style="max-width:760px; max-height:85vh; display:flex; flex-direction:column;">
      <div class="modal-title-bar">
        <span>📜 Open Source Credits & Attributions</span>
        <button class="btn" onclick="closeCreditsModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:12px; overflow-y:auto;">
        <div style="font-size:12px; color:var(--text-dim); line-height:1.4;">
          Mugil IDE stands on the shoulders of the open-source community. All agent skills, core engine modules, and foundational libraries are credited below with their authors, upstream repositories, and licenses.
        </div>
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="credits-search" placeholder="Search credits by name, author, license, or keyword..." oninput="filterCredits()" style="flex:1; background:#0d1117; border:1px solid var(--border); color:var(--text); padding:6px 10px; border-radius:6px; font-size:11.5px;" />
        </div>
        <div class="modal-tabs">
          <button class="modal-tab-btn active" id="credtab-skills" onclick="switchCreditsTab('skills')">Agent Skills</button>
          <button class="modal-tab-btn" id="credtab-modules" onclick="switchCreditsTab('modules')">Core Engine Modules</button>
          <button class="modal-tab-btn" id="credtab-libraries" onclick="switchCreditsTab('libraries')">Libraries & Infrastructure</button>
        </div>
        <div id="credits-container" style="display:flex; flex-direction:column; gap:10px; max-height:55vh; overflow-y:auto;">
          <div style="color:var(--text-dim); font-size:11.5px; padding:12px;">Loading credits…</div>
        </div>
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
        <div style="display:flex; justify-content:space-between; align-items:center; font-size:10.5px; color:var(--text-dim); margin-top:2px; margin-bottom:-4px;">
          <span>Folders</span>
          <span>Tip: Single click to select, double click or 'Open →' to open</span>
        </div>
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

  <!-- Image Generation Modal -->
  <div class="modal-overlay" id="image-gen-modal">
    <div class="modal-dialog" style="max-width:580px;">
      <div class="modal-title-bar">
        <span>🖼️ Generate Image & Visual Asset</span>
        <button class="btn" onclick="closeImageGenModal()">✕</button>
      </div>
      <div class="modal-body" style="padding:16px 20px; display:flex; flex-direction:column; gap:14px;">
        <div style="font-size:12px; color:var(--text-dim); line-height:1.5;">
          Generate images with multi-tier dispatch across <b>Vercel AI Gateway</b>, <b>OpenRouter</b>, <b>OpenAI DALL-E</b>, <b>Together Flux</b>, and free <b>Pollinations AI</b>. Saved assets can be reverted with <code>/undo</code>.
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Prompt Description *</label>
          <textarea id="imagegen-prompt" rows="3" class="search-input" style="width:100%; resize:vertical; padding:8px 10px; font-family:inherit; font-size:13px;" placeholder="e.g. Modern geometric logo for a fast AI terminal, gradient neon blue and purple"></textarea>
        </div>
        <div style="display:flex; gap:12px;">
          <div style="flex:1;">
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Provider</label>
            <select id="imagegen-provider" class="search-input" style="width:100%; padding:6px 8px; font-size:12px;" onchange="onImageGenProviderChange()">
              <option value="auto">Auto (Cascade across configured providers)</option>
              <option value="pollinations">Pollinations AI (Free, No API key)</option>
              <option value="openai">OpenAI (DALL-E & GPT Image)</option>
              <option value="together">Together AI (FLUX & SDXL)</option>
              <option value="openrouter">OpenRouter</option>
              <option value="vercel">Vercel AI Gateway</option>
              <option value="mock">Offline Mock (SVG)</option>
            </select>
          </div>
          <div style="flex:1;">
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Model</label>
            <select id="imagegen-model" class="search-input" style="width:100%; padding:6px 8px; font-size:12px;" onchange="onImageGenModelChange()">
              <option value="">Default (Provider cascade default)</option>
            </select>
            <input type="text" id="imagegen-custom-model" class="search-input" style="display:none; width:100%; margin-top:6px; padding:6px 10px; font-family:monospace; font-size:12px;" placeholder="Custom model ID (e.g. dall-e-3)" />
          </div>
        </div>
        <div style="display:flex; gap:12px;">
          <div style="flex:1;">
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Output Path (workspace relative)</label>
            <input type="text" id="imagegen-path" class="search-input" style="width:100%; padding:6px 10px; font-family:monospace; font-size:12px;" value="assets/generated.png" placeholder="e.g. assets/hero.png or icons/logo.svg" />
          </div>
          <div style="width:160px;">
            <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Dimensions</label>
            <select id="imagegen-size" class="search-input" style="width:100%; padding:6px 8px; font-size:12px;">
              <option value="1024x1024">1024x1024 (Square)</option>
              <option value="1792x1024">1792x1024 (Landscape)</option>
              <option value="1024x1792">1024x1792 (Portrait)</option>
              <option value="512x512">512x512 (Compact)</option>
              <option value="1280x720">1280x720 (HD)</option>
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; display:block; margin-bottom:4px;">Visual Style Guide</label>
          <select id="imagegen-style" class="search-input" style="width:100%; padding:6px 8px; font-size:12px;">
            <option value="">None / Custom from prompt</option>
            <option value="vector icon, clean SVG style">Vector Icon</option>
            <option value="photorealistic, 8k resolution, cinematic lighting">Photorealistic</option>
            <option value="flat illustration, modern minimal design">Flat Illustration</option>
            <option value="pixel art, 16-bit retro style">Pixel Art</option>
            <option value="cyberpunk, futuristic neon lighting">Cyberpunk</option>
            <option value="minimalist line art">Minimalist Line Art</option>
          </select>
        </div>
        <div id="imagegen-status" style="display:none; padding:10px 12px; border-radius:6px; font-size:12px;"></div>
        <div id="imagegen-preview" style="display:none; text-align:center; padding:12px; border:1px solid var(--border); border-radius:6px; background:var(--bg-card);">
          <img id="imagegen-preview-img" src="" alt="Generated Preview" style="max-width:100%; max-height:220px; object-fit:contain; border-radius:4px; display:block; margin:0 auto 10px;" />
          <div style="display:flex; justify-content:center; gap:12px; font-size:12px;">
            <button class="btn" id="imagegen-open-viewer-btn" onclick="openGeneratedInViewer()">📂 Open in File Viewer</button>
            <a id="imagegen-download-link" href="#" download class="btn" style="text-decoration:none;">⬇ Download Asset</a>
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:6px;">
          <button class="btn" onclick="closeImageGenModal()">Close</button>
          <button class="btn btn-primary" id="imagegen-submit-btn" onclick="triggerImageGeneration()">✨ Generate Image</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Themes Engine
    const THEMES = {
      'github-dark': {
        name: 'GitHub Dark',
        xterm: {
          background: '#0d1117',
          foreground: '#e6edf3',
          cursor: '#58a6ff',
          black: '#484f58',
          red: '#ff7b72',
          green: '#3fb950',
          yellow: '#d29922',
          blue: '#58a6ff',
          magenta: '#bc8cff',
          cyan: '#39c5cf',
          white: '#b1bac4',
        }
      },
      'nord': {
        name: 'Nordic (Nord)',
        xterm: {
          background: '#2e3440',
          foreground: '#eceff4',
          cursor: '#88c0d0',
          black: '#3b4252',
          red: '#bf616a',
          green: '#a3be8c',
          yellow: '#ebcb8b',
          blue: '#81a1c1',
          magenta: '#b48ead',
          cyan: '#88c0d0',
          white: '#e5e9f0',
        }
      },
      'oled': {
        name: 'OLED Dark',
        xterm: {
          background: '#000000',
          foreground: '#ffffff',
          cursor: '#38bdf8',
          black: '#1f1f1f',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#38bdf8',
          magenta: '#c084fc',
          cyan: '#06b6d4',
          white: '#e5e5e5',
        }
      },
      'dracula': {
        name: 'Dracula',
        xterm: {
          background: '#282a36',
          foreground: '#f8f8f2',
          cursor: '#bd93f9',
          black: '#21222c',
          red: '#ff5555',
          green: '#50fa7b',
          yellow: '#f1fa8c',
          blue: '#bd93f9',
          magenta: '#ff79c6',
          cyan: '#8be9fd',
          white: '#f8f8f2',
        }
      },
      'cyberpunk': {
        name: 'Cyberpunk Neon',
        xterm: {
          background: '#0f051d',
          foreground: '#f3e8ff',
          cursor: '#ff007f',
          black: '#180936',
          red: '#ff3366',
          green: '#05ffa1',
          yellow: '#facc15',
          blue: '#00f0ff',
          magenta: '#ff007f',
          cyan: '#00f0ff',
          white: '#ffffff',
        }
      }
    };

    let currentTheme = localStorage.getItem('mugil_ide_theme') || 'github-dark';
    if (THEMES[currentTheme]) {
      document.documentElement.setAttribute('data-theme', currentTheme);
    }

    function setTheme(name) {
      if (!THEMES[name]) return;
      currentTheme = name;
      localStorage.setItem('mugil_ide_theme', name);
      document.documentElement.setAttribute('data-theme', name);
      const palette = THEMES[name].xterm;
      if (agentTerm && agentTerm.options) agentTerm.options.theme = { ...palette };
      if (ptyTerm && ptyTerm.options) ptyTerm.options.theme = { ...palette, cursor: '#3fb950' };
      closeThemeDropdown();
    }

    function toggleThemeDropdown(e) {
      if (e) e.stopPropagation();
      closeMenuDropdown();
      const dd = document.getElementById('header-theme-dropdown');
      if (dd) dd.classList.toggle('show');
    }

    function closeThemeDropdown() {
      const dd = document.getElementById('header-theme-dropdown');
      if (dd) dd.classList.remove('show');
    }

    // Modern View / Thinking Stream State
    let agentViewMode = 'modern';
    let isThinking = false;
    let thinkingStartTime = 0;
    let thinkingTimer = null;
    let currentAssistantBubble = null;

    function switchAgentViewMode(mode) {
      agentViewMode = mode;
      const modernBtn = document.getElementById('view-toggle-modern');
      const terminalBtn = document.getElementById('view-toggle-terminal');
      const modernView = document.getElementById('modern-agent-view');
      const terminalView = document.getElementById('agent-view');
      if (!modernBtn || !terminalBtn || !modernView || !terminalView) return;

      if (mode === 'modern') {
        modernBtn.classList.add('active');
        terminalBtn.classList.remove('active');
        modernView.classList.remove('hidden-view');
        terminalView.style.display = 'none';
        scrollModernToBottom();
      } else {
        modernBtn.classList.remove('active');
        terminalBtn.classList.add('active');
        modernView.classList.add('hidden-view');
        terminalView.style.display = 'block';
        if (agentFit) agentFit.fit();
      }
    }

    function toggleThinking() {
      const body = document.getElementById('thinking-body');
      const chevron = document.getElementById('thinking-chevron');
      if (!body || !chevron) return;
      body.classList.toggle('collapsed');
      chevron.classList.toggle('collapsed');
    }

    function scrollModernToBottom() {
      const modernView = document.getElementById('modern-agent-view');
      const pill = document.getElementById('scroll-bottom-pill');
      if (modernView) {
        modernView.scrollTop = modernView.scrollHeight;
      }
      if (pill) pill.style.display = 'none';
    }

    function escapeHtml(str) {
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function appendAssistantText(text) {
      const modernChat = document.getElementById('modern-chat-stream');
      if (!modernChat) return;

      if (!currentAssistantBubble) {
        currentAssistantBubble = document.createElement('div');
        currentAssistantBubble.className = 'chat-bubble assistant';
        currentAssistantBubble.innerHTML = '<div class="chat-bubble-header"><span>🤖 Assistant</span></div><div class="chat-bubble-content"></div>';
        modernChat.appendChild(currentAssistantBubble);
      }
      const contentEl = currentAssistantBubble.querySelector('.chat-bubble-content');
      if (contentEl) {
        contentEl.textContent += text;
      }
      scrollModernToBottom();
    }

    function renderModernStreamChunk(rawChunk) {
      if (!rawChunk) return;
      const clean = rawChunk.replace(/\\x1b\\[[0-9;]*[a-zA-Z]/g, '');
      const modernChat = document.getElementById('modern-chat-stream');
      const thinkingContainer = document.getElementById('thinking-container');
      const thinkingBody = document.getElementById('thinking-body');
      const thinkingBadge = document.getElementById('thinking-badge');
      if (!modernChat) return;

      // Detect <think> tag
      if (clean.includes('<think>')) {
        isThinking = true;
        thinkingStartTime = Date.now();
        if (thinkingContainer) thinkingContainer.style.display = 'block';
        if (thinkingBody) thinkingBody.textContent = '';
        if (thinkingBadge) thinkingBadge.textContent = '0.0s';
        if (thinkingTimer) clearInterval(thinkingTimer);
        thinkingTimer = setInterval(() => {
          if (isThinking && thinkingBadge) {
            thinkingBadge.textContent = ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
          }
        }, 100);
      }

      if (isThinking) {
        if (clean.includes('</think>')) {
          const parts = clean.split('</think>');
          if (thinkingBody) thinkingBody.textContent += parts[0].replace('<think>', '');
          isThinking = false;
          if (thinkingTimer) {
            clearInterval(thinkingTimer);
            thinkingTimer = null;
          }
          if (thinkingBadge) {
            thinkingBadge.textContent = 'Thought for ' + ((Date.now() - thinkingStartTime) / 1000).toFixed(1) + 's';
          }
          if (parts[1] && parts[1].trim()) {
            appendAssistantText(parts[1].trim());
          }
        } else {
          if (thinkingBody) thinkingBody.textContent += clean.replace('<think>', '');
        }
        scrollModernToBottom();
        return;
      }

      // Check if user input echo
      if (clean.startsWith('👤') || clean.startsWith('User:') || clean.startsWith('> ') || (clean.includes('Turn #') && clean.includes('User'))) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-bubble user';
        bubble.innerHTML = '<div class="chat-bubble-header"><span>👤 You</span></div><div class="chat-bubble-content">' + escapeHtml(clean) + '</div>';
        modernChat.appendChild(bubble);
        currentAssistantBubble = null;
        scrollModernToBottom();
        return;
      }

      // Check tool calls
      if (clean.includes('Running tool:') || clean.includes('Tool call:')) {
        const toolCard = document.createElement('div');
        toolCard.className = 'tool-card running';
        toolCard.textContent = '⚡ ' + clean.trim();
        modernChat.appendChild(toolCard);
        scrollModernToBottom();
        return;
      }

      if (clean.trim()) {
        appendAssistantText(clean);
      }
    }

    // Remote Device Stream Modal Handlers
    async function openRemoteStreamModal() {
      const modal = document.getElementById('remote-stream-modal');
      if (!modal) return;
      modal.classList.add('open');
      const qrDisplay = document.getElementById('qr-code-display');
      const linkInput = document.getElementById('remote-stream-link');
      const countEl = document.getElementById('remote-clients-count');
      try {
        const res = await fetch('/api/session/remote-stream');
        if (res.ok) {
          const data = await res.json();
          if (data.qrSvg && qrDisplay) {
            qrDisplay.innerHTML = data.qrSvg;
          }
          const link = data.primaryNetworkUrl || data.localUrl;
          if (linkInput) linkInput.value = link;
          if (countEl) countEl.textContent = (data.connectedClients || 1) + ' client(s) connected';
        }
      } catch (err) {
        if (qrDisplay) qrDisplay.innerHTML = '<span style="color:#ff7b72;font-size:11px;">Failed to load QR code</span>';
      }
    }

    function closeRemoteStreamModal() {
      const modal = document.getElementById('remote-stream-modal');
      if (modal) modal.classList.remove('open');
    }

    function copyRemoteStreamLink() {
      const input = document.getElementById('remote-stream-link');
      if (!input || !input.value) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(input.value).then(() => {
          alert('Secret streaming link copied to clipboard!');
        }).catch(() => {
          input.select();
          document.execCommand('copy');
          alert('Secret streaming link copied to clipboard!');
        });
      } else {
        input.select();
        document.execCommand('copy');
        alert('Secret streaming link copied to clipboard!');
      }
    }

    // Mobile Dock View Switcher
    function switchMobileView(view) {
      document.querySelectorAll('.mobile-dock-btn').forEach(btn => btn.classList.remove('active'));
      const activeBtn = document.getElementById('dock-' + view);
      if (activeBtn) activeBtn.classList.add('active');

      const leftPane = document.getElementById('left-pane');
      const rightPane = document.getElementById('right-pane');
      if (!leftPane || !rightPane) return;

      if (view === 'agent') {
        leftPane.classList.remove('mobile-hidden');
        rightPane.classList.add('mobile-hidden');
        switchLeftTab('agent');
      } else if (view === 'pty') {
        leftPane.classList.remove('mobile-hidden');
        rightPane.classList.add('mobile-hidden');
        switchLeftTab('pty');
      } else if (view === 'files') {
        leftPane.classList.add('mobile-hidden');
        rightPane.classList.remove('mobile-hidden');
        switchRightTab('files');
      } else if (view === 'diff') {
        leftPane.classList.add('mobile-hidden');
        rightPane.classList.remove('mobile-hidden');
        switchRightTab('diff');
      }
      notifyResize();
    }

    // Split Pane Resizer
    function initResizer() {
      const resizer = document.getElementById('pane-resizer');
      const leftPane = document.getElementById('left-pane');
      const rightPane = document.getElementById('right-pane');
      const workspace = document.getElementById('workspace');
      if (!resizer || !leftPane || !rightPane || !workspace) return;

      let isResizing = false;

      resizer.addEventListener('mousedown', () => {
        isResizing = true;
        resizer.classList.add('active');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      window.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const rect = workspace.getBoundingClientRect();
        const leftWidth = e.clientX - rect.left;
        const totalWidth = rect.width;
        if (leftWidth > 180 && totalWidth - leftWidth > 180) {
          const leftFlex = (leftWidth / (totalWidth - leftWidth)).toFixed(3);
          leftPane.style.flex = leftFlex;
          rightPane.style.flex = '1';
          notifyResize();
        }
      });

      window.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          resizer.classList.remove('active');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          notifyResize();
        }
      });
    }

    let lastGeneratedFileUrl = "";
    let lastGeneratedFilePath = "";

    const IMAGE_PROVIDER_MODELS = {
      auto: [
        { value: "", label: "Default (Provider cascade default)" },
      ],
      pollinations: [
        { value: "", label: "Default (Flux)" },
        { value: "flux", label: "Flux" },
        { value: "flux-realism", label: "Flux Realism" },
        { value: "turbo", label: "Turbo" },
        { value: "__custom__", label: "Custom model..." },
      ],
      openai: [
        { value: "", label: "Default (gpt-image-1)" },
        { value: "gpt-image-1", label: "GPT Image 1" },
        { value: "dall-e-3", label: "DALL-E 3" },
        { value: "dall-e-2", label: "DALL-E 2" },
        { value: "__custom__", label: "Custom model..." },
      ],
      together: [
        { value: "", label: "Default (FLUX.1-schnell)" },
        { value: "black-forest-labs/FLUX.1-schnell", label: "FLUX.1 Schnell" },
        { value: "black-forest-labs/FLUX.1-dev", label: "FLUX.1 Dev" },
        { value: "stabilityai/stable-diffusion-xl-base-1.0", label: "SDXL 1.0" },
        { value: "__custom__", label: "Custom model..." },
      ],
      openrouter: [
        { value: "", label: "Default (flux-3-image-klein)" },
        { value: "black-forest-labs/flux-3-image-klein", label: "Flux 3 Image Klein" },
        { value: "google/imagen-3", label: "Google Imagen 3" },
        { value: "stabilityai/stable-diffusion-3-medium", label: "SD 3 Medium" },
        { value: "__custom__", label: "Custom model..." },
      ],
      vercel: [
        { value: "", label: "Default (flux-2-klein-4b)" },
        { value: "bfl/flux-2-klein-4b", label: "Flux 2 Klein 4B" },
        { value: "__custom__", label: "Custom model..." },
      ],
      mock: [
        { value: "", label: "Default (Vector SVG)" },
      ],
    };

    function onImageGenProviderChange() {
      const provSelect = document.getElementById("imagegen-provider");
      const modelSelect = document.getElementById("imagegen-model");
      const customInput = document.getElementById("imagegen-custom-model");
      if (!provSelect || !modelSelect) return;
      const prov = provSelect.value || "auto";
      const models = IMAGE_PROVIDER_MODELS[prov] || [{ value: "", label: "Default (Provider default)" }];
      modelSelect.innerHTML = "";
      models.forEach(m => {
        const opt = document.createElement("option");
        opt.value = m.value;
        opt.textContent = m.label;
        modelSelect.appendChild(opt);
      });
      modelSelect.value = models[0] ? models[0].value : "";
      if (customInput) {
        customInput.value = "";
        customInput.style.display = "none";
      }
    }

    function onImageGenModelChange() {
      const modelSelect = document.getElementById("imagegen-model");
      const customInput = document.getElementById("imagegen-custom-model");
      if (!modelSelect || !customInput) return;
      if (modelSelect.value === "__custom__") {
        customInput.style.display = "block";
        customInput.focus();
      } else {
        customInput.style.display = "none";
      }
    }

    function openImageGenModal() {
      document.getElementById("image-gen-modal").classList.add("open");
      const input = document.getElementById("imagegen-prompt");
      if (input) setTimeout(() => input.focus(), 50);
    }

    function closeImageGenModal() {
      document.getElementById("image-gen-modal").classList.remove("open");
    }

    async function triggerImageGeneration() {
      const prompt = document.getElementById("imagegen-prompt").value.trim();
      const pathVal = document.getElementById("imagegen-path").value.trim();
      const sizeVal = document.getElementById("imagegen-size").value;
      const styleVal = document.getElementById("imagegen-style").value;
      const providerVal = (document.getElementById("imagegen-provider")?.value || "auto").trim();
      const modelSelectVal = document.getElementById("imagegen-model")?.value || "";
      let modelVal = modelSelectVal;
      if (modelSelectVal === "__custom__") {
        modelVal = (document.getElementById("imagegen-custom-model")?.value || "").trim();
      }
      const statusEl = document.getElementById("imagegen-status");
      const submitBtn = document.getElementById("imagegen-submit-btn");
      const previewEl = document.getElementById("imagegen-preview");
      const previewImg = document.getElementById("imagegen-preview-img");

      if (!prompt) {
        statusEl.style.display = "block";
        statusEl.style.background = "rgba(248, 81, 73, 0.15)";
        statusEl.style.color = "var(--red, #f85149)";
        statusEl.textContent = "Please enter a prompt description.";
        return;
      }

      statusEl.style.display = "block";
      statusEl.style.background = "rgba(88, 166, 255, 0.15)";
      statusEl.style.color = "var(--accent, #58a6ff)";
      statusEl.textContent = "⏳ Generating image asset across dispatch chain...";
      submitBtn.disabled = true;
      previewEl.style.display = "none";

      try {
        const res = await fetch("/api/generate-image", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            path: pathVal || undefined,
            size: sizeVal,
            style: styleVal || undefined,
            provider: providerVal !== "auto" ? providerVal : undefined,
            model: modelVal || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          throw new Error(data.error || "Failed to generate image");
        }

        const result = data.result;
        lastGeneratedFileUrl = data.fileUrl;
        lastGeneratedFilePath = result.path;

        if (result.placeholder) {
          statusEl.style.background = "rgba(210, 153, 34, 0.15)";
          statusEl.style.color = "var(--yellow, #d29922)";
          statusEl.textContent = "⚠ No image provider succeeded — saved a vector placeholder (" + result.width + "x" + result.height + ", " + result.sizeBytes + " bytes)" + (result.fallbackReasons && result.fallbackReasons.length ? "\\n" + result.fallbackReasons.join("; ") : "");
        } else {
          statusEl.style.background = "rgba(46, 160, 67, 0.15)";
          statusEl.style.color = "var(--green, #3fb950)";
          statusEl.textContent = "✓ Generated successfully via " + result.provider + " (" + result.width + "x" + result.height + ", " + result.format + ", " + result.sizeBytes + " bytes)";
        }
        statusEl.style.whiteSpace = "pre-wrap";
        if (data.undoNote) statusEl.textContent += "\\n(" + data.undoNote + ")";

        previewImg.src = data.fileUrl + "&t=" + Date.now();
        document.getElementById("imagegen-download-link").href = data.fileUrl;
        document.getElementById("imagegen-download-link").download = result.path.split("/").pop();
        previewEl.style.display = "block";

        if (typeof loadFiles === "function") loadFiles();
      } catch (err) {
        statusEl.style.background = "rgba(248, 81, 73, 0.15)";
        statusEl.style.color = "var(--red, #f85149)";
        statusEl.textContent = "Error: " + err.message;
      } finally {
        submitBtn.disabled = false;
      }
    }

    function openGeneratedInViewer() {
      if (lastGeneratedFilePath) {
        closeImageGenModal();
        openFile(lastGeneratedFilePath);
      }
    }

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
    let configuredHistoryBudget = 64000;
    let configuredMaxOutputTokens = 32768;
    let configuredMaxToolIters = 40;
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
      const themeConfig = THEMES[currentTheme] || THEMES['github-dark'];
      const activePalette = themeConfig.xterm;
      agentTerm = new Terminal({
        cursorBlink: false,
        disableStdin: true,
        fontSize: termFontSize,
        fontFamily: 'Consolas, "Fira Code", "Courier New", monospace',
        theme: {
          cursor: 'transparent',
          ...activePalette
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
          cursor: activePalette.green || '#3fb950',
          ...activePalette
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
        if (activeLeftTab === 'agent') {
          if (agentViewMode === 'terminal' && agentFit) agentFit.fit();
        } else if (ptyFit) {
          ptyFit.fit();
        }
        notifyResize();
      });
    }

    function switchLeftTab(tab) {
      activeLeftTab = tab;
      document.getElementById('tab-agent').classList.toggle('active', tab === 'agent');
      document.getElementById('tab-pty').classList.toggle('active', tab === 'pty');
      const toggleBar = document.querySelector('.view-mode-toggle-bar');
      if (toggleBar) toggleBar.style.display = tab === 'agent' ? 'flex' : 'none';

      const modernView = document.getElementById('modern-agent-view');
      const agentView = document.getElementById('agent-view');
      const ptyView = document.getElementById('pty-view');

      if (tab === 'agent') {
        if (ptyView) {
          ptyView.classList.remove('active');
          ptyView.style.display = 'none';
        }
        if (agentViewMode === 'modern') {
          if (modernView) modernView.classList.remove('hidden-view');
          if (agentView) {
            agentView.classList.remove('active');
            agentView.style.display = 'none';
          }
          scrollModernToBottom();
        } else {
          if (modernView) modernView.classList.add('hidden-view');
          if (agentView) {
            agentView.classList.add('active');
            agentView.style.display = 'block';
          }
          if (agentFit) agentFit.fit();
        }
        const chatInput = document.getElementById('chat-input');
        if (chatInput) chatInput.focus();
      } else {
        if (modernView) modernView.classList.add('hidden-view');
        if (agentView) {
          agentView.classList.remove('active');
          agentView.style.display = 'none';
        }
        if (ptyView) {
          ptyView.classList.add('active');
          ptyView.style.display = 'block';
        }
        if (ptyFit) ptyFit.fit();
        if (ptyTerm) ptyTerm.focus();
      }

      setTimeout(() => {
        if (tab === 'agent') {
          if (agentViewMode === 'terminal' && agentFit) agentFit.fit();
        } else {
          if (ptyFit) ptyFit.fit();
          if (ptyTerm) ptyTerm.focus();
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

    // A turn is "busy" between submit and the server's next status/turn_complete
    // frame. The server is the source of truth (status.busy, sent on turn start,
    // cancel and completion); the optimistic set below only covers the gap
    // before the first frame lands so Stop is clickable immediately.
    let agentBusy = false;
    function setAgentBusy(busy) {
      agentBusy = Boolean(busy);
      const btn = document.getElementById('stop-btn');
      if (btn) btn.style.display = agentBusy ? '' : 'none';
      const busyEl = document.getElementById('status-busy');
      if (busyEl) busyEl.style.display = agentBusy ? '' : 'none';
      const dot = document.getElementById('status-dot');
      if (dot && ws && ws.readyState === WebSocket.OPEN) {
        dot.style.background = agentBusy ? '#d29922' : '#3fb950';
      }
    }
    function stopAgentTurn() {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'cancel_turn' }));
      }
      setAgentBusy(false);
    }

    // --- Kill Server (stops the backend process, not just the turn) ---
    let serverShutdown = false;
    function openKillServerModal() {
      document.getElementById('kill-server-modal').classList.add('open');
      // Default focus to Cancel: the destructive action must be deliberate.
      document.getElementById('kill-server-cancel')?.focus();
    }
    function closeKillServerModal() {
      document.getElementById('kill-server-modal').classList.remove('open');
    }
    async function confirmKillServer() {
      const btn = document.getElementById('kill-server-confirm');
      if (btn) {
        btn.disabled = true;
        btn.textContent = 'Stopping…';
      }
      // Stop reconnecting before the socket drops so the UI never flashes
      // "Disconnected (Reconnecting...)" after an intentional shutdown.
      serverShutdown = true;
      /** True when the socket has dropped, i.e. the backend really is gone. */
      const socketDropped = () =>
        new Promise((resolve) => {
          if (!ws || ws.readyState === WebSocket.CLOSED) return resolve(true);
          const timer = setTimeout(() => resolve(ws.readyState === WebSocket.CLOSED), 2000);
          ws.addEventListener(
            'close',
            () => {
              clearTimeout(timer);
              resolve(true);
            },
            { once: true },
          );
        });
      try {
        const res = await fetch('/api/shutdown', { method: 'POST' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
      } catch (err) {
        // A lost reply usually means the process exited before it could answer;
        // that is success, not failure. Only report an error if we are still
        // connected afterwards.
        if (!(await socketDropped())) {
          serverShutdown = false;
          if (btn) {
            btn.disabled = false;
            btn.textContent = '⚠ Kill Server';
          }
          alert('Could not stop the server: ' + err.message);
          return;
        }
      }
      closeKillServerModal();
      const stopped = document.getElementById('server-stopped-overlay');
      if (stopped) stopped.style.display = 'flex';
      if (ws) ws.close();
    }
    // Client-side pre-flight linter: catch obvious credentials before they even
    // leave the browser, and tell the user they will be masked. The server is
    // still the enforcement point (loopback traffic is plaintext WebSocket), so
    // this is a warning, not the guarantee.
    // NOTE: this block lives inside a TS template literal, so every regex
    // backslash must be doubled or the browser receives a broken pattern.
    const CLIENT_SECRET_PATTERNS = [
      ['OpenAI key', /\\bsk-proj-[A-Za-z0-9_-]{15,}|\\bsk-[A-Za-z0-9]{30,}/],
      ['Anthropic key', /\\bsk-ant-[A-Za-z0-9_-]{15,}/],
      ['OpenRouter key', /\\bsk-or-v1-[A-Za-z0-9_-]{15,}/],
      ['Google key', /\\bAIza[0-9A-Za-z_-]{30,}/],
      ['AWS access key', /\\b(?:AKIA|ASIA)[0-9A-Z]{16}\\b/],
      ['GitHub token', /\\bgh[pousr]_[A-Za-z0-9]{20,}/],
      ['Slack token', /\\bxox[baprs]-[A-Za-z0-9-]{20,}/],
      ['Stripe key', /\\bsk_live_[A-Za-z0-9]{20,}/],
      ['Hugging Face token', /\\bhf_[A-Za-z0-9]{20,}/],
      ['Bearer token', /\\bBearer\\s+[A-Za-z0-9\\-._~+/]{16,}/],
      ['Connection password', /\\b(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?|redis|rediss|amqp|amqps):\\/\\/[^:\\s/@]+:[^@\\s/]+@/],
      ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
      ['Password flag', /(?:--password|--passwd|--api[-_]?key|--token|--secret)[=\\s]+[^\\s]{6,}/i],
    ];
    function lintSecrets(text) {
      const hits = [];
      for (const [label, re] of CLIENT_SECRET_PATTERNS) {
        if (re.test(text)) hits.push(label);
      }
      return hits;
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
      const isSlash = val.startsWith('/');
      if (!isSlash) {
        const hits = lintSecrets(val);
        if (hits.length > 0) {
          const ok = confirm(
            '🔒 Secret detected in your message: ' + hits.join(', ') + '\\n\\n' +
            'It will be replaced by a [MUGIL_SECRET_...] token before the model or any provider sees it. ' +
            'The real value stays in this process memory and is only used by local tools (run_command).\\n\\n' +
            'Send anyway?'
          );
          if (!ok) return;
        }
      }
      sendAgentCmd(val);
      input.value = '';
      if (!isSlash) setAgentBusy(true);
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
        setAgentBusy(false);
        document.getElementById('status-dot').style.background = '#ff7b72';
        if (serverShutdown) {
          document.getElementById('connection-status').textContent = 'Server stopped';
          return;
        }
        document.getElementById('connection-status').textContent = 'Disconnected (Reconnecting...)';
        setTimeout(connectWs, 2000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'agent_data') {
            agentTerm.write(msg.data);
            agentTerm.scrollToBottom();
            renderModernStreamChunk(msg.data);
          } else if (msg.type === 'pty_data') {
            ptyTerm.write(msg.data);
            ptyTerm.scrollToBottom();
          } else if (msg.type === 'turn_complete') {
            setAgentBusy(false);
            if (isThinking) {
              isThinking = false;
              if (thinkingTimer) {
                clearInterval(thinkingTimer);
                thinkingTimer = null;
              }
              const badge = document.getElementById('thinking-badge');
              if (badge) badge.textContent = 'Thought complete (' + Math.max(1, Math.round((Date.now() - thinkingStartTime) / 1000)) + 's)';
            }
            addTurnChip(msg.turn);
            refreshFiles();
          } else if (msg.type === 'dismiss_prompts') {
            // The turn was cancelled server-side; drop any prompt it was waiting on.
            if (pendingQuestionId != null) {
              pendingQuestionId = null;
              document.getElementById('question-modal').classList.remove('open');
            }
            if (pendingApprovalId != null) {
              pendingApprovalId = null;
              document.getElementById('approval-modal').classList.remove('open');
            }
            if (activeBreakpointId != null) {
              activeBreakpointId = null;
              document.getElementById('step-debugger-modal').classList.remove('open');
            }
          } else if (msg.type === 'tool_breakpoint') {
            showStepDebugger(msg);
          } else if (msg.type === 'question') {
            showQuestion(msg);
          } else if (msg.type === 'approval') {
            showApproval(msg);
          } else if (msg.type === 'status') {
            if (msg.busy !== undefined) setAgentBusy(msg.busy);
            if (msg.turboMode !== undefined) {
              updateTurboUI(msg.turboMode);
            }
            if (msg.stepDebuggerEnabled !== undefined) {
              updateDebuggerUI(msg.stepDebuggerEnabled);
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

              const saved = Number(msg.stats.tokensSaved) || 0;
              const kept = Number(msg.stats.compressibleTokens) || 0;
              const optSaved = Number(msg.stats.optimisticTokensSaved) || saved;
              const optPct = typeof msg.stats.optimisticSavingsPct === 'number'
                ? msg.stats.optimisticSavingsPct
                : (optSaved + kept > 0 ? Math.round((optSaved / (optSaved + kept)) * 100) : 0);
              const pct = typeof msg.stats.savingsPct === 'number'
                ? msg.stats.savingsPct
                : (saved + kept > 0 ? Math.round((saved / (saved + kept)) * 100) : 0);

              const bd = msg.stats.savingsBreakdown || { caveman: 0, yagni: 0, cache: 0, mcp: 0 };
              const formatK = (n) => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);

              const savingsPill = document.getElementById('token-savings');
              if (savingsPill) {
                savingsPill.textContent = 'Savings: ~' + optPct + '% (~' + formatK(optSaved) + ' tok)';
                savingsPill.title = 'Optimistic savings: ~' + optSaved.toLocaleString() + ' tok (~' + optPct + '% reduction) across Caveman, YAGNI, Cache, and MCP. Click for breakdown.';
              }

              const popTotal = document.getElementById('savings-popover-total');
              if (popTotal) popTotal.textContent = '~' + optSaved.toLocaleString() + ' tok';
              const spCaveman = document.getElementById('sp-caveman');
              if (spCaveman) spCaveman.textContent = (bd.caveman || 0).toLocaleString() + ' tok';
              const spYagni = document.getElementById('sp-yagni');
              if (spYagni) spYagni.textContent = (bd.yagni || 0).toLocaleString() + ' tok';
              const spCache = document.getElementById('sp-cache');
              if (spCache) spCache.textContent = (bd.cache || 0).toLocaleString() + ' tok';
              const spMcp = document.getElementById('sp-mcp');
              if (spMcp) spMcp.textContent = (bd.mcp || 0).toLocaleString() + ' tok';
              const spReal = document.getElementById('sp-real');
              if (spReal) spReal.textContent = saved.toLocaleString() + ' tok';
              const spRate = document.getElementById('sp-rate');
              if (spRate) spRate.textContent = '~' + optPct + '%';
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
          renderModernStreamChunk(event.data);
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

    function toggleSavingsPopover(e) {
      if (e) e.stopPropagation();
      const pop = document.getElementById('savings-popover');
      if (pop) pop.style.display = pop.style.display === 'none' ? 'block' : 'none';
    }

    document.addEventListener('click', (e) => {
      const dd = document.getElementById('header-menu-dropdown');
      const btn = document.getElementById('header-menu-btn');
      if (dd && dd.classList.contains('show')) {
        if (!dd.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
          dd.classList.remove('show');
        }
      }
      const tdd = document.getElementById('header-theme-dropdown');
      const tbtn = document.getElementById('header-theme-btn');
      if (tdd && tdd.classList.contains('show')) {
        if (!tdd.contains(e.target) && e.target !== tbtn && !tbtn.contains(e.target)) {
          tdd.classList.remove('show');
        }
      }
      const spPop = document.getElementById('savings-popover');
      const spPill = document.getElementById('token-savings');
      if (spPop && spPop.style.display === 'block') {
        if (!spPop.contains(e.target) && e.target !== spPill && !spPill.contains(e.target)) {
          spPop.style.display = 'none';
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
        const am = document.getElementById('approval-modal');
        const km = document.getElementById('kill-server-modal');
        const modalOpen = (qm && qm.classList.contains('open')) || (am && am.classList.contains('open')) || (km && km.classList.contains('open'));
        if (qm && qm.classList.contains('open')) dismissQuestion();
        if (am && am.classList.contains('open')) denyApproval();
        if (km && km.classList.contains('open')) closeKillServerModal();
        // Esc also stops the running turn — but never while a prompt/approval
        // modal owns the key, since there Esc means "dismiss".
        if (!modalOpen && agentBusy) stopAgentTurn();
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
    let dirPickerSelectedPath = null;

    async function openDirPicker(targetInputId) {
      dirPickerTargetInputId = targetInputId;
      dirPickerSelectedPath = null;
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
      dirPickerSelectedPath = null;
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
        dirPickerSelectedPath = null;

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
          // Deselect folder item when clicking background of list container
          listEl.onclick = (e) => {
            if (e.target === listEl) {
              dirPickerSelectedPath = null;
              const allRows = listEl.querySelectorAll('.dirpicker-folder-row');
              allRows.forEach(r => {
                r.style.background = 'transparent';
                r.style.borderColor = 'transparent';
                r.dataset.selected = 'false';
              });
              if (summaryEl) summaryEl.textContent = 'Selected: ' + dirPickerCurrentPath;
            }
          };

          if (!data.dirs || data.dirs.length === 0) {
            listEl.innerHTML = '<div style="color:var(--text-dim); text-align:center; padding:16px; font-size:11.5px;">(No subdirectories here)</div>';
          } else {
            data.dirs.forEach(d => {
              const row = document.createElement('div');
              row.className = 'dirpicker-folder-row';
              row.style.display = 'flex';
              row.style.alignItems = 'center';
              row.style.justifyContent = 'space-between';
              row.style.padding = '5px 8px';
              row.style.borderRadius = '4px';
              row.style.cursor = 'pointer';
              row.style.fontSize = '12px';
              row.style.color = 'var(--text)';
              row.style.border = '1px solid transparent';
              row.style.transition = 'background 0.1s, border-color 0.1s';
              row.title = 'Single click to select, double click to open';

              row.onmouseenter = () => {
                if (row.dataset.selected !== 'true') {
                  row.style.background = '#161b22';
                }
              };
              row.onmouseleave = () => {
                if (row.dataset.selected !== 'true') {
                  row.style.background = 'transparent';
                }
              };

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
              openBtn.title = 'Open this folder (or double-click)';
              openBtn.textContent = 'Open →';
              openBtn.onclick = (e) => {
                e.stopPropagation();
                navigateDirPicker(d.path);
              };
              row.appendChild(openBtn);

              // Single click selects the folder item
              row.onclick = () => {
                dirPickerSelectedPath = d.path;
                const allRows = listEl.querySelectorAll('.dirpicker-folder-row');
                allRows.forEach(r => {
                  r.style.background = 'transparent';
                  r.style.borderColor = 'transparent';
                  r.dataset.selected = 'false';
                });
                row.style.background = 'rgba(88, 166, 255, 0.15)';
                row.style.borderColor = 'var(--accent, #58a6ff)';
                row.dataset.selected = 'true';
                if (summaryEl) summaryEl.textContent = 'Selected: ' + d.path;
              };

              // Double click opens / navigates into the folder
              row.ondblclick = () => {
                navigateDirPicker(d.path);
              };

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
      const base = dirPickerSelectedPath || dirPickerCurrentPath;
      const sep = base.indexOf('/') >= 0 ? '/' : String.fromCharCode(92);
      const full = base.endsWith(sep) ? base + subName : base + sep + subName;
      const targetInput = document.getElementById(dirPickerTargetInputId);
      if (targetInput) targetInput.value = full;
      if (nameInp) nameInp.value = '';
      closeDirPicker();
    }

    function confirmDirPicker() {
      const chosen = dirPickerSelectedPath || dirPickerCurrentPath;
      const targetInput = document.getElementById(dirPickerTargetInputId);
      if (targetInput && chosen) {
        targetInput.value = chosen;
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
        const ext = f.path.split('.').pop().toLowerCase();
        const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);
        const isAud = ['mp3', 'wav', 'ogg'].includes(ext);
        const isVid = ['mp4', 'webm'].includes(ext);
        const icon = f.isDir ? '📁' : isImg ? '🖼️' : isAud ? '🎵' : isVid ? '🎬' : isModified ? '📝' : '📄';
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
      contentEl.style.whiteSpace = 'normal';
      contentEl.innerHTML = '<div style="color:var(--text-dim); padding:16px;">Loading file...</div>';
      try {
        const ext = filePath.split('.').pop().toLowerCase();
        const fileUrl = '/api/file?path=' + encodeURIComponent(filePath);
        if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext)) {
          contentEl.innerHTML = \`
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; min-height:300px; text-align:center;">
              <div style="margin-bottom:16px; border:1px solid var(--border); border-radius:8px; padding:12px; background:var(--bg-card); box-shadow:0 8px 24px rgba(0,0,0,0.3); max-width:100%; max-height:75vh; overflow:auto;">
                <img src="\${fileUrl}" alt="\${escapeHtml(filePath)}" style="max-width:100%; max-height:70vh; object-fit:contain; border-radius:4px; display:block;" />
              </div>
              <div style="display:flex; gap:16px; font-size:12px;">
                <a href="\${fileUrl}" target="_blank" style="color:var(--accent); text-decoration:none;">↗ Open in New Tab</a>
                <a href="\${fileUrl}" download="\${escapeHtml(filePath.split('/').pop())}" style="color:var(--accent); text-decoration:none;">⬇ Download Asset</a>
              </div>
            </div>\`;
          return;
        }
        if (['mp3', 'wav', 'ogg'].includes(ext)) {
          contentEl.innerHTML = \`
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; text-align:center;">
              <audio controls src="\${fileUrl}" style="width:100%; max-width:400px; margin-bottom:16px;"></audio>
              <a href="\${fileUrl}" download style="color:var(--accent); font-size:12px; text-decoration:none;">⬇ Download Audio</a>
            </div>\`;
          return;
        }
        if (['mp4', 'webm'].includes(ext)) {
          contentEl.innerHTML = \`
            <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:24px; text-align:center;">
              <video controls src="\${fileUrl}" style="max-width:100%; max-height:70vh; border-radius:8px; margin-bottom:16px;"></video>
              <a href="\${fileUrl}" download style="color:var(--accent); font-size:12px; text-decoration:none;">⬇ Download Video</a>
            </div>\`;
          return;
        }

        contentEl.style.whiteSpace = 'pre';
        const res = await fetch(fileUrl);
        if (res.ok) {
          const text = await res.text();
          contentEl.textContent = text;
        } else {
          contentEl.textContent = 'Error loading file: ' + res.statusText;
        }
      } catch (err) {
        contentEl.style.whiteSpace = 'pre';
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

          if (d.binary) {
            const row = document.createElement('div');
            row.style.cssText = 'padding:8px 12px; color:var(--text-dim);';
            row.textContent = 'Binary file changed — use the File Viewer to review it.';
            pre.appendChild(row);
          } else if (d.skipped) {
            // Oversized edit — the server skips the O(N·M) patch computation so
            // the request can't block. Point the user at the file viewer instead.
            const row = document.createElement('div');
            row.style.cssText = 'padding:8px 12px; color:var(--yellow);';
            row.textContent = 'File too large to diff — use the File Viewer to review changes.';
            pre.appendChild(row);
          } else {
            const lines = (d.patch || '').split(String.fromCharCode(10)).map(l => l.replace(String.fromCharCode(13), ''));
            lines.forEach((line, lineIdx) => {
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
                // A hunk payload is the header PLUS its body lines — the server
                // parses it back into a patch, so the header alone is useless.
                const hunkLines = [line];
                for (let k = lineIdx + 1; k < lines.length && !lines[k].startsWith('@@'); k++) hunkLines.push(lines[k]);
                const hunkPayload = hunkLines.join(String.fromCharCode(10));
                const hunkBar = document.createElement('div');
                hunkBar.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:3px 12px; background:#1f6feb15; border-top:1px solid #1f6feb33; border-bottom:1px solid #1f6feb33;';
                const headerText = document.createElement('span');
                headerText.style.cssText = 'color:var(--accent); font-weight:600; font-size:11px;';
                headerText.textContent = line;
                hunkBar.appendChild(headerText);

                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex; gap:6px;';
                const acceptBtn = document.createElement('button');
                acceptBtn.className = 'btn';
                acceptBtn.style.cssText = 'padding:1px 6px; font-size:10px; color:var(--green);';
                acceptBtn.textContent = '✓ Accept Hunk';
                acceptBtn.onclick = (e) => { e.stopPropagation(); applyHunk(d.rel, hunkPayload, false); };

                const revertBtn = document.createElement('button');
                revertBtn.className = 'btn';
                revertBtn.style.cssText = 'padding:1px 6px; font-size:10px; color:var(--red);';
                revertBtn.textContent = '↺ Revert Hunk';
                revertBtn.onclick = (e) => { e.stopPropagation(); applyHunk(d.rel, hunkPayload, true); };

                actions.appendChild(acceptBtn);
                actions.appendChild(revertBtn);
                hunkBar.appendChild(actions);
                pre.appendChild(hunkBar);
                return;
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

    function openWelcomeModal() {
      document.getElementById('welcome-modal').classList.add('open');
      const st = document.getElementById('welcome-local-status');
      if (st) st.style.display = 'none';
    }
    function closeWelcomeModal() {
      document.getElementById('welcome-modal').classList.remove('open');
      checkConfiguredProviders();
      populateSetupModels();
      if (!sessionStorage.getItem('mugil_session_configured')) {
        openSessionSetupModal();
      }
    }

    async function saveWelcomeCloudKey() {
      const select = document.getElementById('welcome-provider-select');
      const input = document.getElementById('welcome-key-input');
      const keyVal = input ? input.value.trim() : '';
      if (!keyVal) {
        alert('Please paste an API key');
        return;
      }
      const [provider, keyVar] = (select.value || 'openrouter|OPENROUTER_API_KEY').split('|');
      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, keyVar, value: keyVal }),
        });
        if (res.ok) {
          alert('Saved ' + provider + ' API key successfully!');
          closeWelcomeModal();
          await loadModels();
          populateSetupModels();
        } else {
          const err = await res.json();
          alert('Failed to save key: ' + (err.error || res.statusText));
        }
      } catch (e) {
        alert('Error saving API key: ' + e.message);
      }
    }

    async function testAndSaveLocalAi(provider, defaultUrl) {
      const st = document.getElementById('welcome-local-status');
      if (st) {
        st.style.display = 'block';
        st.style.color = 'var(--text-dim)';
        st.textContent = 'Probing ' + provider + ' at ' + defaultUrl + '...';
      }
      const baseVar = provider === 'ollama' ? 'OLLAMA_BASE_URL' : 'LMSTUDIO_BASE_URL';
      try {
        const res = await fetch('/api/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, baseVar, baseUrl: defaultUrl }),
        });
        if (res.ok) {
          if (st) {
            st.style.color = 'var(--green)';
            st.textContent = '✓ Connected to ' + provider + '! Updating models...';
          }
          await loadModels();
          populateSetupModels();
          setTimeout(() => closeWelcomeModal(), 900);
        } else {
          const err = await res.json();
          if (st) {
            st.style.color = 'var(--red)';
            st.textContent = '⚠ ' + (err.error || 'Failed to connect');
          }
        }
      } catch (e) {
        if (st) {
          st.style.color = 'var(--red)';
          st.textContent = '⚠ Connection failed: ' + e.message;
        }
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
      checkConfiguredProviders();
      populateSetupModels();
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
          checkConfiguredProviders();
          populateSetupModels();
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
      if (b === 32000 && o === 8192 && i === 10 && t === 20) {
        highlightPresetButton('light');
      } else if (b === 64000 && o === 32768 && i === 25 && t === 50) {
        highlightPresetButton('deep');
      } else if (b === 128000 && o === 65536 && i === 60 && t === 100) {
        highlightPresetButton('big');
      } else {
        highlightPresetButton(null);
      }
    }

    function applyWorkloadPreset(preset) {
      let budget = 64000, output = 32768, iters = 40, turns = 100;
      if (preset === 'light') {
        budget = 32000; output = 8192; iters = 10; turns = 20;
      } else if (preset === 'deep') {
        budget = 64000; output = 32768; iters = 25; turns = 50;
      } else if (preset === 'big') {
        budget = 128000; output = 65536; iters = 60; turns = 100;
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
      setField('max-turns', maxTurnsEl ? Number(maxTurnsEl.value) || 100 : 100);

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
      const historyBudget = Number(budgetInput ? budgetInput.value : 64000) || 64000;
      const maxOutput = Number(maxOutputInput ? maxOutputInput.value : 32768) || 32768;

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
      const budget = Number(document.getElementById('setup-history-budget').value) || 64000;
      const maxOutput = Number(document.getElementById('setup-max-output').value) || 32768;
      const maxToolIters = Number(document.getElementById('setup-max-tool-iters')?.value || 40);
      const maxTurns = Number(document.getElementById('setup-max-turns')?.value || 100);
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

    let hasConfiguredProviders = false;

    async function checkConfiguredProviders() {
      try {
        const res = await fetch('/api/keys');
        if (res.ok) {
          const data = await res.json();
          const configured = (data.providers || []).some(p => p.isConfigured);
          hasConfiguredProviders = configured || (availableLocalModels && availableLocalModels.length > 0);
          const banner = document.getElementById('setup-no-keys-banner');
          if (banner) {
            banner.style.display = hasConfiguredProviders ? 'none' : 'block';
          }
          return hasConfiguredProviders;
        }
      } catch (e) {
        // ignore
      }
      return false;
    }

    /** Header badge: shows when npm has a newer mugil-ide than this build. */
    async function checkForAppUpdate() {
      try {
        const res = await fetch('/api/update-check');
        if (!res.ok) return;
        const data = await res.json();
        if (!data || !data.updateAvailable) return;
        const badge = document.getElementById('version-update');
        if (!badge) return;
        badge.textContent = '⬆ v' + data.latest;
        badge.title = 'Update available: v' + data.current + ' → v' + data.latest + ' — run: npm install -g mugil-ide@latest';
        badge.setAttribute('aria-label', badge.title);
        if (data.releaseUrl) badge.href = data.releaseUrl;
        badge.style.display = 'inline-flex';
      } catch {
        // Offline or registry unreachable — no badge.
      }
    }

    let currentStepDebugger = false;
    let activeBreakpointId = null;

    async function applyHunk(relPath, hunkPayload, revert) {
      try {
        const res = await fetch('/api/diff/hunk-apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: relPath, hunk: hunkPayload, revert }),
        });
        const data = await res.json();
        if (!res.ok || data.applied === false) {
          // Say so instead of silently doing nothing: a stale hunk no longer
          // matching the file is the common case here.
          console.warn('Hunk not applied:', data.error || data.note || 'no match');
          return;
        }
        loadDiffs();
      } catch (err) {
        console.error('Failed to apply hunk:', err);
      }
    }

    function updateDebuggerUI(enabled) {
      currentStepDebugger = Boolean(enabled);
      const btn = document.getElementById('debugger-toggle');
      const label = document.getElementById('debugger-label');
      if (btn && label) {
        if (currentStepDebugger) {
          btn.style.borderColor = 'var(--cyan)';
          btn.style.color = 'var(--cyan)';
          label.textContent = 'Debugger: ON';
        } else {
          btn.style.borderColor = '';
          btn.style.color = '';
          label.textContent = 'Debugger: Off';
        }
      }
    }

    function toggleStepDebugger() {
      const next = !currentStepDebugger;
      updateDebuggerUI(next);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'set_step_debugger', enabled: next }));
      }
      fetch('/api/debugger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      }).catch(() => {});
    }

    function showStepDebugger(msg) {
      activeBreakpointId = msg.id;
      const toolName = msg.call ? msg.call.name : (msg.name || 'tool');
      const argsText = msg.call
        ? (typeof msg.call.arguments === 'string'
            ? msg.call.arguments
            : JSON.stringify(msg.call.arguments, null, 2))
        : '{}';

      document.getElementById('debugger-tool-name').textContent = toolName;
      document.getElementById('debugger-timestamp').textContent = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
      document.getElementById('debugger-args-textarea').value = argsText;

      document.getElementById('step-debugger-modal').classList.add('open');
    }

    function sendStepDebuggerAction(action) {
      if (!activeBreakpointId) {
        document.getElementById('step-debugger-modal').classList.remove('open');
        return;
      }
      const bpId = activeBreakpointId;
      activeBreakpointId = null;
      document.getElementById('step-debugger-modal').classList.remove('open');

      const modifiedArgs = document.getElementById('debugger-args-textarea').value;

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'step_debugger_action',
          id: bpId,
          action,
          modifiedArguments: action === 'edit' ? modifiedArgs : undefined,
          skipOutput: action === 'skip' ? 'Skipped by developer in Step Debugger' : undefined,
        }));
      }

      fetch('/api/debugger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: bpId,
          action,
          modifiedArguments: action === 'edit' ? modifiedArgs : undefined,
          skipOutput: action === 'skip' ? 'Skipped by developer in Step Debugger' : undefined,
        }),
      }).catch(() => {});
    }

    function openExtensionsModal() {
      document.getElementById('extensions-modal').classList.add('open');
      loadSkills();
      loadGallery();
    }
    let skillsCache = [];
    function escHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    }
    async function loadSkills() {
      const list = document.getElementById('skill-list');
      if (!list) return;
      try {
        const res = await fetch('/api/skills');
        const data = await res.json();
        skillsCache = Array.isArray(data.skills) ? data.skills : [];
        renderSkills();
      } catch (err) {
        list.innerHTML = '<div style="color:var(--red); font-size:11.5px; padding:12px;">Failed to load skills: ' + escHtml(err.message) + '</div>';
      }
    }
    function renderSkills() {
      const list = document.getElementById('skill-list');
      const tab = document.getElementById('exttab-skills');
      const enabled = skillsCache.filter((s) => s.enabled).length;
      if (tab) tab.textContent = 'Agent Skills (' + skillsCache.length + ')';
      if (!list) return;
      if (skillsCache.length === 0) {
        list.innerHTML = '<div style="color:var(--text-dim); font-size:11.5px; padding:12px; border:1px dashed var(--border); border-radius:6px; text-align:center;">No skills found. Create one with <b>✨ New Skill</b> or add <code>.mugil/skills/&lt;name&gt;/SKILL.md</code>.</div>';
        return;
      }
      list.innerHTML = skillsCache.map((skill) => {
        const badgeColor = skill.source === 'workspace' ? '#23863633' : skill.source === 'global' ? '#1f6feb33' : '#8957e533';
        const badgeText = skill.source === 'workspace' ? 'Workspace' : skill.source === 'global' ? 'Global' : 'Built-in';
        const stateStyle = skill.enabled
          ? 'background:#23863633; color:var(--green);'
          : 'background:#6e768133; color:var(--text-dim);';
        const assets = [];
        if (skill.hasScripts) assets.push('📜 scripts');
        if (skill.hasReferences) assets.push('📚 references');
        return '<div style="border:1px solid var(--border); border-radius:6px; padding:12px; background:#161b22;">'
          + '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">'
          + '<strong style="font-size:12.5px;">' + escHtml(skill.name) + '</strong>'
          + '<div style="display:flex; gap:6px; align-items:center;">'
          + '<span style="font-size:10px; padding:2px 8px; border-radius:10px; font-weight:bold; ' + badgeColor + '; color:var(--text);">' + badgeText + '</span>'
          + '<span style="font-size:10px; padding:2px 8px; border-radius:10px; font-weight:bold; ' + stateStyle + '">' + (skill.enabled ? 'Active' : 'Off') + '</span>'
          + '</div></div>'
          + '<p style="font-size:11.5px; color:var(--text-dim); margin:6px 0 0 0;">' + escHtml(skill.description) + '</p>'
          + (assets.length ? '<div style="font-size:10.5px; color:var(--text-dim); margin-top:6px;">' + assets.join(' · ') + '</div>' : '')
          + '<div style="display:flex; gap:6px; margin-top:8px;">'
          + '<button class="btn" style="font-size:10.5px; padding:2px 8px;" data-skill="' + escHtml(skill.name) + '" onclick="viewSkill(this.dataset.skill)">View Instructions</button>'
          + '<button class="btn" style="font-size:10.5px; padding:2px 8px;" data-skill="' + escHtml(skill.name) + '" onclick="toggleSkill(this.dataset.skill)">' + (skill.enabled ? 'Disable' : 'Enable') + '</button>'
          + (skill.source === 'builtin' ? ''
            : '<button class="btn" style="font-size:10.5px; padding:2px 8px; color:var(--red);" data-skill="' + escHtml(skill.name) + '" data-source="' + escHtml(skill.source) + '" onclick="uninstallSkillFromUi(this.dataset.skill, this.dataset.source)">🗑 Uninstall</button>')
          + '</div></div>';
      }).join('')
        + '<div style="font-size:10.5px; color:var(--text-dim); text-align:center;">' + enabled + ' of ' + skillsCache.length + ' skills active for this workspace.</div>';
    }
    async function toggleSkill(name) {
      try {
        const res = await fetch('/api/skills/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        await loadSkills();
      } catch (err) {
        alert('Could not toggle skill: ' + err.message);
      }
    }
    async function uninstallSkillFromUi(name, source) {
      const tier = source === 'global' ? 'global' : 'workspace';
      if (!confirm('Uninstall "' + name + '" from the ' + tier + ' tier?\\n\\nIts directory and files will be deleted.')) return;
      try {
        const res = await fetch('/api/skills/' + encodeURIComponent(name) + '?target=' + tier, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        await loadSkills();
        await loadGallery();
      } catch (err) {
        alert('Could not uninstall skill: ' + err.message);
      }
    }
    async function viewSkill(name) {
      try {
        const res = await fetch('/api/skills/' + encodeURIComponent(name));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        document.getElementById('skill-viewer-title').textContent = name + ' — ' + data.skill.source;
        const scripts = (data.assets && data.assets.scripts) || [];
        const references = (data.assets && data.assets.references) || [];
        const assets = scripts.map((f) => '  scripts/' + f).concat(references.map((f) => '  references/' + f));
        document.getElementById('skill-viewer-body').textContent =
          (assets.length ? 'Assets:\\n' + assets.join('\\n') + '\\n\\n' : '') + data.content;
        document.getElementById('skill-viewer').style.display = 'block';
      } catch (err) {
        alert('Could not load skill: ' + err.message);
      }
    }
    function closeSkillViewer() {
      document.getElementById('skill-viewer').style.display = 'none';
    }
    function openSkillCreate() {
      document.getElementById('skill-create-modal').classList.add('open');
    }
    function closeSkillCreate() {
      document.getElementById('skill-create-modal').classList.remove('open');
    }
    async function submitSkillCreate() {
      const name = document.getElementById('skill-create-name').value.trim();
      const description = document.getElementById('skill-create-desc').value.trim();
      const triggers = document.getElementById('skill-create-triggers').value.trim();
      const source = document.getElementById('skill-create-source').value;
      const errBox = document.getElementById('skill-create-error');
      errBox.style.display = 'none';
      if (!name) {
        errBox.textContent = 'Skill name is required.';
        errBox.style.display = 'block';
        return;
      }
      try {
        const res = await fetch('/api/skills/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            description: description || undefined,
            source,
            triggers: triggers ? triggers.split(',').map((t) => t.trim()).filter(Boolean) : [],
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        closeSkillCreate();
        document.getElementById('skill-create-name').value = '';
        document.getElementById('skill-create-desc').value = '';
        document.getElementById('skill-create-triggers').value = '';
        await loadSkills();
        await viewSkill(name);
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      }
    }

    function closeExtensionsModal() {
      document.getElementById('extensions-modal').classList.remove('open');
    }

    function switchExtTab(tab) {
      const skillsPane = document.getElementById('ext-skills-pane');
      const galleryPane = document.getElementById('ext-gallery-pane');
      const mcpPane = document.getElementById('ext-mcp-pane');
      const btnSkills = document.getElementById('exttab-skills');
      const btnGallery = document.getElementById('exttab-gallery');
      const btnMcp = document.getElementById('exttab-mcp');

      if (skillsPane) skillsPane.style.display = tab === 'skills' ? 'flex' : 'none';
      if (galleryPane) galleryPane.style.display = tab === 'gallery' ? 'flex' : 'none';
      if (mcpPane) mcpPane.style.display = tab === 'mcp' ? 'flex' : 'none';

      if (btnSkills) btnSkills.classList.toggle('active', tab === 'skills');
      if (btnGallery) btnGallery.classList.toggle('active', tab === 'gallery');
      if (btnMcp) btnMcp.classList.toggle('active', tab === 'mcp');
    }

    let galleryCache = [];
    let activeGalleryCategory = 'all';

    async function loadGallery() {
      const list = document.getElementById('gallery-list');
      if (!list) return;
      try {
        const res = await fetch('/api/skills/gallery');
        const data = await res.json();
        galleryCache = Array.isArray(data.gallery) ? data.gallery : [];
        const tab = document.getElementById('exttab-gallery');
        if (tab) tab.textContent = 'Skills Gallery (' + galleryCache.length + ')';
        renderGallery();
      } catch (err) {
        list.innerHTML = '<div style="color:var(--red); font-size:11.5px; padding:12px;">Failed to load gallery: ' + escHtml(err.message) + '</div>';
      }
    }

    function switchGalleryCategory(cat) {
      activeGalleryCategory = cat;
      const chips = document.querySelectorAll('#gallery-categories button');
      chips.forEach((btn) => {
        btn.classList.toggle('btn-primary', btn.id === ('cat-' + (cat === 'Git & Workflow' ? 'git' : cat === 'Business Logic' ? 'business' : cat.toLowerCase())));
      });
      renderGallery();
    }

    function filterGallery() {
      renderGallery();
    }

    function renderGallery() {
      const list = document.getElementById('gallery-list');
      if (!list) return;
      const q = (document.getElementById('gallery-search')?.value || '').toLowerCase().trim();

      let items = galleryCache;
      if (activeGalleryCategory !== 'all') {
        items = items.filter((s) => s.category.toLowerCase() === activeGalleryCategory.toLowerCase());
      }
      if (q) {
        items = items.filter((s) =>
          s.name.toLowerCase().includes(q)
          || s.description.toLowerCase().includes(q)
          || (s.tags && s.tags.some((t) => t.toLowerCase().includes(q)))
          || s.author.toLowerCase().includes(q)
        );
      }

      if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--text-dim); font-size:11.5px; padding:16px; text-align:center;">No matching gallery skills found.</div>';
        return;
      }

      list.innerHTML = items.map((item) => {
        const installedBadge = item.installed
          ? '<span style="font-size:10px; padding:2px 8px; border-radius:10px; font-weight:bold; background:#23863633; color:var(--green);">✓ Installed (' + escHtml(item.installedTarget || 'workspace') + ')</span>'
          : '<span style="font-size:10px; padding:2px 8px; border-radius:10px; font-weight:bold; background:#1f6feb22; color:var(--accent);">Ready to Pick</span>';

        return '<div style="border:1px solid var(--border); border-radius:6px; padding:12px; background:#161b22; display:flex; flex-direction:column; gap:6px;">'
          + '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">'
          + '<div><strong style="font-size:12.5px;">' + escHtml(item.name) + '</strong> <span style="font-size:10.5px; color:var(--text-dim);">(' + escHtml(item.id) + ')</span></div>'
          + '<div style="display:flex; gap:6px; align-items:center;">'
          + '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#30363d; color:var(--text-dim);">' + escHtml(item.category) + '</span>'
          + installedBadge
          + '</div></div>'
          + '<p style="font-size:11.5px; color:var(--text-dim); margin:2px 0;">' + escHtml(item.description) + '</p>'
          + '<div style="font-size:10.5px; color:var(--text-dim); display:flex; gap:12px; flex-wrap:wrap;">'
          + '<span>👤 <b>' + escHtml(item.author) + '</b></span>'
          + '<span>⚖️ <b>' + escHtml(item.license) + '</b></span>'
          + '<a href="' + escHtml(item.upstreamUrl) + '" target="_blank" style="color:var(--accent); text-decoration:none;">↗ Upstream Source</a>'
          + '</div>'
          + '<div style="display:flex; gap:6px; margin-top:6px;">'
          + '<button class="btn" style="font-size:10.5px; padding:3px 8px;" onclick="previewGallerySkill(\\'' + escHtml(item.id) + '\\')">Preview Instructions</button>'
          + '<button class="btn btn-primary" style="font-size:10.5px; padding:3px 8px;" onclick="installGallerySkill(\\'' + escHtml(item.id) + '\\', \\'workspace\\')">📥 Install to Workspace</button>'
          + '<button class="btn" style="font-size:10.5px; padding:3px 8px;" onclick="installGallerySkill(\\'' + escHtml(item.id) + '\\', \\'global\\')">🌐 Install Globally</button>'
          + '</div></div>';
      }).join('');
    }

    async function previewGallerySkill(id) {
      const item = galleryCache.find((s) => s.id === id);
      if (!item) return;
      document.getElementById('skill-viewer-title').textContent = item.name + ' (' + item.id + ') — Gallery Preview';
      document.getElementById('skill-viewer-body').textContent = 'Loading…';
      document.getElementById('skill-viewer').style.display = 'block';
      document.getElementById('skill-viewer').scrollIntoView({ behavior: 'smooth' });
      try {
        // Bodies are not in the list payload (that would ship every SKILL.md
        // on every gallery open) — fetch the one being previewed.
        const res = await fetch('/api/skills/gallery/' + encodeURIComponent(id));
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        document.getElementById('skill-viewer-body').textContent = data.skill.content;
        item.content = data.skill.content;
      } catch (err) {
        document.getElementById('skill-viewer-body').textContent = 'Could not load preview: ' + err.message;
      }
    }

    async function installGallerySkill(id, target) {
      const existing = galleryCache.find((s) => s.id === id);
      // Re-installing replaces the SKILL.md (and any local edits) — ask first.
      const overwrite = existing && existing.installed
        ? confirm('"' + id + '" is already installed (' + (existing.installedTarget || 'workspace') + ').\\n\\nReinstall and replace its SKILL.md? Local edits will be lost.')
        : false;
      if (existing && existing.installed && !overwrite) return;
      try {
        const res = await fetch('/api/skills/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'gallery', source: id, target, overwrite }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        alert('✓ ' + (data.result?.message || 'Skill installed successfully!'));
        await loadSkills();
        await loadGallery();
      } catch (err) {
        alert('Could not install skill: ' + err.message);
      }
    }

    function openSkillInstallModal() {
      document.getElementById('skill-install-modal').classList.add('open');
      document.getElementById('skill-install-error').style.display = 'none';
    }

    function closeSkillInstallModal() {
      document.getElementById('skill-install-modal').classList.remove('open');
    }

    async function submitCustomSkillInstall() {
      const source = document.getElementById('skill-install-source').value.trim();
      const name = document.getElementById('skill-install-name').value.trim();
      const target = document.getElementById('skill-install-target').value;
      const overwrite = document.getElementById('skill-install-force').checked;
      const errBox = document.getElementById('skill-install-error');
      const submitBtn = document.getElementById('skill-install-submit-btn');

      errBox.style.display = 'none';
      if (!source) {
        errBox.textContent = 'Please enter a repository URL, raw SKILL.md URL, or folder path.';
        errBox.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Installing…';

      try {
        const res = await fetch('/api/skills/install', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: source.startsWith('http') ? 'url' : 'path',
            source,
            name: name || undefined,
            target,
            overwrite,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
        closeSkillInstallModal();
        document.getElementById('skill-install-source').value = '';
        document.getElementById('skill-install-name').value = '';
        alert('✓ ' + (data.result?.message || 'Custom skill installed successfully!'));
        await loadSkills();
        await loadGallery();
      } catch (err) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '📥 Install Skill';
      }
    }

    // Credits Modal
    let creditsCache = null;
    let activeCreditsTab = 'skills';

    function openCreditsModal() {
      document.getElementById('credits-modal').classList.add('open');
      loadCredits();
    }

    function closeCreditsModal() {
      document.getElementById('credits-modal').classList.remove('open');
    }

    async function loadCredits() {
      const container = document.getElementById('credits-container');
      if (!container) return;
      try {
        const res = await fetch('/api/credits');
        creditsCache = await res.json();
        renderCredits();
      } catch (err) {
        container.innerHTML = '<div style="color:var(--red); font-size:11.5px; padding:12px;">Failed to load credits: ' + escHtml(err.message) + '</div>';
      }
    }

    function switchCreditsTab(tab) {
      activeCreditsTab = tab;
      const btnSkills = document.getElementById('credtab-skills');
      const btnModules = document.getElementById('credtab-modules');
      const btnLibs = document.getElementById('credtab-libraries');
      if (btnSkills) btnSkills.classList.toggle('active', tab === 'skills');
      if (btnModules) btnModules.classList.toggle('active', tab === 'modules');
      if (btnLibs) btnLibs.classList.toggle('active', tab === 'libraries');
      renderCredits();
    }

    function filterCredits() {
      renderCredits();
    }

    function renderCredits() {
      const container = document.getElementById('credits-container');
      if (!container || !creditsCache) return;

      const q = (document.getElementById('credits-search')?.value || '').toLowerCase().trim();
      let records = [];
      if (activeCreditsTab === 'skills') records = creditsCache.skills || [];
      else if (activeCreditsTab === 'modules') records = creditsCache.coreModules || [];
      else if (activeCreditsTab === 'libraries') records = creditsCache.libraries || [];

      if (q) {
        records = records.filter((r) =>
          r.name.toLowerCase().includes(q)
          || r.author.toLowerCase().includes(q)
          || r.license.toLowerCase().includes(q)
          || (r.concept && r.concept.toLowerCase().includes(q))
        );
      }

      if (records.length === 0) {
        container.innerHTML = '<div style="color:var(--text-dim); font-size:11.5px; padding:16px; text-align:center;">No matching attribution records found.</div>';
        return;
      }

      container.innerHTML = records.map((r) => {
        const instBadge = r.installed ? '<span style="font-size:10px; padding:2px 8px; border-radius:10px; font-weight:bold; background:#23863633; color:var(--green);">✓ Installed</span>' : '';
        return '<div style="border:1px solid var(--border); border-radius:6px; padding:12px; background:#161b22; display:flex; flex-direction:column; gap:4px;">'
          + '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">'
          + '<strong style="font-size:12.5px;">' + escHtml(r.name) + '</strong>'
          + '<div style="display:flex; gap:6px; align-items:center;">'
          + '<span style="font-size:10px; padding:2px 6px; border-radius:8px; background:#30363d; color:var(--text); font-weight:600;">' + escHtml(r.license) + '</span>'
          + instBadge
          + '</div></div>'
          + '<p style="font-size:11.5px; color:var(--text-dim); margin:2px 0;">' + escHtml(r.concept || '') + '</p>'
          + '<div style="display:flex; justify-content:space-between; align-items:center; font-size:11px; margin-top:4px;">'
          + '<span style="color:var(--text-dim);">Creator / Project: <b style="color:var(--text);">' + escHtml(r.author) + '</b></span>'
          + '<a href="' + escHtml(r.upstreamUrl) + '" target="_blank" style="color:var(--accent); text-decoration:none; font-weight:500;">↗ Upstream Repository</a>'
          + '</div></div>';
      }).join('');
    }

    window.onload = async () => {
      initTerminals();
      setTheme(currentTheme);
      initResizer();
      switchAgentViewMode(agentViewMode);
      void checkForAppUpdate();
      connectWs();
      await loadModels();
      await loadConfigLimits();
      refreshFiles();
      const anyKeys = await checkConfiguredProviders();
      if (!sessionStorage.getItem('mugil_session_configured')) {
        if (!anyKeys && availableLocalModels.length === 0) {
          openWelcomeModal();
        } else {
          openSessionSetupModal();
        }
      }
      const chatInput = document.getElementById('chat-input');
      if (chatInput) chatInput.focus();
    };
  </script>
</body>
</html>`;
}
