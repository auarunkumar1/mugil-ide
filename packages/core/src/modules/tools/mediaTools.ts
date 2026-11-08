/**
 * Media Generation Tools
 * ======================
 * Provides autonomous image and visual asset generation for the agent.
 * Dispatches across configured providers (Vercel AI Gateway, OpenRouter,
 * OpenAI, Together, and the keyless Pollinations generator) with an offline
 * vector SVG fallback.
 *
 * Two rules keep the result honest:
 *   1. The file extension always matches the bytes actually written (the
 *      returned `path` may therefore differ from the requested one).
 *   2. Falling through to the placeholder SVG is reported as
 *      `placeholder: true` instead of masquerading as a real generation.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface GenerateImageOptions {
  /** Description of the image to generate. */
  prompt: string;
  /** Destination file path relative to workspace (e.g. "assets/logo.png"). */
  outputPath: string;
  /** Dimensions in WxH format (e.g. "1024x1024", "512x512", "1792x1024"). Default "1024x1024". */
  size?: string;
  /** Visual style guide (e.g. "vector icon", "photorealistic", "flat illustration"). */
  style?: string;
  /** Workspace root directory. Defaults to process.cwd(). */
  workspaceRoot?: string;
  /** Force offline mock mode (generates responsive SVG). */
  mock?: boolean;
  /** Explicit provider ('auto' | 'pollinations' | 'openai' | 'together' | 'openrouter' | 'vercel' | 'mock'). Default 'auto'. */
  provider?: string;
  /** Explicit model override for the chosen provider (e.g. 'dall-e-3', 'flux', 'turbo'). */
  model?: string;
  /** Custom fetch implementation (for testing). */
  fetchFn?: typeof fetch;
}

export interface ImageModelOption {
  id: string;
  name: string;
}

export interface ImageProviderOption {
  id: string;
  name: string;
  requiresKey?: string;
  defaultModel?: string;
  models: ImageModelOption[];
}

