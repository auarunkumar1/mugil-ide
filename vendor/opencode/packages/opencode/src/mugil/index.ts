/**
 * MUGIL ADDONS — grafted engine modules for the OpenCode fork
 * ============================================================
 * Self-contained port of the `@mugil-ide/core` credited modules so they run
 * inside OpenCode's session pipeline without any cross-package imports.
 * Rule data is loaded from `./rules/*.json` (copied from the mugil repo).
 *
 * Pipeline wiring (see docs/opencode-fork.md):
 *   - pre-request   : `mugilPreprocess`  (signature-remover → caveman → rtk)
 *                     applied to the current user message in session/prompt.ts
 *   - system prompt : `mugilSystemInstruction` (ponytail output minimization)
 *                     appended to the system array in session/prompt.ts
 *   - post-generation: `mugilPostprocess` (watermark-remover + code signature
 *                     stripping) applied to assistant text on `text-end` in
 *                     session/processor.ts
 *
 * All transforms are a no-op when `MUGIL_IDE_ADDONS=0`.
 *
 * Credits (see ATTRIBUTIONS.md in the mugil repo):
 *   - Signature Remover — Anthropic / OpenAI message-format & identity
 *     preamble removal; community "de-AI" code tooling (avoid-ai-writing,
 *     remove-ai-watermarks).
 *   - Caveman — JuliusBrussee/caveman (MIT), terse prompt phrasing.
 *   - RTK — rtk-ai/rtk, reduced token kernel (boilerplate + dedupe).
 *   - Ponytail — DietrichGebert/ponytail, output minimization instruction.
 *   - Watermark Remover — guillaumemeyer/watermarks-remover, deterministic
 *     Layer A unicode/vendor watermark stripping.
 */

import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const ENABLED = process.env.MUGIL_IDE_ADDONS !== "0"

// ---------------------------------------------------------------------------
// Rule loading (static copies; the mugil repo's runtime-update machinery is
// out of scope for the fork).
// ---------------------------------------------------------------------------

