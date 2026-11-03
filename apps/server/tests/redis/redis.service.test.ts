import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { RedisService } from '../../src/redis/redis.service.js';

const connection = vi.hoisted(() => ({
  isReady: false,
  isOpen: false,
  on: vi.fn(),
  connect: vi.fn<() => Promise<void>>(),
  destroy: vi.fn(),
  ping: vi.fn<() => Promise<string>>(),
}));

vi.mock('redis', () => ({ createClient: () => connection }));

beforeEach(() => {
  vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:6379');
  vi.clearAllMocks();
  connection.isReady = false;
  connection.isOpen = false;
  connection.connect.mockResolvedValue(undefined);
  connection.ping.mockResolvedValue('PONG');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Redis 连接与请求边界', () => {
  it('连接尚未成功不阻塞启动，请求返回 503', async () => {
    connection.connect.mockReturnValue(new Promise(() => undefined));
    const service = new RedisService();

    expect(service.onModuleInit()).toBeUndefined();
    await expect(service.checkConnection()).rejects.toMatchObject({ status: 503 });
    expect(connection.ping).not.toHaveBeenCalled();
  });

  it('返回真实命令结果，完成后清理等待计时器', async () => {
    vi.useFakeTimers();
    connection.isReady = true;
    const service = new RedisService();

    await expect(service.run((client) => client.ping())).resolves.toBe('PONG');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('连接异常映射为 503，不泄漏内部错误', async () => {
    connection.isReady = true;
    connection.ping.mockRejectedValue(new Error('private Redis connection detail'));
    const service = new RedisService();

    await expect(service.checkConnection()).rejects.toMatchObject({
      status: 503,
      message: 'Redis 暂不可用',
    });
  });

  it('已经发送但没有响应的命令在三秒后返回 503', async () => {
    vi.useFakeTimers();
    connection.isReady = true;
    connection.ping.mockReturnValue(new Promise(() => undefined));
    const service = new RedisService();
    const result = service.checkConnection();
    const rejected = expect(result).rejects.toMatchObject({ status: 503 });

    await vi.advanceTimersByTimeAsync(3000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('关闭应用时终止连接及后台重连', () => {
    connection.isOpen = true;
    const service = new RedisService();

    service.onApplicationShutdown();
    expect(connection.destroy).toHaveBeenCalledOnce();
  });
});
