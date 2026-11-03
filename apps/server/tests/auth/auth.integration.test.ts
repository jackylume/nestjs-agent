import 'reflect-metadata';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Module, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { NodeAdapter } from '@nestjs/platform-node';
import type { ApiResponse, LoginResponse, RegisterResponse } from '@nestjs-agent/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vite-plus/test';
import { ErrorFilter } from '../../src/common/filters/error.filter.js';
import { GlobalGuard } from '../../src/common/guards/global.guard.js';
import { SuccessInterceptor } from '../../src/common/interceptors/success.interceptor.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { SessionService } from '../../src/auth/session.service.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { UserModule } from '../../src/user/user.module.js';

@Module({
  imports: [AuthModule, UserModule],
  providers: [
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
class AuthIntegrationModule {}

interface AccessClaims {
  sub: string;
  sid: string;
  type: string;
  iat: number;
  exp: number;
}

describe.skipIf(process.env.AUTH_DB_INTEGRATION !== '1')(
  'PostgreSQL 用户与 Redis 会话的双 Token 生命周期',
  () => {
    const username = `auth_it_${randomBytes(12).toString('hex')}`;
    const credentials = { username, password: ' pass word ' };
    let app: INestApplication | undefined;
    let database: DatabaseService | undefined;
    let redis: RedisService;
    let sessions: SessionService;
    const sessionIds = new Set<string>();
    let jwt: JwtService;
    let baseUrl: string;
    let createdUserId: number | undefined;

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
      app = await NestFactory.create(AuthIntegrationModule, new NodeAdapter(), { logger: false });
      app.useGlobalPipes(
        new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
      );
      database = app.get<DatabaseService>(DatabaseService);
      jwt = app.get<JwtService>(JwtService);
      redis = app.get<RedisService>(RedisService);
      sessions = app.get<SessionService>(SessionService);
      await database.checkConnection();
      await app.listen(0, '127.0.0.1');
      await vi.waitFor(() => redis.checkConnection(), { timeout: 3000, interval: 25 });
      baseUrl = await app.getUrl();
    });

    afterAll(async () => {
      try {
        for (const id of sessionIds) await sessions.delete(id);
      } finally {
        try {
          if (database && createdUserId !== undefined) {
            await database.user.deleteMany({ where: { id: createdUserId, username } });
          }
        } finally {
          await app?.close();
        }
      }
    });

    function post(path: string, body?: unknown, accessToken?: string) {
      return fetch(`${baseUrl}/auth/${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }

    function getUser(accessToken?: string) {
      return fetch(`${baseUrl}/user/info`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      });
    }

    async function readTokens(response: Response): Promise<LoginResponse> {
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
      const result = (await response.json()) as ApiResponse<LoginResponse>;
      expect(result).toEqual({
        code: 200,
        success: true,
        data: {
          accessToken: expect.stringMatching(/^[^.]+\.[^.]+\.[^.]+$/),
          accessTokenExpiresAt: expect.any(String),
          refreshToken: expect.stringMatching(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/),
          refreshTokenExpiresAt: expect.any(String),
        },
        msg: '请求成功',
      });
      sessionIds.add(jwt.decode<AccessClaims>(result.data!.accessToken).sid);
      return result.data!;
    }

    it('验证两小时 Access、七天 Refresh、轮换、并发刷新和登出撤销', async () => {
      const registration = await post('register', credentials);
      const registered = (await registration.json()) as ApiResponse<RegisterResponse>;
      if (registration.status === 200 && typeof registered.data?.id === 'number') {
        createdUserId = registered.data.id;
      }
      expect(registration.status).toBe(200);
      expect(registered.data).toEqual({ id: expect.any(Number), username });

      const wrongPassword = await post('login', { ...credentials, password: 'wrong-password' });
      expect(wrongPassword.status).toBe(401);
      expect(await wrongPassword.json()).toMatchObject({ msg: '用户名或密码错误' });

      const startedAt = Date.now();
      const first = await readTokens(await post('login', credentials));
      const second = await readTokens(await post('login', credentials));
      const firstClaims = jwt.decode<AccessClaims>(first.accessToken);
      const secondClaims = jwt.decode<AccessClaims>(second.accessToken);
      expect(firstClaims).toMatchObject({ sub: String(createdUserId), type: 'access' });
      expect(firstClaims.exp - firstClaims.iat).toBe(2 * 60 * 60);
      expect(new Date(first.accessTokenExpiresAt).getTime()).toBe(firstClaims.exp * 1000);
      expect(new Date(first.refreshTokenExpiresAt).getTime() - startedAt).toBeGreaterThanOrEqual(
        7 * 24 * 60 * 60 * 1000,
      );
      expect(new Date(first.refreshTokenExpiresAt).getTime() - startedAt).toBeLessThan(
        7 * 24 * 60 * 60 * 1000 + 5000,
      );
      expect(firstClaims.sid).not.toBe(secondClaims.sid);
      expect(first.refreshToken).not.toBe(second.refreshToken);

      const stored = await sessions.find(firstClaims.sid);
      expect(stored).toMatchObject({ userId: createdUserId, authVersion: 0 });
      expect(await redis.client.pTTL(`nestjs-agent:session:${firstClaims.sid}`)).toBeGreaterThan(0);
      expect(stored!.refreshTokenHash).toBe(
        createHash('sha256').update(first.refreshToken).digest('hex'),
      );
      expect(JSON.stringify(stored)).not.toContain(first.refreshToken);
      const info = await getUser(first.accessToken);
      expect(info.status).toBe(200);
      expect(await info.json()).toEqual({
        code: 200,
        success: true,
        data: { id: createdUserId, username },
        msg: '请求成功',
      });
      expect((await getUser()).status).toBe(401);
      expect((await getUser(first.refreshToken)).status).toBe(401);
      const [header, payload, signature] = first.accessToken.split('.');
      const tampered = `${header}.${payload}.${signature![0] === 'a' ? 'b' : 'a'}${signature!.slice(1)}`;
      expect((await getUser(tampered)).status).toBe(401);

      const expiredAccess = await jwt.signAsync(
        { sub: firstClaims.sub, sid: firstClaims.sid, type: 'access' },
        { expiresIn: -1 },
      );
      expect((await getUser(expiredAccess)).status).toBe(401);
      const rotated = await readTokens(
        await post('refresh', { refreshToken: first.refreshToken }, expiredAccess),
      );
      expect(rotated.refreshToken).not.toBe(first.refreshToken);
      expect(rotated.refreshTokenExpiresAt).toBe(first.refreshTokenExpiresAt);
      expect((await getUser(rotated.accessToken)).status).toBe(200);
      expect((await post('refresh', { refreshToken: first.refreshToken })).status).toBe(401);

      const concurrent = await Promise.all([
        post('refresh', { refreshToken: rotated.refreshToken }),
        post('refresh', { refreshToken: rotated.refreshToken }),
      ]);
      expect(concurrent.map(({ status }) => status).sort((left, right) => left - right)).toEqual([
        200, 401,
      ]);
      const current = await readTokens(concurrent.find(({ status }) => status === 200)!);
      const logout = await post('logout', undefined, current.accessToken);
      expect(logout.status).toBe(200);
      expect(await logout.json()).toEqual({
        code: 200,
        success: true,
        data: null,
        msg: '请求成功',
      });
      expect((await getUser(first.accessToken)).status).toBe(401);
      expect((await getUser(current.accessToken)).status).toBe(401);
      expect((await post('refresh', { refreshToken: current.refreshToken })).status).toBe(401);
      expect((await post('logout', undefined, current.accessToken)).status).toBe(401);
      expect((await getUser(second.accessToken)).status).toBe(200);

      await redis.client.pExpire(`nestjs-agent:session:${secondClaims.sid}`, 1);
      await expect.poll(() => sessions.find(secondClaims.sid)).toBeNull();
      expect((await getUser(second.accessToken)).status).toBe(401);
      expect((await post('refresh', { refreshToken: second.refreshToken })).status).toBe(401);
    });
  },
);