function loadRules<T>(name: string): T {
  const url = new URL(`./rules/${name}.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as T
}

interface PhraseRule {
  pattern: string
  flags?: string
  replacement: string
}

interface CavemanRules {
  phrases: PhraseRule[]
  filler: string
  fillerFlags?: string
  polite: string
  politeFlags?: string
}

interface RtkRules {
  boilerplate: { pattern: string; flags?: string }
  intro: { pattern: string; flags?: string }
}

interface PonytailRules {
  preamble: string
  ladder: string[]
  safety: string
}

interface SignatureRuleSpec {
  provider: string
  label: string
  pattern: string
  flags?: string
}

interface SignatureRules {
  rules: SignatureRuleSpec[]
  code: {
    generatedHeader: { pattern: string; flags?: string }
    generatedCommentLine: { pattern: string; flags?: string }
    invisibleWatermark: { pattern: string; flags?: string }
  }
}

interface WatermarkUnicodeRuleSpec {
  label: string
  pattern?: string
  flags?: string
  ranges?: Array<[number, number]>
}

interface WatermarkVendorRuleSpec {
  provider: string
  label: string
  pattern: string
  flags?: string
}

interface WatermarkRules {
  unicode: {
    invisible: WatermarkUnicodeRuleSpec
    bidi: WatermarkUnicodeRuleSpec
    tags: WatermarkUnicodeRuleSpec
    exoticSpaces: WatermarkUnicodeRuleSpec
  }
  vendor: WatermarkVendorRuleSpec[]
}

const cavemanRules = loadRules<CavemanRules>("caveman")
const rtkRules = loadRules<RtkRules>("rtk")
const ponytailRules = loadRules<PonytailRules>("ponytail")
const signatureRules = loadRules<SignatureRules>("signature-remover")
const watermarkRules = loadRules<WatermarkRules>("watermark-remover")

const CAVEMAN_PHRASES: Array<[RegExp, string]> = cavemanRules.phrases.map((p) => [
  new RegExp(p.pattern, p.flags ?? "gi"),
  p.replacement,
])
const CAVEMAN_FILLER = new RegExp(cavemanRules.filler, cavemanRules.fillerFlags ?? "gi")
const CAVEMAN_POLITE = new RegExp(cavemanRules.polite, cavemanRules.politeFlags ?? "gi")

const RTK_BOILERPLATE = new RegExp(rtkRules.boilerplate.pattern, rtkRules.boilerplate.flags ?? "gi")
const RTK_INTRO = new RegExp(rtkRules.intro.pattern, rtkRules.intro.flags ?? "gi")

const SIGNATURE_RULES = signatureRules.rules.map((r) => ({
  provider: r.provider,
  label: r.label,
  regex: new RegExp(r.pattern, r.flags ?? "gi"),
}))
const CODE_GENERATED_HEADER = new RegExp(
  signatureRules.code.generatedHeader.pattern,
  signatureRules.code.generatedHeader.flags ?? "i",
)
const CODE_GENERATED_COMMENT_LINE = new RegExp(
  signatureRules.code.generatedCommentLine.pattern,
  signatureRules.code.generatedCommentLine.flags ?? "gim",
)
const CODE_INVISIBLE_WATERMARK = new RegExp(
  signatureRules.code.invisibleWatermark.pattern,
  signatureRules.code.invisibleWatermark.flags ?? "g",
)

const WATERMARK_UNICODE = [
  { label: watermarkRules.unicode.invisible.label, regex: watermarkRules.unicode.invisible.pattern, normalizeToSpace: false },
  { label: watermarkRules.unicode.bidi.label, regex: watermarkRules.unicode.bidi.pattern, normalizeToSpace: false },
  { label: watermarkRules.unicode.tags.label, ranges: watermarkRules.unicode.tags.ranges, normalizeToSpace: false },
  { label: watermarkRules.unicode.exoticSpaces.label, regex: watermarkRules.unicode.exoticSpaces.pattern, normalizeToSpace: true },
].map((rule) => ({
  label: rule.label,
  regex: rule.regex ? new RegExp(rule.regex, "g") : undefined,
  ranges: rule.ranges,
  normalizeToSpace: rule.normalizeToSpace,
}))
const WATERMARK_VENDOR = watermarkRules.vendor.map((r) => ({
  provider: r.provider,
  label: r.label,
  regex: new RegExp(r.pattern, r.flags ?? "gim"),
}))

// ---------------------------------------------------------------------------
// Signature removal (prompt side)
// ---------------------------------------------------------------------------

/** Strips Anthropic/OpenAI/generic identity & format signatures from a prompt. */
export function mugilStripSignatures(text: string): string {
  let out = text
  for (const rule of SIGNATURE_RULES) {
    out = out.replace(rule.regex, " ")
  }
  out = out.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim()
  return out
}

// ---------------------------------------------------------------------------
// Caveman (terse phrasing)
// ---------------------------------------------------------------------------

/** Compresses a prompt into terse caveman phrasing. */
export function mugilCaveman(text: string): string {
  let out = text
  for (const [re, replacement] of CAVEMAN_PHRASES) {
    out = out.replace(re, replacement)
  }
  out = out.replace(CAVEMAN_FILLER, " ")
  out = out.replace(CAVEMAN_POLITE, " ")
  out = out.replace(/[ \t]{2,}/g, " ")
  out = out.replace(/\n{3,}/g, "\n\n")
  return out.trim()
}

// ---------------------------------------------------------------------------
// RTK (reduced token kernel: boilerplate + dedupe)
// ---------------------------------------------------------------------------

/** Strips boilerplate and de-duplicates repeated content, keeping the kernel. */
export function mugilRtk(text: string): string {
  let out = text.replace(RTK_BOILERPLATE, "").replace(RTK_INTRO, "")

  // Preserve markdown code blocks from being flattened
  const codeBlocks: string[] = []
  let masked = out.replace(/```[\s\S]*?```/g, (m) => {
    codeBlocks.push(m)
    return `__RTK_CODE_BLOCK_${codeBlocks.length - 1}__`
  })

  const seen = new Set<string>()
  masked = masked
    .split(/(?<=[.!?])\s+|\n+/)
    .filter((chunk) => {
      const norm = chunk.trim().toLowerCase()
      if (norm.length === 0) return false
      if (norm.startsWith("__rtk_code_block_")) return true
      if (seen.has(norm)) return false
      seen.add(norm)
      return true
    })
    .join(" ")

  masked = masked.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n")
  out = masked.replace(/__RTK_CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)] ?? "")
  return out.trim()
}

// ---------------------------------------------------------------------------
// RTK command-output compression (tool results)
// ---------------------------------------------------------------------------

/**
 * RTK-style output compression: collapses repeated lines, trims blank-line
 * noise and truncates very long lines. Keeps error/failure lines intact
 * (they usually matter).
 */
export function mugilCompressOutput(text: string, maxLineLength = 200): string {
  if (!ENABLED) return text
  const lines = text.split("\n")
  const out: string[] = []
  let prev: string | undefined
  let count = 0

  const push = () => {
    if (prev === undefined) return
    out.push(count > 1 ? `${prev}  [${count}×]` : prev)
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "")
    if (line.trim().length === 0) {
      push()
      prev = undefined
      count = 0
      continue
    }
    const truncated =
      line.length > maxLineLength ? `${line.slice(0, maxLineLength)}… (+${line.length - maxLineLength} chars)` : line

    if (truncated === prev) {
      count += 1
      continue
    }
    push()
    prev = truncated
    count = 1
  }
  push()

  return out.join("\n")
}

// ---------------------------------------------------------------------------
// Ponytail (output minimization system instruction)
// ---------------------------------------------------------------------------

/** System-level instruction that biases the model toward minimal output. */
export function mugilPonytailInstruction(): string {
  return [ponytailRules.preamble, ...ponytailRules.ladder, ponytailRules.safety].join("\n")
}

// ---------------------------------------------------------------------------
// Watermark removal (post-generation) + code signature stripping
// ---------------------------------------------------------------------------

/** Removes AI provenance watermarks from generated text (deterministic layer). */
export function mugilStripWatermarks(text: string): string {
  let out = text
  for (const rule of WATERMARK_UNICODE) {
    if (rule.ranges) {
      let cleaned = ""
      for (const ch of out) {
        const cp = ch.codePointAt(0)!
        const hit = rule.ranges.some(([start, end]) => cp >= start && cp <= end)
        if (hit) {
          if (rule.normalizeToSpace) cleaned += " "
        } else {
          cleaned += ch
        }
      }
      out = cleaned
      continue
    }
    if (!rule.regex) continue
    out = out.replace(rule.regex, rule.normalizeToSpace ? " " : "")
  }
  for (const rule of WATERMARK_VENDOR) {
    out = out.replace(rule.regex, "")
  }
  out = out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return out
}

/** Removes AI attribution headers/comments and invisible watermarks from code. */
export function mugilStripCodeSignatures(code: string): string {
  let out = code.replace(CODE_GENERATED_HEADER, "")
  out = out.replace(CODE_GENERATED_COMMENT_LINE, "")
  out = out.replace(CODE_INVISIBLE_WATERMARK, "")
  out = out.replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim()
  return out
}

// ---------------------------------------------------------------------------
// Combined pipeline transforms
// ---------------------------------------------------------------------------

/**
 * Pre-request: signature-remover → caveman → rtk on the outgoing user text.
 *
 * Safety net: the signature rules' greedy preamble patterns can consume an
 * entire period-less line (e.g. "As an AI language model, …? Thanks!" with no
 * trailing period) — faithful to the upstream rules, but a user's request must
 * never be destroyed by a default-on transform. If the chain collapses the
 * prompt past a sanity threshold, fall back to the compression-only chain on
 * the original text; only if that also empties the prompt do we keep it intact.
 */
export function mugilPreprocess(text: string): string {
  if (!ENABLED) return text
  const trimmed = text.trim()
  if (trimmed.length === 0) return text
  const refined = mugilRtk(mugilCaveman(mugilStripSignatures(text)))
  if (refined.length >= trimmed.length * 0.3) return refined
  const fallback = mugilRtk(mugilCaveman(text))
  return fallback.trim().length > 0 ? fallback : text
}

/** Post-generation: watermark removal + code signature stripping. */
export function mugilPostprocess(text: string): string {
  if (!ENABLED) return text
  return mugilStripCodeSignatures(mugilStripWatermarks(text))
}

/** System prompt addition: ponytail output-minimization instruction. */
export function mugilSystemInstruction(): string | undefined {
  if (!ENABLED) return undefined
  return mugilPonytailInstruction()
}
