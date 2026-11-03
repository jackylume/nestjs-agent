import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Module, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { NodeAdapter } from '@nestjs/platform-node';
import type { ApiResponse, LoginResponse, RegisterResponse } from '@nestjs-agent/shared';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { ErrorFilter } from '../../src/common/filters/error.filter.js';
import { GlobalGuard } from '../../src/common/guards/global.guard.js';
import { SuccessInterceptor } from '../../src/common/interceptors/success.interceptor.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { SessionService } from '../../src/auth/session.service.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { verifyPassword } from '../../src/auth/password.util.js';
import { UserModule } from '../../src/user/user.module.js';

@Module({
  imports: [AuthModule, UserModule],
  providers: [
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
class ChangePasswordIntegrationModule {}

describe.skipIf(process.env.AUTH_DB_INTEGRATION !== '1')('PostgreSQL 改密与 Redis 会话撤销', () => {
  const usernames = new Set<string>();
  let app: INestApplication | undefined;
  let database: DatabaseService | undefined;
  let redis: RedisService;
  let sessions: SessionService;
  const sessionIds = new Set<string>();
  let auth: AuthService;
  let jwt: JwtService;
  let baseUrl: string;

  beforeAll(async () => {
    const envFile = new URL('../../../../.env', import.meta.url);
    if (existsSync(envFile)) loadEnvFile(envFile);
    const databaseUrl = process.env.DATABASE_URL;
    if (
      !databaseUrl ||
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)
    ) {
      throw new Error('认证集成测试仅支持本机 PostgreSQL，请检查 DATABASE_URL。');
    }
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(redisUrl).hostname)) {
      throw new Error('认证集成测试仅支持本机 Redis，请检查 REDIS_URL。');
    }
    app = await NestFactory.create(ChangePasswordIntegrationModule, new NodeAdapter(), {
      logger: false,
    });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
    );
    database = app.get<DatabaseService>(DatabaseService);
    auth = app.get<AuthService>(AuthService);
    jwt = app.get<JwtService>(JwtService);
    redis = app.get<RedisService>(RedisService);
    sessions = app.get<SessionService>(SessionService);
    await database.checkConnection();
    await app.listen(0, '127.0.0.1');
    await vi.waitFor(() => redis.checkConnection(), { timeout: 3000, interval: 25 });
    baseUrl = await app.getUrl();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    try {
      for (const id of sessionIds) await sessions.delete(id);
    } finally {
      sessionIds.clear();
      if (database && usernames.size > 0) {
        await database.user.deleteMany({ where: { username: { in: [...usernames] } } });
        usernames.clear();
      }
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  function post(path: string, body: unknown, accessToken?: string) {
    return fetch(`${baseUrl}/auth/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function getUser(accessToken: string) {
    return fetch(`${baseUrl}/user/info`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  }

  async function createUser() {
    const credentials = {
      username: `change_it_${randomBytes(10).toString('hex')}`,
      password: ' pass word ',
    };
    usernames.add(credentials.username);
    const response = await post('register', credentials);
    expect(response.status).toBe(200);
    const result = (await response.json()) as ApiResponse<RegisterResponse>;
    return { id: result.data!.id, credentials };
  }

  async function login(credentials: { username: string; password: string }) {
    const response = await post('login', credentials);
    expect(response.status).toBe(200);
    const result = (await response.json()) as ApiResponse<LoginResponse>;
    sessionIds.add(jwt.decode<{ sid: string }>(result.data!.accessToken).sid);
    return result.data!;
  }

  it('校验旧密码、保存新密码、撤销全部本人会话，保留其他用户会话', async () => {
    const owner = await createUser();
    const other = await createUser();
    const first = await login(owner.credentials);
    const second = await login(owner.credentials);
    const otherTokens = await login(other.credentials);
    const newPassword = ' new password ';

    const invalid = await post(
      'change-password',
      { oldPassword: `${owner.credentials.password}x`, newPassword },
      first.accessToken,
    );
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ msg: '旧密码不正确' });
    expect((await getUser(first.accessToken)).status).toBe(200);
    expect((await getUser(second.accessToken)).status).toBe(200);

    const changed = await post(
      'change-password',
      { oldPassword: owner.credentials.password, newPassword },
      first.accessToken,
    );
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({
      code: 200,
      success: true,
      data: null,
      msg: '请求成功',
    });
    const stored = await database!.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await verifyPassword(newPassword, stored.passwordHash)).toBe(true);
    expect(await verifyPassword(owner.credentials.password, stored.passwordHash)).toBe(false);
    expect(stored.authVersion).toBe(1);

    for (const tokens of [first, second]) {
      expect((await getUser(tokens.accessToken)).status).toBe(401);
      expect((await post('refresh', { refreshToken: tokens.refreshToken })).status).toBe(401);
    }
    expect((await getUser(otherTokens.accessToken)).status).toBe(200);
    expect((await post('refresh', { refreshToken: otherTokens.refreshToken })).status).toBe(200);
    expect((await post('login', owner.credentials)).status).toBe(401);
    const renewed = await login({ ...owner.credentials, password: newPassword });
    expect((await getUser(renewed.accessToken)).status).toBe(200);
  });

  it('数据库更新失败时密码和认证版本不变，原会话仍有效', async () => {
    const owner = await createUser();
    const tokens = await login(owner.credentials);
    const previous = await database!.user.findUniqueOrThrow({ where: { id: owner.id } });
    const error = new Error('password update failed');
    const updateSpy = vi.spyOn(database!.user, 'updateMany').mockRejectedValueOnce(error);

    try {
      await expect(
        auth.changePassword(owner.id, {
          oldPassword: owner.credentials.password,
          newPassword: 'new-password',
        }),
      ).rejects.toBe(error);
    } finally {
      updateSpy.mockRestore();
    }

    const stored = await database!.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(stored.passwordHash).toBe(previous.passwordHash);
    expect(stored.authVersion).toBe(previous.authVersion);
    expect((await getUser(tokens.accessToken)).status).toBe(200);
    await login(owner.credentials);
  });

  it('旧密码登录通过校验后遇到改密，随后创建的旧版本会话无法使用', async () => {
    const owner = await createUser();
    let entered!: () => void;
    let resume!: () => void;
    const creating = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const released = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const create = sessions.create.bind(sessions);
    const createSpy = vi.spyOn(sessions, 'create').mockImplementationOnce(async (id, session) => {
      sessionIds.add(id);
      entered();
      await released;
      await create(id, session);
    });
    const pendingLogin = auth.login(owner.credentials);
    let stale: LoginResponse;

    try {
      await creating;
      await auth.changePassword(owner.id, {
        oldPassword: owner.credentials.password,
        newPassword: 'new-password',
      });
    } finally {
      resume();
      createSpy.mockRestore();
      stale = await pendingLogin;
    }

    const sessionId = jwt.decode<{ sid: string }>(stale.accessToken).sid;
    expect((await sessions.find(sessionId))?.authVersion).toBe(0);
    expect((await getUser(stale.accessToken)).status).toBe(401);
    expect((await post('refresh', { refreshToken: stale.refreshToken })).status).toBe(401);
    const current = await login({ ...owner.credentials, password: 'new-password' });
    expect((await getUser(current.accessToken)).status).toBe(200);
  });
});
