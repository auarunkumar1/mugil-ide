import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo } from "solid-js"

const id = "internal:home-credits"

/** Full attributed list — keep in sync with ATTRIBUTIONS.md at the repo root. */
export const CREDITS = `✦ Mugil IDE — Credited Open Source Modules & Repositories:

• OpenCode Core:     https://github.com/sst/opencode (MIT)
  Forked TUI + agent runtime (v1.18.18) — vendor/opencode/ (docs/opencode-fork.md)
• Caveman:           https://github.com/JuliusBrussee/caveman
• RTK:               https://github.com/rtk-ai/rtk
• Ponytail:          https://github.com/DietrichGebert/ponytail
• CodeGraph:         https://github.com/colbymchenry/codegraph
• Watermark Remover: https://github.com/guillaumemeyer/watermarks-remover
• Signature Remover: https://github.com/conorbronsdon/avoid-ai-writing
• Tool Loop:         https://modelcontextprotocol.io
• Agent Skills:      https://github.com/anthropics/anthropic-tools
• MCP Client:        https://modelcontextprotocol.io
• Web Search (Exa):  https://mcp.exa.ai/mcp
• LSP Client:        https://microsoft.github.io/language-server-protocol`

function View(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current
  const line = createMemo(
    () => `✦ Mugil IDE — OpenCode core (MIT) · Caveman · RTK · Ponytail · Watermark Remover · CodeGraph`,
  )
  return (
    <box width="100%" maxWidth={75} alignItems="center" flexShrink={0}>
      <text fg={theme().textMuted}>{line()}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 200,
    slots: {
      home_bottom() {
        return <View api={api} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