export const IMAGE_PROVIDERS: readonly ImageProviderOption[] = [
  {
    id: 'auto',
    name: 'Auto (Cascade across configured providers)',
    models: [{ id: '', name: 'Provider default' }],
  },
  {
    id: 'pollinations',
    name: 'Pollinations AI (Free, No API key)',
    defaultModel: 'flux',
    models: [
      { id: '', name: 'Default (Flux)' },
      { id: 'flux', name: 'Flux' },
      { id: 'flux-realism', name: 'Flux Realism' },
      { id: 'turbo', name: 'Turbo' },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI (DALL-E & GPT Image)',
    requiresKey: 'OPENAI_API_KEY',
    defaultModel: 'gpt-image-1',
    models: [
      { id: '', name: 'Default (gpt-image-1)' },
      { id: 'gpt-image-1', name: 'GPT Image 1' },
      { id: 'dall-e-3', name: 'DALL-E 3' },
      { id: 'dall-e-2', name: 'DALL-E 2' },
    ],
  },
  {
    id: 'together',
    name: 'Together AI (FLUX & SDXL)',
    requiresKey: 'TOGETHER_API_KEY',
    defaultModel: 'black-forest-labs/FLUX.1-schnell',
    models: [
      { id: '', name: 'Default (FLUX.1-schnell)' },
      { id: 'black-forest-labs/FLUX.1-schnell', name: 'FLUX.1 Schnell' },
      { id: 'black-forest-labs/FLUX.1-dev', name: 'FLUX.1 Dev' },
      { id: 'stabilityai/stable-diffusion-xl-base-1.0', name: 'SDXL 1.0' },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    requiresKey: 'OPENROUTER_API_KEY',
    defaultModel: 'black-forest-labs/flux-3-image-klein',
    models: [
      { id: '', name: 'Default (flux-3-image-klein)' },
      { id: 'black-forest-labs/flux-3-image-klein', name: 'Flux 3 Image Klein' },
      { id: 'google/imagen-3', name: 'Google Imagen 3' },
      { id: 'stabilityai/stable-diffusion-3-medium', name: 'SD 3 Medium' },
    ],
  },
  {
    id: 'vercel',
    name: 'Vercel AI Gateway',
    requiresKey: 'VERCEL_API_KEY',
    defaultModel: 'bfl/flux-2-klein-4b',
    models: [
      { id: '', name: 'Default (flux-2-klein-4b)' },
      { id: 'bfl/flux-2-klein-4b', name: 'Flux 2 Klein 4B' },
    ],
  },
  {
    id: 'mock',
    name: 'Offline Mock (SVG)',
    models: [{ id: '', name: 'Vector SVG Generator' }],
  },
];

export interface GenerateImageResult {
  success: boolean;
  /** Workspace-relative path actually written (extension matches the bytes). */
  path: string;
  /** Detected content format — never a guess from the requested extension. */
  format: string;
  sizeBytes: number;
  width: number;
  height: number;
  provider: string;
  fallbackReasons?: string[];
  /** True when no provider produced an image and a vector placeholder was written. */
  placeholder?: boolean;
  error?: string;
}

/** Parses "WxH" dimension strings, defaulting to 1024x1024. */
export function parseDimensions(sizeStr?: string): { width: number; height: number } {
  if (!sizeStr) return { width: 1024, height: 1024 };
  const parts = sizeStr
    .toLowerCase()
    .split('x')
    .map((p) => Number(p.trim()));
  const w = parts[0];
  const h = parts[1] ?? parts[0];
  if (
    typeof w === 'number' &&
    typeof h === 'number' &&
    Number.isFinite(w) &&
    Number.isFinite(h) &&
    w > 0 &&
    h > 0
  ) {
    return {
      width: Math.min(2048, Math.max(64, Math.floor(w))),
      height: Math.min(2048, Math.max(64, Math.floor(h))),
    };
  }
  return { width: 1024, height: 1024 };
}

/** Maps arbitrary dimensions to valid DALL-E 3 constraints (1024x1024, 1792x1024, 1024x1792). */
export function dalle3Dimensions(
  width: number,
  height: number,
): '1024x1024' | '1792x1024' | '1024x1792' {
  const ratio = width / height;
  if (ratio >= 1.3) return '1792x1024';
  if (ratio <= 0.77) return '1024x1792';
  return '1024x1024';
}

/** Maps arbitrary dimensions to gpt-image-* constraints (1024x1024, 1536x1024, 1024x1536). */
function gptImageDimensions(
  width: number,
  height: number,
): '1024x1024' | '1536x1024' | '1024x1536' {
  const ratio = width / height;
  if (ratio >= 1.2) return '1536x1024';
  if (ratio <= 0.83) return '1024x1536';
  return '1024x1024';
}

/** Wraps a raster image buffer in a valid responsive SVG container. */
export function wrapRasterInSvg(
  rasterBuf: Buffer,
  mime: string,
  width: number,
  height: number,
): Buffer {
  const b64 = rasterBuf.toString('base64');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <image href="data:${mime};base64,${b64}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
</svg>`;
  return Buffer.from(svg, 'utf-8');
}

/** Generates a responsive SVG placeholder when running offline or in mock mode. */
export function generateMockSvg(
  prompt: string,
  width: number,
  height: number,
  style?: string,
): Buffer {
  const safePrompt = prompt
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, 100);
  const safeStyle = (style || 'Generated Asset')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0d1117"/>
      <stop offset="50%" stop-color="#161b22"/>
      <stop offset="100%" stop-color="#090d13"/>
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#58a6ff"/>
      <stop offset="100%" stop-color="#bc8cff"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="20" y="20" width="${width - 40}" height="${height - 40}" rx="16" fill="none" stroke="#30363d" stroke-width="2" stroke-dasharray="8 6"/>
  <g transform="translate(${width / 2}, ${height / 2})">
    <circle r="44" fill="#21262d" stroke="url(#accent)" stroke-width="3"/>
    <path d="M-18 -8 L-6 12 L8 -4 L20 14" fill="none" stroke="url(#accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="12" cy="-14" r="5" fill="#f0883e"/>
    <text y="75" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="18" font-weight="600" fill="#c9d1d9">${safePrompt}</text>
    <text y="105" text-anchor="middle" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="13" fill="#8b949e">${safeStyle} (${width}x${height})</text>
  </g>
</svg>`;

  return Buffer.from(svg, 'utf-8');
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'svg' | 'unknown';

const FORMAT_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  unknown: 'application/octet-stream',
};

const FORMAT_EXT: Partial<Record<ImageFormat, string>> = {
  png: '.png',
  jpeg: '.jpg',
  webp: '.webp',
  gif: '.gif',
  svg: '.svg',
};

/** Detects the real image format from magic bytes (never from the filename). */
export function sniffImageFormat(buf: Buffer): ImageFormat {
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'png';
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  if (buf.length >= 4 && buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'gif';
  const head = buf.subarray(0, 1024).toString('utf-8').trimStart();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  return 'unknown';
}

/**
 * Writes an asset, forcing the extension to match the bytes. When an `.svg`
 * destination received raster bytes, the raster is wrapped in an SVG
 * container first (so the extension stays truthful either way).
 */
function writeAsset(
  destPath: string,
  buf: Buffer,
  wantSvg: boolean,
  width: number,
  height: number,
): { abs: string; format: ImageFormat } {
  const detected = sniffImageFormat(buf);
  const format: ImageFormat = wantSvg && detected !== 'svg' ? 'svg' : detected;
  const finalBuf =
    format === 'svg' && detected !== 'svg'
      ? wrapRasterInSvg(buf, FORMAT_MIME[detected === 'unknown' ? 'png' : detected], width, height)
      : buf;

  const ext = path.extname(destPath).toLowerCase();
  const wantExt = FORMAT_EXT[format];
  const extMatches = wantExt ? ext === wantExt || (format === 'jpeg' && ext === '.jpeg') : true;
  const abs =
    wantExt && !extMatches ? destPath.slice(0, destPath.length - ext.length) + wantExt : destPath;

  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, finalBuf);
  return { abs, format };
}

/** Extracts an image buffer from a b64_json or URL-shaped provider response. */
async function extractImageBuffer(json: any, fetchImpl: typeof fetch): Promise<Buffer | null> {
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 === 'string' && b64.length > 0) {
    return Buffer.from(b64, 'base64');
  }
  const url = json?.data?.[0]?.url;
  if (typeof url === 'string' && url.startsWith('http')) {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

/**
 * Autonomous image generator: queries the highest priority available engine
 * and saves the resulting image asset to the workspace file path.
 */
export async function generateImage(options: GenerateImageOptions): Promise<GenerateImageResult> {
  const root = path.resolve(options.workspaceRoot || process.cwd());
  const requestedPath = path.resolve(root, options.outputPath);
  const rel = path.relative(root, requestedPath);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`output path "${options.outputPath}" is outside the workspace root`);
  }

  const { width, height } = parseDimensions(options.size);
  const fullPrompt = options.style ? `${options.prompt}, ${options.style} style` : options.prompt;
  const wantSvg = requestedPath.toLowerCase().endsWith('.svg');
  const fetchImpl = options.fetchFn ?? globalThis.fetch;
  const fallbackReasons: string[] = [];

  const succeed = (provider: string, buf: Buffer): GenerateImageResult => {
    const written = writeAsset(requestedPath, buf, wantSvg, width, height);
    return {
      success: true,
      path: path.relative(root, written.abs).replace(/\\/g, '/'),
      format: written.format,
      sizeBytes: fs.statSync(written.abs).size,
      width,
      height,
      provider,
      fallbackReasons: fallbackReasons.length > 0 ? fallbackReasons : undefined,
    };
  };

  const rawProvider = (options.provider || 'auto').trim().toLowerCase();
  const provider =
    rawProvider === 'vercel-ai-gateway'
      ? 'vercel'
      : rawProvider === 'pollinations-flux'
        ? 'pollinations'
        : rawProvider === 'together-flux'
          ? 'together'
          : rawProvider === 'openrouter-flux'
            ? 'openrouter'
            : rawProvider === 'mock-offline'
              ? 'mock'
              : rawProvider === 'openai-gpt-image' || rawProvider === 'openai-dalle3'
                ? 'openai'
                : rawProvider;

  // 1. Explicit mock or offline requested
  if (provider === 'mock' || options.mock || process.env.MUGIL_IDE_MOCK === '1') {
    return succeed('mock-offline', generateMockSvg(options.prompt, width, height, options.style));
  }

  const tryVercel = async (modelOverride?: string): Promise<GenerateImageResult | null> => {
    const vercelKey = process.env.VERCEL_API_KEY || process.env.AI_GATEWAY_API_KEY;
    if (!vercelKey) {
      fallbackReasons.push('vercel: VERCEL_API_KEY or AI_GATEWAY_API_KEY is not set');
      return null;
    }
    try {
      const gatewayUrl =
        process.env.VERCEL_AI_GATEWAY_URL || 'https://ai-gateway.vercel.sh/v1/images/generations';
      const model = modelOverride || process.env.MUGIL_IDE_IMAGE_MODEL || 'bfl/flux-2-klein-4b';
      const res = await fetchImpl(gatewayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${vercelKey}`,
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          model,
          size: `${width}x${height}`,
          n: 1,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const buf = await extractImageBuffer(await res.json(), fetchImpl);
        if (buf) return succeed('vercel-ai-gateway', buf);
        fallbackReasons.push('vercel: empty response');
      } else {
        fallbackReasons.push(`vercel: ${res.status} ${res.statusText}`.trim());
      }
    } catch (err) {
      fallbackReasons.push(`vercel: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  };

  const tryOpenRouter = async (modelOverride?: string): Promise<GenerateImageResult | null> => {
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      fallbackReasons.push('openrouter: OPENROUTER_API_KEY is not set');
      return null;
    }
    try {
      const model =
        modelOverride ||
        process.env.MUGIL_IDE_OPENROUTER_IMAGE_MODEL ||
        'black-forest-labs/flux-3-image-klein';
      const res = await fetchImpl('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey}`,
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          model,
          width,
          height,
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const buf = await extractImageBuffer(await res.json(), fetchImpl);
        if (buf) return succeed('openrouter-flux', buf);
        fallbackReasons.push('openrouter: empty response');
      } else {
        fallbackReasons.push(`openrouter: ${res.status} ${res.statusText}`.trim());
      }
    } catch (err) {
      fallbackReasons.push(`openrouter: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  };

  const tryOpenAI = async (modelOverride?: string): Promise<GenerateImageResult | null> => {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) {
      fallbackReasons.push('openai: OPENAI_API_KEY is not set');
      return null;
    }
    try {
      const model = modelOverride || process.env.MUGIL_IDE_OPENAI_IMAGE_MODEL || 'gpt-image-1';
      const isDalle = model.startsWith('dall-e');
      const body: Record<string, unknown> = {
        prompt: fullPrompt,
        model,
        n: 1,
        size: isDalle ? dalle3Dimensions(width, height) : gptImageDimensions(width, height),
      };
      if (isDalle) body.response_format = 'b64_json';
      const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const buf = await extractImageBuffer(await res.json(), fetchImpl);
        if (buf) return succeed(isDalle ? 'openai-dalle3' : 'openai-gpt-image', buf);
        fallbackReasons.push('openai: empty response');
      } else {
        fallbackReasons.push(`openai: ${res.status} ${res.statusText}`.trim());
      }
    } catch (err) {
      fallbackReasons.push(`openai: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  };

  const tryTogether = async (modelOverride?: string): Promise<GenerateImageResult | null> => {
    const togetherKey = process.env.TOGETHER_API_KEY;
    if (!togetherKey) {
      fallbackReasons.push('together: TOGETHER_API_KEY is not set');
      return null;
    }
    try {
      const model =
        modelOverride ||
        process.env.MUGIL_IDE_TOGETHER_IMAGE_MODEL ||
        'black-forest-labs/FLUX.1-schnell';
      const res = await fetchImpl('https://api.together.xyz/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${togetherKey}`,
        },
        body: JSON.stringify({
          prompt: fullPrompt,
          model,
          width,
          height,
          response_format: 'b64_json',
        }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const buf = await extractImageBuffer(await res.json(), fetchImpl);
        if (buf) return succeed('together-flux', buf);
        fallbackReasons.push('together: empty response');
      } else {
        fallbackReasons.push(`together: ${res.status} ${res.statusText}`.trim());
      }
    } catch (err) {
      fallbackReasons.push(`together: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  };

  const tryPollinations = async (modelOverride?: string): Promise<GenerateImageResult | null> => {
    const modelParam = modelOverride ? `&model=${encodeURIComponent(modelOverride)}` : '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=${width}&height=${height}&nologo=true${modelParam}`;
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(30000) });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 500) return succeed('pollinations-flux', buf);
          fallbackReasons.push('pollinations: response too small');
          break;
        }
        fallbackReasons.push(`pollinations: ${res.status} ${res.statusText}`.trim());
        if (![402, 429, 503].includes(res.status)) break;
        await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        fallbackReasons.push(`pollinations: ${err instanceof Error ? err.message : String(err)}`);
        break;
      }
    }
    return null;
  };

  // Explicit provider selected (not auto)
  if (provider !== 'auto') {
    let specificRes: GenerateImageResult | null = null;
    if (provider === 'vercel') {
      specificRes = await tryVercel(options.model);
    } else if (provider === 'openrouter') {
      specificRes = await tryOpenRouter(options.model);
    } else if (provider === 'openai') {
      specificRes = await tryOpenAI(options.model);
    } else if (provider === 'together') {
      specificRes = await tryTogether(options.model);
    } else if (provider === 'pollinations') {
      specificRes = await tryPollinations(options.model);
    } else {
      fallbackReasons.push(`unknown provider "${options.provider}"`);
    }

    if (specificRes) return specificRes;

    const result = succeed(
      'offline-svg-fallback',
      generateMockSvg(options.prompt, width, height, options.style),
    );
    return { ...result, placeholder: true };
  }

  // Auto multi-tier waterfall dispatch:
  // Vercel -> OpenRouter -> OpenAI -> Together -> Pollinations -> Offline SVG fallback
  const vercelKey = process.env.VERCEL_API_KEY || process.env.AI_GATEWAY_API_KEY;
  if (vercelKey) {
    const res = await tryVercel(options.model);
    if (res) return res;
  }

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  if (openRouterKey) {
    const res = await tryOpenRouter(options.model);
    if (res) return res;
  }

  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    const res = await tryOpenAI(options.model);
    if (res) return res;
  }

  const togetherKey = process.env.TOGETHER_API_KEY;
  if (togetherKey) {
    const res = await tryTogether(options.model);
    if (res) return res;
  }

  const pollRes = await tryPollinations(options.model);
  if (pollRes) return pollRes;

  // Final Fallback: offline vector placeholder — reported as a placeholder.
  const result = succeed(
    'offline-svg-fallback',
    generateMockSvg(options.prompt, width, height, options.style),
  );
  return { ...result, placeholder: true };
}
