import { jest } from '@jest/globals';
import { createShutdownHandler } from '../src/shutdown.js';

describe('createShutdownHandler', () => {
  it('executes stopLlama -> closeServer -> closeBackend -> exit in exact order', async () => {
    const order: string[] = [];

    const stopLlama = jest.fn().mockImplementation(async () => {
      order.push('stopLlama');
    });
    const closeServer = jest.fn().mockImplementation(async () => {
      order.push('closeServer');
    });
    const closeBackend = jest.fn().mockImplementation(async () => {
      order.push('closeBackend');
    });
    const exit = jest.fn().mockImplementation((code) => {
      order.push(`exit:${code}`);
    });

    const shutdown = createShutdownHandler({
      stopLlama,
      closeServer,
      closeBackend,
      exit,
      graceMs: 100,
    });

    await shutdown();

    expect(order).toEqual(['stopLlama', 'closeServer', 'closeBackend', 'exit:0']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('proceeds through all steps even if stopLlama rejects', async () => {
    const order: string[] = [];

    const stopLlama = jest.fn().mockRejectedValue(new Error('Llama crashed'));
    const closeServer = jest.fn().mockImplementation(async () => {
      order.push('closeServer');
    });
    const closeBackend = jest.fn().mockImplementation(async () => {
      order.push('closeBackend');
    });
    const exit = jest.fn().mockImplementation((code) => {
      order.push(`exit:${code}`);
    });

    const shutdown = createShutdownHandler({
      stopLlama,
      closeServer,
      closeBackend,
      exit,
      graceMs: 100,
    });

    await shutdown();

    expect(order).toEqual(['closeServer', 'closeBackend', 'exit:0']);
  });

  it('abandons hanging step after graceMs deadline and completes shutdown', async () => {
    const order: string[] = [];

    const stopLlama = jest.fn().mockImplementation(() => new Promise(() => {})); // Never resolves
    const closeServer = jest.fn().mockImplementation(async () => {
      order.push('closeServer');
    });
    const closeBackend = jest.fn().mockImplementation(async () => {
      order.push('closeBackend');
    });
    const exit = jest.fn().mockImplementation((code) => {
      order.push(`exit:${code}`);
    });

    const shutdown = createShutdownHandler({
      stopLlama,
      closeServer,
      closeBackend,
      exit,
      graceMs: 50,
    });

    await shutdown();

    expect(order).toEqual(['closeServer', 'closeBackend', 'exit:0']);
  });

  it('is idempotent: repeated invocations do not duplicate close calls', async () => {
    const stopLlama = jest.fn().mockResolvedValue(undefined);
    const closeServer = jest.fn().mockResolvedValue(undefined);
    const closeBackend = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();

    const shutdown = createShutdownHandler({
      stopLlama,
      closeServer,
      closeBackend,
      exit,
      graceMs: 100,
    });

    await Promise.all([shutdown(), shutdown(), shutdown()]);

    expect(stopLlama).toHaveBeenCalledTimes(1);
    expect(closeServer).toHaveBeenCalledTimes(1);
    expect(closeBackend).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
