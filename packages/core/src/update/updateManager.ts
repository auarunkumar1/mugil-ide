/**
 * Auto Update Manager
 * ===================
 * Keeps the engine's credited modules updatable without code changes:
 *
 *   - Each module's rules (caveman phrases, rtk patterns, ponytail ladder,
 *     signature patterns) are versioned data (src/rules/*.json) that modules
 *     load at runtime, preferring a local override store.
 *   - `check()` compares bundled/local versions against a remote registry
 *     (MUGIL_IDE_MODULES_REGISTRY) and the npm registry for the mugil-ide package.
 *   - `apply()` downloads newer rules and writes them to the override store.
 *   - `watch()` runs the check/apply cycle periodically — "run an update
 *     script periodically" — and reports via a callback.
 *
 * Offline / unconfigured environments degrade gracefully: no registry URL
 * simply means no remote module updates are reported.
 */

import localRegistry from '../rules/registry.json';
import { readOverrideSync, writeOverrideSync } from '../modules/overridesNode.js';

export interface ModuleSource {
  project: string;
  url: string;
  license: string;
}

export interface ModuleUpdateInfo {
  id: string;
  current: string;
  latest: string;
  rulesUrl?: string;
  applied?: boolean;
}

export interface NpmUpdateInfo {
  current: string;
  latest: string;
}

export interface CheckResult {
  /** True when a module registry URL is configured. */
  configured: boolean;
  registryUrl?: string;
  updates: ModuleUpdateInfo[];
  npm: NpmUpdateInfo | null;
}

export interface RemoteRegistry {
  schema?: number;
  modules: Record<string, { version: string; rulesUrl?: string }>;
  package?: { name?: string; version?: string };
}

export interface UpdateManagerOptions {
  /** Remote module registry URL. Defaults to MUGIL_IDE_MODULES_REGISTRY. */
  registryUrl?: string;
  /** Injectable fetch for tests. */
  fetchFn?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Set false to skip the npm package version check. */
  checkNpm?: boolean;
  onError?: (error: unknown) => void;
}

const LOCAL_REGISTRY = localRegistry as unknown as {
  schema: number;
  modules: Record<string, { version: string; source: ModuleSource }>;
  package: { name: string; version: string };
};

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0);
  const pb = b.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export class UpdateManager {
  private readonly registryUrl?: string;
  private readonly fetchFn: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly checkNpm: boolean;
  private readonly onError?: (error: unknown) => void;

  constructor(options: UpdateManagerOptions = {}) {
    this.registryUrl = options.registryUrl ?? process.env.MUGIL_IDE_MODULES_REGISTRY;
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.checkNpm = options.checkNpm ?? true;
    this.onError = options.onError;
  }

  /** Local version currently in effect for a module (override beats bundled). */
  localVersion(id: string): string {
    const override = readOverrideSync<{ version: string }>(id);
    if (override) return override.version;
    return LOCAL_REGISTRY.modules[id]?.version ?? '0.0.0';
  }

  /** Fetches the remote registry and compares versions. Never throws. */
  async check(): Promise<CheckResult> {
    const updates: ModuleUpdateInfo[] = [];
    let remote: RemoteRegistry | undefined;

    if (this.registryUrl) {
      try {
        remote = (await (await this.fetchFn(this.registryUrl)).json()) as RemoteRegistry;
      } catch (err) {
        this.onError?.(err);
      }
    }

    if (remote?.modules) {
      for (const [id, info] of Object.entries(remote.modules)) {
        if (!info?.version) continue;
        const current = this.localVersion(id);
        if (compareVersions(info.version, current) > 0) {
          updates.push({ id, current, latest: info.version, rulesUrl: info.rulesUrl });
        }
      }
    }

    const npm = this.checkNpm ? await this.checkNpmVersion() : null;
    return {
      configured: Boolean(this.registryUrl),
      registryUrl: this.registryUrl,
      updates,
      npm,
    };
  }

  /** Downloads newer rules and writes them to the local override store. */
  async apply(updates: ModuleUpdateInfo[]): Promise<ModuleUpdateInfo[]> {
    const applied: ModuleUpdateInfo[] = [];
    for (const update of updates) {
      if (!update.rulesUrl) continue;
      try {
        const rules = (await (await this.fetchFn(update.rulesUrl)).json()) as { version: string };
        if (typeof rules.version !== 'string') {
          throw new Error(`rules payload for "${update.id}" is missing a version`);
        }
        writeOverrideSync(update.id, { ...rules, updatedAt: new Date().toISOString() });
        applied.push({ ...update, applied: true });
      } catch (err) {
        this.onError?.(err);
      }
    }
    return applied;
  }

  /**
   * Runs check -> apply periodically. `onUpdate` fires on every tick that
   * found something (module updates and/or a newer npm version).
   */
  watch(options: {
    intervalSeconds: number;
    onUpdate: (result: CheckResult, applied: ModuleUpdateInfo[]) => void;
    signal?: AbortSignal;
  }): { stop(): void } {
    const tick = async (): Promise<void> => {
      const result = await this.check();
      const applied = result.updates.length > 0 ? await this.apply(result.updates) : [];
      if (result.updates.length > 0 || result.npm) {
        options.onUpdate(result, applied);
      }
    };
    void tick().catch((err) => this.onError?.(err));
    const handle = setInterval(() => {
      void tick().catch((err) => this.onError?.(err));
    }, Math.max(1, options.intervalSeconds) * 1000);
    const stop = (): void => clearInterval(handle);
    options.signal?.addEventListener('abort', stop, { once: true });
    return { stop };
  }

  /** Compares the installed package version against the npm registry. */
  private async checkNpmVersion(): Promise<NpmUpdateInfo | null> {
    try {
      const res = await this.fetchFn('https://registry.npmjs.org/mugil-ide/latest');
      const data = (await res.json()) as { version?: string };
      if (!data.version) return null;
      const current = LOCAL_REGISTRY.package.version;
      return { current, latest: data.version };
    } catch (err) {
      this.onError?.(err);
      return null;
    }
  }
}
