import { RedisBackend } from '../src/modules/smart-cache/backends.js';
import { createClient, createCluster } from 'redis';
import type { CacheEntry } from '../src/types.js';

// Replace the redis module with fakes so tests never touch a real server.
jest.mock('redis', () => ({
  createClient: jest.fn(),
  createCluster: jest.fn(),
}));

// redis v4 exposes overloaded factory types; cast to jest.Mock for assertion.
const mockCreateClient = createClient as unknown as jest.Mock;
const mockCreateCluster = createCluster as unknown as jest.Mock;

interface FakeClient {
  isOpen: boolean;
  connect: jest.Mock;
  quit: jest.Mock;
  on: jest.Mock;
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  scan: jest.Mock;
  errorHandler?: () => void;
}

function makeFakeClient(): FakeClient {
  const client: FakeClient = {
    isOpen: false,
    connect: jest.fn(async () => {
      client.isOpen = true;
    }),
    quit: jest.fn(async () => {}),
    on: jest.fn((event: string, cb: () => void) => {
      if (event === 'error') client.errorHandler = cb;
    }),
    get: jest.fn(async () => null),
    set: jest.fn(async () => 'OK'),
    del: jest.fn(async () => 1),
    scan: jest.fn(async () => ({ cursor: '0', keys: [] })),
  };
  return client;
}

/** A fake client with an in-memory map so get/set/del round-trip. */
function makeMapClient(): { client: FakeClient; store: Map<string, string> } {
  const store = new Map<string, string>();
  const client = makeFakeClient();
  client.get = jest.fn(async (key: string) => store.get(key) ?? null);
  client.set = jest.fn(async (key: string, value: string) => {
    store.set(key, value);
    return 'OK';
  });
  client.del = jest.fn(async (key: string | string[]) => {
    const keys = Array.isArray(key) ? key : [key];
    let removed = 0;
    for (const k of keys) if (store.delete(k)) removed++;
    return removed;
  });
  return { client, store };
}

function makeEntry(overrides: Partial<CacheEntry> = {}): CacheEntry {
  return {
    key: 'k1',
    prompt: 'hello',
    response: 'hi',
    model: 'm',
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockCreateCluster.mockReset();
});

describe('RedisBackend connection modes', () => {
  it('uses a single client for one URL', () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    void backend.keys();
    expect(mockCreateClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    expect(mockCreateCluster).not.toHaveBeenCalled();
  });

  it('uses a cluster client for multiple URLs', () => {
    const client = makeFakeClient();
    mockCreateCluster.mockReturnValue(client);
    const backend = new RedisBackend(['redis://node1:6379', 'redis://node2:6379']);
    void backend.keys();
    expect(mockCreateCluster).toHaveBeenCalledWith({
      rootNodes: [{ url: 'redis://node1:6379' }, { url: 'redis://node2:6379' }],
    });
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('reuses the open client across calls', async () => {
    const { client } = makeMapClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    await backend.set(makeEntry());
    await backend.get('k1');
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
  });

  it('closes the client on close()', async () => {
    const { client } = makeMapClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    await backend.set(makeEntry());
    await backend.close();
    expect(client.quit).toHaveBeenCalled();
  });
});

describe('RedisBackend SCAN', () => {
  it('iterates SCAN pages with a cursor loop (no KEYS)', async () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    client.scan
      .mockResolvedValueOnce({
        cursor: '7',
        keys: ['aiide:cache:k1', 'aiide:cache:k2'],
      })
      .mockResolvedValueOnce({ cursor: '0', keys: ['aiide:cache:k3'] });
    const backend = new RedisBackend('redis://localhost:6379');
    const keys = await backend.keys();
    expect(keys).toEqual(['k1', 'k2', 'k3']);
    expect(client.scan).toHaveBeenCalledTimes(2);
    // Every page must be matched against the cache namespace.
    for (const call of client.scan.mock.calls) {
      expect(call[1]).toMatchObject({ MATCH: 'aiide:cache:*', COUNT: 100 });
    }
  });

  it('stops immediately when the first page returns cursor 0', async () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    client.scan.mockResolvedValueOnce({ cursor: '0', keys: ['aiide:cache:only'] });
    const backend = new RedisBackend('redis://localhost:6379');
    expect(await backend.keys()).toEqual(['only']);
    expect(client.scan).toHaveBeenCalledTimes(1);
  });

  it('clear() deletes each SCAN page in batches', async () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    client.scan
      .mockResolvedValueOnce({ cursor: '3', keys: ['aiide:cache:a', 'aiide:cache:b'] })
      .mockResolvedValueOnce({ cursor: '0', keys: ['aiide:cache:c'] });
    const backend = new RedisBackend('redis://localhost:6379');
    await backend.clear();
    expect(client.del).toHaveBeenCalledTimes(2);
    expect(client.del).toHaveBeenNthCalledWith(1, ['aiide:cache:a', 'aiide:cache:b']);
    expect(client.del).toHaveBeenNthCalledWith(2, ['aiide:cache:c']);
  });

  it('returns empty keys when scan fails', async () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    client.scan.mockRejectedValue(new Error('scan blew up'));
    const backend = new RedisBackend('redis://localhost:6379');
    expect(await backend.keys()).toEqual([]);
  });
});

describe('RedisBackend round-trip and degradation', () => {
  it('stores and retrieves a cache entry', async () => {
    const { client } = makeMapClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    const entry = makeEntry();
    await backend.set(entry);
    const got = await backend.get('k1');
    expect(got).toMatchObject({ key: 'k1', prompt: 'hello', response: 'hi' });
  });

  it('deletes expired entries on read', async () => {
    const { client, store } = makeMapClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    await backend.set(makeEntry({ expiresAt: Date.now() - 1 }));
    expect(store.size).toBe(1);
    const got = await backend.get('k1');
    expect(got).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('degrades gracefully when the connection fails', async () => {
    const client = makeFakeClient();
    mockCreateClient.mockReturnValue(client);
    client.connect.mockRejectedValue(new Error('connection refused'));
    const backend = new RedisBackend('redis://localhost:6379');
    await expect(backend.get('k1')).resolves.toBeUndefined();
    await expect(backend.keys()).resolves.toEqual([]);
    await expect(backend.clear()).resolves.toBeUndefined();
  });

  it('goes degraded after the client emits an error and stays degraded', async () => {
    const { client } = makeMapClient();
    mockCreateClient.mockReturnValue(client);
    const backend = new RedisBackend('redis://localhost:6379');
    await backend.set(makeEntry());
    client.errorHandler?.();
    // Error handler fires asynchronously from connect(); simulate a reconnect
    // attempt that fails so the broken flag persists.
    client.connect.mockRejectedValue(new Error('server gone'));
    expect(await backend.get('k1')).toBeUndefined();
    expect(await backend.keys()).toEqual([]);
  });
});
