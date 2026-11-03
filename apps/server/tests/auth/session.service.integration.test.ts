import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createClient } from 'redis';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';
import { SessionService } from '../../src/auth/session.service.js';
import type { RedisSession } from '../../src/auth/session.service.js';
import type { RedisService } from '../../src/redis/redis.service.js';

describe.skipIf(process.env.AUTH_DB_INTEGRATION !== '1')('真实 Redis 会话存储', () => {
  const ids = new Set<string>();
  let client: ReturnType<typeof createClient>;
  let service: SessionService;

  beforeAll(async () => {
    const envFile = new URL('../../../../.env', import.meta.url);
    if (existsSync(envFile)) loadEnvFile(envFile);
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(redisUrl).hostname)) {
      throw new Error('会话集成测试仅支持本机 Redis，请检查 REDIS_URL。');
    }
    client = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: { connectTimeout: 3000, reconnectStrategy: false },
    });
    client.on('error', () => undefined);
    await client.connect();
    const redis: Pick<RedisService, 'run'> = { run: (operation) => operation(client) };
    service = new SessionService(redis as RedisService);
  });

  afterEach(async () => {
    try {
      if (client?.isReady && ids.size > 0) {
        await client.del([...ids].map((id) => `nestjs-agent:session:${id}`));
      }
    } finally {
      ids.clear();
    }
  });

  afterAll(async () => {
    if (client?.isOpen) await client.close();
  });

  function sessionId() {
    const id = randomUUID();
    ids.add(id);
    return id;
  }

  function session(lifetime = 60_000): RedisSession {
    return {
      userId: 1,
      authVersion: 3,
      refreshTokenHash: randomBytes(32).toString('hex'),
      expiresAt: Date.now() + lifetime,
    };
  }

  it('写入会话并设置固定的绝对过期时间', async () => {
    const id = sessionId();
    const value = session();
    await service.create(id, value);

    expect(await service.find(id)).toEqual(value);
    expect(await client.pExpireTime(`nestjs-agent:session:${id}`)).toBe(value.expiresAt);
  });

  it('不会覆盖同一个 ID 已有的会话', async () => {
    const id = sessionId();
    const original = session();
    await service.create(id, original);

    await expect(service.create(id, session())).rejects.toThrow('登录会话已存在');
    expect(await service.find(id)).toEqual(original);
  });

  it('拒绝创建已经到期的会话', async () => {
    const id = sessionId();
    await expect(service.create(id, session(-1))).rejects.toThrow('不能创建已到期的登录会话');
    expect(await service.find(id)).toBeNull();
  });

  it('轮换使旧摘要失效，并保留其他字段与原来的到期时间', async () => {
    const id = sessionId();
    const original = session();
    const newHash = randomBytes(32).toString('hex');
    await service.create(id, original);

    expect(await service.rotate(id, original.refreshTokenHash, newHash)).toBe(true);
    expect(await service.find(id)).toEqual({ ...original, refreshTokenHash: newHash });
    expect(await client.pExpireTime(`nestjs-agent:session:${id}`)).toBe(original.expiresAt);
    expect(await service.rotate(id, original.refreshTokenHash, 'replayed-hash')).toBe(false);
    expect((await service.find(id))?.refreshTokenHash).toBe(newHash);
  });

  it('同一个旧摘要并发轮换时只有一次成功', async () => {
    const id = sessionId();
    const original = session();
    const replacements = Array.from({ length: 8 }, () => randomBytes(32).toString('hex'));
    await service.create(id, original);

    const results = await Promise.all(
      replacements.map((newHash) => service.rotate(id, original.refreshTokenHash, newHash)),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await service.find(id))?.refreshTokenHash).toBe(
      replacements[results.findIndex(Boolean)],
    );
    expect(await client.pExpireTime(`nestjs-agent:session:${id}`)).toBe(original.expiresAt);
  });

  it('删除幂等，已删除的会话不能通过轮换重新创建', async () => {
    const id = sessionId();
    const original = session();
    await service.create(id, original);
    await service.delete(id);
    await service.delete(id);

    expect(await service.rotate(id, original.refreshTokenHash, 'new-hash')).toBe(false);
    expect(await service.find(id)).toBeNull();
  });

  it('退出与刷新并发时，刷新不能把已删除会话写回来', async () => {
    const id = sessionId();
    const original = session();
    await service.create(id, original);

    await Promise.all([
      service.rotate(id, original.refreshTokenHash, 'new-hash'),
      service.delete(id),
    ]);

    expect(await service.find(id)).toBeNull();
  });

  it('TTL 到期后会话消失，轮换不能恢复过期会话', async () => {
    const id = sessionId();
    const original = session(200);
    await service.create(id, original);

    await expect.poll(() => service.find(id), { timeout: 3000, interval: 20 }).toBeNull();
    expect(await service.rotate(id, original.refreshTokenHash, 'new-hash')).toBe(false);
    expect(await service.find(id)).toBeNull();
  });
});
