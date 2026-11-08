import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseDimensions,
  dalle3Dimensions,
  wrapRasterInSvg,
  generateMockSvg,
  generateImage,
  IMAGE_PROVIDERS,
} from '../src/modules/tools/mediaTools.js';
import { createWorkspaceTools } from '../src/modules/tools/workspaceTools.js';
import { defaultPolicyForMode } from '../src/modules/tools/permissions.js';

describe('Media Tools (generateImage, dimensions & providers)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugil-media-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('parseDimensions & dalle3Dimensions', () => {
    it('defaults to 1024x1024 when omitted or invalid', () => {
      expect(parseDimensions(undefined)).toEqual({ width: 1024, height: 1024 });
      expect(parseDimensions('')).toEqual({ width: 1024, height: 1024 });
      expect(parseDimensions('invalid')).toEqual({ width: 1024, height: 1024 });
      expect(parseDimensions('0x0')).toEqual({ width: 1024, height: 1024 });
    });

    it('parses valid WxH strings', () => {
      expect(parseDimensions('512x512')).toEqual({ width: 512, height: 512 });
      expect(parseDimensions('1280x720')).toEqual({ width: 1280, height: 720 });
      expect(parseDimensions('800')).toEqual({ width: 800, height: 800 });
    });

    it('clamps values within bounds [64, 2048]', () => {
      expect(parseDimensions('10x10')).toEqual({ width: 64, height: 64 });
      expect(parseDimensions('4000x4000')).toEqual({ width: 2048, height: 2048 });
    });

    it('maps arbitrary dimensions to valid DALL-E 3 constraints', () => {
      expect(dalle3Dimensions(1024, 1024)).toBe('1024x1024');
      expect(dalle3Dimensions(512, 512)).toBe('1024x1024');
      expect(dalle3Dimensions(1920, 1080)).toBe('1792x1024'); // landscape
      expect(dalle3Dimensions(1080, 1920)).toBe('1024x1792'); // portrait
    });
  });

  describe('SVG helpers', () => {
    it('produces valid SVG buffer with prompt and dimensions', () => {
      const buf = generateMockSvg('Cyberpunk city skyline', 800, 600, 'neon style');
      const text = buf.toString('utf-8');
      expect(text).toContain('<svg');
      expect(text).toContain('viewBox="0 0 800 600"');
      expect(text).toContain('Cyberpunk city skyline');
      expect(text).toContain('neon style');
    });

    it('escapes XML special characters in prompt', () => {
      const buf = generateMockSvg('<Test & "Alert">', 512, 512);
      const text = buf.toString('utf-8');
      expect(text).not.toContain('<Test');
      expect(text).toContain('&lt;Test &amp;');
    });

    it('wraps raster image buffers in valid SVG containers when requested', () => {
      const rasterBuf = Buffer.from('fake-raster-png');
      const wrapped = wrapRasterInSvg(rasterBuf, 'image/png', 512, 512);
      const text = wrapped.toString('utf-8');
      expect(text).toContain('<svg');
      expect(text).toContain('viewBox="0 0 512 512"');
      expect(text).toContain('data:image/png;base64,');
    });
  });

  describe('generateImage providers', () => {
    it('rejects output paths that escape the workspace root', async () => {
      await expect(
        generateImage({
          prompt: 'logo',
          outputPath: '../outside.png',
          workspaceRoot: tempDir,
        }),
      ).rejects.toThrow(/outside the workspace root/);
    });

    it('generates offline mock SVG when mock=true', async () => {
      const res = await generateImage({
        prompt: 'Minimalist brand logo',
        outputPath: 'assets/logo.svg',
        size: '512x512',
        mock: true,
        workspaceRoot: tempDir,
      });

      expect(res.success).toBe(true);
      expect(res.width).toBe(512);
      expect(res.height).toBe(512);
      expect(res.provider).toBe('mock-offline');

      const savedPath = path.join(tempDir, 'assets/logo.svg');
      expect(fs.existsSync(savedPath)).toBe(true);
      const content = fs.readFileSync(savedPath, 'utf-8');
      expect(content).toContain('<svg');
      expect(content).toContain('Minimalist brand logo');
    });

    it('dispatches to Vercel AI Gateway when VERCEL_API_KEY is present', async () => {
      const orig = process.env.VERCEL_API_KEY;
      process.env.VERCEL_API_KEY = 'test-vercel-key';

      const fakeBase64 = Buffer.from('vercel-png-content').toString('base64');
      const fakeFetch = async (url: string | URL | Request) => {
        expect(url.toString()).toContain('ai-gateway.vercel.sh');
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: fakeBase64 }] }),
        } as unknown as Response;
      };

      try {
        const res = await generateImage({
          prompt: 'Product banner',
          outputPath: 'banner.png',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.success).toBe(true);
        expect(res.provider).toBe('vercel-ai-gateway');
        expect(fs.readFileSync(path.join(tempDir, 'banner.png')).toString()).toBe(
          'vercel-png-content',
        );
      } finally {
        if (orig === undefined) delete process.env.VERCEL_API_KEY;
        else process.env.VERCEL_API_KEY = orig;
      }
    });

    it('dispatches to OpenRouter when OPENROUTER_API_KEY is present', async () => {
      const orig = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const fakeBase64 = Buffer.from('openrouter-png-content').toString('base64');
      const fakeFetch = async (url: string | URL | Request) => {
        expect(url.toString()).toContain('openrouter.ai/api/v1/images');
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: fakeBase64 }] }),
        } as unknown as Response;
      };

      try {
        const res = await generateImage({
          prompt: 'Icon asset',
          outputPath: 'icon.png',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.success).toBe(true);
        expect(res.provider).toBe('openrouter-flux');
        expect(fs.readFileSync(path.join(tempDir, 'icon.png')).toString()).toBe(
          'openrouter-png-content',
        );
      } finally {
        if (orig === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = orig;
      }
    });

    it('handles image URL downloads (OpenAI format) and clamps size for the image model', async () => {
      const orig = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-fake-key';

      const fakeImageBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('downloaded-image-data'),
      ]);
      const fakeFetch = async (url: string | URL | Request, init?: RequestInit) => {
        const u = url.toString();
        if (u.includes('api.openai.com')) {
          const body = JSON.parse(init?.body as string);
          expect(body.size).toBe('1024x1024'); // clamped from 512x512
          expect(body.model).toBe('gpt-image-1');
          expect(body.response_format).toBeUndefined(); // gpt-image-* rejects it
          return {
            ok: true,
            json: async () => ({ data: [{ url: 'https://cdn.example.com/generated-img.png' }] }),
          } as unknown as Response;
        }
        if (u.includes('cdn.example.com')) {
          return {
            ok: true,
            arrayBuffer: async () => Uint8Array.from(fakeImageBytes).buffer,
          } as unknown as Response;
        }
        throw new Error('Unexpected url: ' + u);
      };

      try {
        const res = await generateImage({
          prompt: 'Futuristic dashboard',
          outputPath: 'images/dash.png',
          size: '512x512',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.success).toBe(true);
        expect(res.provider).toBe('openai-gpt-image');
        expect(res.format).toBe('png');
        const saved = path.join(tempDir, 'images/dash.png');
        expect(fs.existsSync(saved)).toBe(true);
        expect(fs.readFileSync(saved).equals(fakeImageBytes)).toBe(true);
      } finally {
        if (orig === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = orig;
      }
    });

    it('writes an extension that matches the bytes and reports the real format', async () => {
      const orig = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      // A real WebP header — the requested .png path must not lie about it.
      const webp = Buffer.from(
        'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA',
        'base64',
      );
      const fakeFetch = async () =>
        ({
          ok: true,
          json: async () => ({ data: [{ b64_json: webp.toString('base64') }] }),
        }) as unknown as Response;

      try {
        const res = await generateImage({
          prompt: 'Icon',
          outputPath: 'icon.png',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.format).toBe('webp');
        expect(res.path).toBe('icon.webp');
        expect(fs.existsSync(path.join(tempDir, 'icon.webp'))).toBe(true);
        expect(fs.existsSync(path.join(tempDir, 'icon.png'))).toBe(false);
      } finally {
        if (orig === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = orig;
      }
    });

    it('wraps raster bytes in an SVG whose MIME matches the raster', async () => {
      const orig = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const webp = Buffer.from(
        'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEALmk0mk0iIiIiIgBoSygABc6zbAAA',
        'base64',
      );
      const fakeFetch = async () =>
        ({
          ok: true,
          json: async () => ({ data: [{ b64_json: webp.toString('base64') }] }),
        }) as unknown as Response;

      try {
        const res = await generateImage({
          prompt: 'Icon',
          outputPath: 'icon.svg',
          size: '256x256',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.format).toBe('svg');
        expect(res.path).toBe('icon.svg');
        const svg = fs.readFileSync(path.join(tempDir, 'icon.svg'), 'utf-8');
        expect(svg).toContain('data:image/webp;base64,');
      } finally {
        if (orig === undefined) delete process.env.OPENROUTER_API_KEY;
        else process.env.OPENROUTER_API_KEY = orig;
      }
    });

    it('flags the offline placeholder instead of reporting a real generation', async () => {
      const origOpenai = process.env.OPENAI_API_KEY;
      const origVercel = process.env.VERCEL_API_KEY;
      const origOpenrouter = process.env.OPENROUTER_API_KEY;
      const origTogether = process.env.TOGETHER_API_KEY;
      process.env.OPENAI_API_KEY = 'broken-key';
      delete process.env.VERCEL_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
      delete process.env.TOGETHER_API_KEY;

      const fakeFetch = async (url: string | URL | Request) => {
        if (url.toString().includes('api.openai.com')) {
          return { ok: false, status: 401, statusText: 'Unauthorized' } as unknown as Response;
        }
        throw new Error('Offline fallback');
      };

      try {
        const res = await generateImage({
          prompt: 'Scenic mountains',
          outputPath: 'mountains.png',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.provider).toBe('offline-svg-fallback');
        expect(res.placeholder).toBe(true);
        expect(res.format).toBe('svg');
        expect(res.path).toBe('mountains.svg');
        expect(fs.existsSync(path.join(tempDir, 'mountains.svg'))).toBe(true);
      } finally {
        const restore = (key: string, value: string | undefined) => {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        };
        restore('OPENAI_API_KEY', origOpenai);
        restore('VERCEL_API_KEY', origVercel);
        restore('OPENROUTER_API_KEY', origOpenrouter);
        restore('TOGETHER_API_KEY', origTogether);
      }
    });

    it('records fallback reasons when providers fail', async () => {
      const orig = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'broken-key';

      const fakeFetch = async (url: string | URL | Request) => {
        const u = url.toString();
        if (u.includes('api.openai.com')) {
          return {
            ok: false,
            status: 401,
            statusText: 'Unauthorized',
          } as unknown as Response;
        }
        throw new Error('Offline fallback');
      };

      try {
        const res = await generateImage({
          prompt: 'Scenic mountains',
          outputPath: 'mountains.png',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.success).toBe(true);
        expect(res.provider).toBe('offline-svg-fallback');
        expect(res.fallbackReasons).toBeDefined();
        expect(res.fallbackReasons?.some((r) => r.includes('openai: 401'))).toBe(true);
      } finally {
        if (orig === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = orig;
      }
    });

    it('exports IMAGE_PROVIDERS metadata list with models', () => {
      expect(Array.isArray(IMAGE_PROVIDERS)).toBe(true);
      const providerIds = IMAGE_PROVIDERS.map((p) => p.id);
      expect(providerIds).toContain('auto');
      expect(providerIds).toContain('pollinations');
      expect(providerIds).toContain('openai');
      expect(providerIds).toContain('together');
      expect(providerIds).toContain('openrouter');
      expect(providerIds).toContain('vercel');
      expect(providerIds).toContain('mock');
    });

    it('dispatches directly to mock when provider="mock"', async () => {
      const res = await generateImage({
        prompt: 'Mock icon',
        outputPath: 'assets/mock.svg',
        provider: 'mock',
        workspaceRoot: tempDir,
      });
      expect(res.success).toBe(true);
      expect(res.provider).toBe('mock-offline');
      expect(fs.existsSync(path.join(tempDir, 'assets/mock.svg'))).toBe(true);
    });

    it('passes model parameter to Pollinations when model is specified', async () => {
      let requestedUrl = '';
      const fakeFetch = async (url: string | URL | Request) => {
        requestedUrl = url.toString();
        return {
          ok: true,
          arrayBuffer: async () => Buffer.alloc(600, 1),
        } as unknown as Response;
      };

      const res = await generateImage({
        prompt: 'Turbo spaceship',
        outputPath: 'assets/ship.png',
        provider: 'pollinations',
        model: 'turbo',
        workspaceRoot: tempDir,
        fetchFn: fakeFetch as unknown as typeof fetch,
      });

      expect(res.success).toBe(true);
      expect(res.provider).toBe('pollinations-flux');
      expect(requestedUrl).toContain('model=turbo');
    });

    it('dispatches to OpenAI with custom model and handles body correctly', async () => {
      const orig = process.env.OPENAI_API_KEY;
      process.env.OPENAI_API_KEY = 'test-key';
      let sentBody: any = null;
      const fakeBase64 = Buffer.from('fake-dalle-bytes').toString('base64');
      const fakeFetch = async (_url: string | URL | Request, init?: RequestInit) => {
        sentBody = JSON.parse(init?.body as string);
        return {
          ok: true,
          json: async () => ({ data: [{ b64_json: fakeBase64 }] }),
        } as unknown as Response;
      };

      try {
        const res = await generateImage({
          prompt: 'Futuristic cityscape',
          outputPath: 'assets/city.png',
          provider: 'openai',
          model: 'dall-e-3',
          workspaceRoot: tempDir,
          fetchFn: fakeFetch as unknown as typeof fetch,
        });

        expect(res.success).toBe(true);
        expect(res.provider).toBe('openai-dalle3');
        expect(sentBody.model).toBe('dall-e-3');
        expect(sentBody.response_format).toBe('b64_json');
      } finally {
        if (orig === undefined) delete process.env.OPENAI_API_KEY;
        else process.env.OPENAI_API_KEY = orig;
      }
    });

    it('reports missing key when explicit provider lacks API key', async () => {
      const orig = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;

      try {
        const res = await generateImage({
          prompt: 'Must be openai',
          outputPath: 'assets/target.png',
          provider: 'openai',
          workspaceRoot: tempDir,
        });

        expect(res.placeholder).toBe(true);
        expect(res.fallbackReasons).toContain('openai: OPENAI_API_KEY is not set');
      } finally {
        if (orig !== undefined) process.env.OPENAI_API_KEY = orig;
      }
    });
  });

  describe('Workspace tool integration', () => {
    it('registers generate_image tool definition and handler', async () => {
      const origMock = process.env.MUGIL_IDE_MOCK;
      process.env.MUGIL_IDE_MOCK = '1';
      try {
        const { tools, toolRegistry } = createWorkspaceTools(tempDir);
        const def = tools.find((t) => t.name === 'generate_image');
        expect(def).toBeDefined();
        expect(def?.parameters.required).toContain('prompt');
        expect(def?.parameters.required).toContain('path');
        expect(typeof toolRegistry.generate_image).toBe('function');

        const result = await toolRegistry.generate_image({
          id: 'c-img',
          name: 'generate_image',
          arguments: JSON.stringify({
            prompt: 'App icon vector',
            path: 'icons/app.svg',
            size: '512x512',
          }),
        });

        expect(result).toContain('Generated image asset saved to icons/app.svg');
        expect(result).toContain('Preview available in file viewer');
        expect(fs.existsSync(path.join(tempDir, 'icons/app.svg'))).toBe(true);
      } finally {
        if (origMock === undefined) delete process.env.MUGIL_IDE_MOCK;
        else process.env.MUGIL_IDE_MOCK = origMock;
      }
    });

    it('policy denies generate_image in plan mode and asks in act mode', () => {
      const planPolicy = defaultPolicyForMode('plan');
      expect(planPolicy.tools?.generate_image).toBe('deny');

      const actPolicy = defaultPolicyForMode('act');
      expect(actPolicy.tools?.generate_image).toBe('ask');
    });
  });
});
