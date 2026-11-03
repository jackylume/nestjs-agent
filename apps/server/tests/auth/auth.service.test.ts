import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { verify } from 'argon2';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { DatabaseService } from '../../src/database/database.service.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { hashPassword } from '../../src/auth/password.util.js';
import type { RedisSession, SessionService } from '../../src/auth/session.service.js';

interface StoredUser {
  id: number;
  username: string;
  passwordHash: string;
  authVersion: number;
}

interface StoredSession extends RedisSession {
  id: string;
}

interface AccessClaims {
  sub: string;
  sid: string;
  type: string;
  iat: number;
  exp: number;
  jti: string;
}

const secret = randomBytes(32).toString('hex');
const jwt = new JwtService({
  secret,
  signOptions: { algorithm: 'HS256', issuer: 'nestjs-agent', audience: 'nestjs-agent-web' },
  verifyOptions: { algorithms: ['HS256'], issuer: 'nestjs-agent', audience: 'nestjs-agent-web' },
});
const create = vi.fn<(args: Prisma.UserCreateArgs) => Promise<StoredUser>>();
const findUser = vi.fn<(args: Prisma.UserFindUniqueArgs) => Promise<StoredUser | null>>();
const updateUser = vi.fn<(args: Prisma.UserUpdateManyArgs) => Promise<{ count: number }>>();
const createSession = vi.fn<(id: string, session: RedisSession) => Promise<void>>();
const findSession = vi.fn<(id: string) => Promise<RedisSession | null>>();
const rotateSession =
  vi.fn<(id: string, expectedHash: string, newHash: string) => Promise<boolean>>();
const deleteSession = vi.fn<(id: string) => Promise<void>>();
const sessions = new Map<string, StoredSession>();
const database = { user: { create, findUnique: findUser, updateMany: updateUser } };
const sessionService = {
  create: createSession,
  find: findSession,
  rotate: rotateSession,
  delete: deleteSession,
};
const service = new AuthService(
  database as unknown as DatabaseService,
  jwt,
  sessionService as unknown as SessionService,
);
const credentials = { username: 'jacky', password: ' pass word ' };
const user = { id: 1, username: 'jacky' };
let passwordHash: string;
let storedPasswordHash: string;
let authVersion: number;

function digest(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function seedSession(expiresAt = new Date(Date.now() + 7 * 86400_000)) {
  const id = randomUUID();
  const refreshToken = `${id}.${randomBytes(32).toString('hex')}`;
  const session = {
    id,
    refreshTokenHash: digest(refreshToken),
    userId: user.id,
    expiresAt: expiresAt.getTime(),
    authVersion,
  };
  sessions.set(id, session);
  return { session, refreshToken };
}

function accessClaims(session: StoredSession, claims: Record<string, unknown> = {}) {
  return {
    sub: String(session.userId),
    sid: session.id,
    type: 'access',
    jti: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 7200,
    ...claims,
  };
}

beforeAll(async () => {
  passwordHash = await hashPassword(credentials.password);
});

function duplicateUsernameError() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['username'] },
  });
}

beforeEach(() => {
  sessions.clear();
  storedPasswordHash = passwordHash;
  authVersion = 0;
  create.mockReset();
  create.mockImplementation(async ({ data }) => ({
    id: 1,
    username: data.username,
    passwordHash: data.passwordHash,
    authVersion: 0,
  }));
  findUser.mockReset();
  findUser.mockImplementation(async ({ where }) =>
    where.id === 2
      ? { id: 2, username: 'other', passwordHash, authVersion: 0 }
      : { ...user, passwordHash: storedPasswordHash, authVersion },
  );
  updateUser.mockReset();
  updateUser.mockImplementation(async ({ where, data }) => {
    if (where?.id !== user.id || where.passwordHash !== storedPasswordHash) return { count: 0 };
    if (typeof data.passwordHash === 'string') storedPasswordHash = data.passwordHash;
    if (typeof data.authVersion === 'object' && data.authVersion.increment)
      authVersion += data.authVersion.increment;
    return { count: 1 };
  });
  createSession.mockReset();
  createSession.mockImplementation(async (id, session) => {
    sessions.set(id, { ...session, id });
  });
  findSession.mockReset();
  findSession.mockImplementation(async (id) => {
    const session = sessions.get(id);
    return session ? { ...session } : null;
  });
  rotateSession.mockReset();
  rotateSession.mockImplementation(async (id, expectedHash, newHash) => {
    const session = sessions.get(id);
    if (!session || session.refreshTokenHash !== expectedHash || session.expiresAt <= Date.now())
      return false;
    session.refreshTokenHash = newHash;
    return true;
  });
  deleteSession.mockReset();
  deleteSession.mockImplementation(async (id) => {
    sessions.delete(id);
  });
});

describe('注册', () => {
  it('只返回用户标识，并仅写入用户名和新生成的密码哈希', async () => {
    const result = await service.register({
      username: 'jacky',
      password: 'test-password',
    });

    expect(result).toEqual({ id: 1, username: 'jacky' });
    expect(create).toHaveBeenCalledWith({
      data: { username: 'jacky', passwordHash: expect.stringMatching(/^\$argon2id\$/) },
      select: { id: true, username: true },
    });
    const storedHash = create.mock.calls[0]![0].data.passwordHash;
    expect(storedHash).not.toContain('test-password');
  });

  it('保存可验证的 Argon2id 哈希和随机盐，并原样处理密码首尾空白', async () => {
    const password = '  pass word  ';
    await service.register({ username: 'first', password });
    await service.register({ username: 'second', password });
    const firstHash = create.mock.calls[0]![0].data.passwordHash;
    const secondHash = create.mock.calls[1]![0].data.passwordHash;
    expect(firstHash).toMatch(/^\$argon2id\$/);
    expect(await verify(firstHash, password)).toBe(true);
    expect(await verify(firstHash, password.trim())).toBe(false);
    expect(await verify(secondHash, password)).toBe(true);
    expect(secondHash.split('$')[4]).not.toBe(firstHash.split('$')[4]);
    expect(secondHash).not.toBe(firstHash);
  });

  it('将数据库唯一约束冲突转换为 409', async () => {
    create.mockRejectedValue(duplicateUsernameError());

    await expect(
      service.register({ username: 'jacky', password: 'password' }),
    ).rejects.toMatchObject({
      status: 409,
      message: '用户名已存在',
    });
  });

  it('并发注册同名用户时由创建操作的唯一约束决定结果', async () => {
    const usernames = new Set<string>();
    create.mockImplementation(async ({ data }) => {
      if (usernames.has(data.username)) throw duplicateUsernameError();
      usernames.add(data.username);
      return { id: 1, username: data.username, passwordHash: data.passwordHash, authVersion: 0 };
    });

    const results = await Promise.allSettled([
      service.register({ username: 'jacky', password: 'password' }),
      service.register({ username: 'jacky', password: 'password' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.reason).toBeInstanceOf(ConflictException);
    expect(create).toHaveBeenCalledTimes(2);
    expect(usernames.size).toBe(1);
  });

  it('保留数据库的其他错误', async () => {
    const error = new Error('database unavailable');
    create.mockRejectedValue(error);

    await expect(service.register({ username: 'jacky', password: 'password' })).rejects.toBe(error);
  });
});

describe('双 Token 登录', () => {
  it('仅返回两小时 JWT、七天 Refresh Token 及过期时间，Redis 只保存刷新令牌哈希及会话元数据', async () => {
    const startedAt = Date.now();
    const result = await service.login(credentials);
    const claims = await jwt.verifyAsync<AccessClaims>(result.accessToken);
    const expiresAt = new Date(result.refreshTokenExpiresAt);

    expect(claims).toMatchObject({ sub: String(user.id), type: 'access' });
    expect(claims.exp - claims.iat).toBe(7200);
    expect(result).toEqual({
      accessToken: expect.any(String),
      accessTokenExpiresAt: new Date(claims.exp * 1000).toISOString(),
      refreshToken: expect.stringMatching(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/),
      refreshTokenExpiresAt: expiresAt.toISOString(),
    });
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + 7 * 86400_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 86400_000);
    expect(sessions.get(claims.sid)).toMatchObject({
      refreshTokenHash: digest(result.refreshToken),
      userId: user.id,
      expiresAt: expiresAt.getTime(),
      authVersion: 0,
    });
    expect(JSON.stringify(createSession.mock.calls)).not.toContain(result.refreshToken);
    expect(JSON.stringify(result)).not.toContain(passwordHash);
    expect(JSON.stringify(result)).not.toContain(credentials.password);
  });

  it('重复登录创建独立会话，不影响已有会话', async () => {
    const active = seedSession();
    const first = await service.login(credentials);
    const second = await service.login(credentials);
    expect(first.refreshToken).not.toBe(second.refreshToken);
    expect(first.accessToken).not.toBe(second.accessToken);
    expect(sessions.has(active.session.id)).toBe(true);
    expect(sessions.size).toBe(3);
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    { name: '错误密码', password: 'wrong-password', missingUser: false },
    { name: '去掉密码首尾空格', password: credentials.password.trim(), missingUser: false },
    { name: '用户不存在', password: credentials.password, missingUser: true },
  ])('$name 返回相同 401，不创建或删除会话', async ({ password, missingUser }) => {
    if (missingUser) findUser.mockResolvedValue(null);
    await expect(service.login({ username: 'jacky', password })).rejects.toMatchObject({
      status: 401,
      message: '用户名或密码错误',
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it.each([
    { name: '密码哈希损坏', hash: 'broken-hash' },
    {
      name: '旧 scrypt 密码哈希',
      hash: 'scrypt$131072$8$1$00112233445566778899aabbccddeeff$74172bfdf2deccbf4b83a85996eb58d796793aa32a5209d12fd74ac0040791a1392d25dcdfe9a7fac1087409882a0759e30be967a5959f77289f962c74ae024b',
    },
  ])('$name 时拒绝登录', async ({ hash }) => {
    findUser.mockResolvedValue({ ...user, passwordHash: hash, authVersion });
    await expect(service.login(credentials)).rejects.toMatchObject({ status: 401 });
    expect(createSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  it('Redis 写入失败不返回凭证', async () => {
    const error = new Error('session write failed');
    createSession.mockRejectedValue(error);
    await expect(service.login(credentials)).rejects.toBe(error);
  });

  it('旧密码校验后发生改密，随后创建的旧版本会话不能使用', async () => {
    const writeSession = createSession.getMockImplementation()!;
    createSession.mockImplementationOnce(async (id, session) => {
      await service.changePassword(user.id, {
        oldPassword: credentials.password,
        newPassword: 'new-password',
      });
      await writeSession(id, session);
    });
    const result = await service.login(credentials);
    const claims = await jwt.verifyAsync<AccessClaims>(result.accessToken);
    expect(authVersion).toBe(1);
    expect(sessions.get(claims.sid)?.authVersion).toBe(0);
    await expect(service.validateAccessToken(claims)).rejects.toMatchObject({ status: 401 });
    await expect(service.refresh(result.refreshToken)).rejects.toMatchObject({ status: 401 });
  });
});

describe('Access Token 身份与会话校验', () => {
  it('校验载荷与存续会话，仅返回用户标识', async () => {
    const { session } = seedSession();
    await expect(service.validateAccessToken(accessClaims(session))).resolves.toEqual(user);
    expect(findSession).toHaveBeenCalledOnce();
  });

  it.each([null, undefined, '', 1, [], {}])('无效载荷不查询会话：%j', async (claims) => {
    await expect(service.validateAccessToken(claims)).rejects.toMatchObject({ status: 401 });
    expect(findSession).not.toHaveBeenCalled();
  });

  it.each([
    { name: '错误 token 类型', claims: { type: 'refresh' } },
    { name: '缺少 session ID', claims: { sid: undefined } },
    { name: '畸形 session ID', claims: { sid: 'invalid-session' } },
    { name: '非数字 user ID', claims: { sub: 'not-a-user-id' } },
    { name: '非安全整数 user ID', claims: { sub: '9007199254740992' } },
    { name: '缺少过期时间', claims: { exp: undefined } },
    { name: '非整数过期时间', claims: { exp: 1.5 } },
  ])('$name 拒绝认证', async ({ claims }) => {
    const { session } = seedSession();
    await expect(service.validateAccessToken(accessClaims(session, claims))).rejects.toMatchObject({
      status: 401,
    });
    expect(findSession).not.toHaveBeenCalled();
  });

  it('已删除、到期或不属于该用户的会话拒绝认证', async () => {
    const { session } = seedSession();
    const claims = accessClaims(session);
    session.userId = 2;
    await expect(service.validateAccessToken(claims)).rejects.toMatchObject({ status: 401 });
    session.userId = user.id;
    session.expiresAt = Date.now();
    await expect(service.validateAccessToken(claims)).rejects.toMatchObject({ status: 401 });
    sessions.clear();
    await expect(service.validateAccessToken(claims)).rejects.toMatchObject({ status: 401 });
  });

  it('数据库错误不被误报为 401', async () => {
    const { session } = seedSession();
    const error = new Error('database unavailable');
    findUser.mockRejectedValue(error);
    await expect(service.validateAccessToken(accessClaims(session))).rejects.toBe(error);
  });

  it('Redis 查询失败保留基础设施错误', async () => {
    const { session } = seedSession();
    const error = new Error('Redis unavailable');
    findSession.mockRejectedValue(error);
    await expect(service.validateAccessToken(accessClaims(session))).rejects.toBe(error);
  });

  it('用户已删除时，即使 Redis 会话尚未过期也拒绝访问和刷新', async () => {
    const { session, refreshToken } = seedSession();
    findUser.mockResolvedValue(null);
    await expect(service.validateAccessToken(accessClaims(session))).rejects.toMatchObject({
      status: 401,
    });
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });
    expect(rotateSession).not.toHaveBeenCalled();
  });
});

describe('Refresh Token 轮换', () => {
  it('轮换两个 Token，但不延长七天会话截止时间', async () => {
    const { session, refreshToken } = seedSession();
    const first = await service.refresh(refreshToken);
    const claims = await jwt.verifyAsync<AccessClaims>(first.accessToken);
    const second = await service.refresh(first.refreshToken);
    expect(first).toEqual({
      accessToken: expect.any(String),
      accessTokenExpiresAt: new Date(claims.exp * 1000).toISOString(),
      refreshToken: expect.stringMatching(/^[a-f0-9-]{36}\.[a-f0-9]{64}$/),
      refreshTokenExpiresAt: new Date(session.expiresAt).toISOString(),
    });
    expect(first.refreshToken).not.toBe(refreshToken);
    expect(first.refreshTokenExpiresAt).toBe(new Date(session.expiresAt).toISOString());
    expect(claims.exp - claims.iat).toBe(7200);
    expect(claims.sid).toBe(session.id);
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.accessToken).not.toBe(first.accessToken);
    expect(second.refreshTokenExpiresAt).toBe(new Date(session.expiresAt).toISOString());
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(
      service.validateAccessToken(await jwt.verifyAsync<AccessClaims>(second.accessToken)),
    ).resolves.toEqual(user);
  });

  it('新 Access Token 不能超过剩余会话期限', async () => {
    const { session, refreshToken } = seedSession(new Date(Date.now() + 60_000));
    const result = await service.refresh(refreshToken);
    const claims = await jwt.verifyAsync<AccessClaims>(result.accessToken);
    expect(claims.exp * 1000).toBeLessThanOrEqual(session.expiresAt);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
    expect(result.refreshTokenExpiresAt).toBe(new Date(session.expiresAt).toISOString());
  });

  it('同一刷新凭证并发使用只成功一次，失败方不撤销成功会话', async () => {
    const { refreshToken } = seedSession();
    const results = await Promise.allSettled([
      service.refresh(refreshToken),
      service.refresh(refreshToken),
    ]);
    const succeeded = results.filter((result) => result.status === 'fulfilled');
    const failed = results.filter((result) => result.status === 'rejected');
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.reason).toMatchObject({ status: 401 });
    const result = succeeded[0]!.value;
    await expect(
      service.validateAccessToken(await jwt.verifyAsync<AccessClaims>(result.accessToken)),
    ).resolves.toEqual(user);
    await expect(service.refresh(result.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
      refreshTokenExpiresAt: result.refreshTokenExpiresAt,
    });
  });

  it.each(['', 'invalid-token', `${randomUUID()}.short`])(
    '畸形刷新凭证不查数据库：%j',
    async (token) => {
      await expect(service.refresh(token)).rejects.toMatchObject({ status: 401 });
      expect(findSession).not.toHaveBeenCalled();
      expect(rotateSession).not.toHaveBeenCalled();
    },
  );

  it('哈希不匹配、到期和不存在的会话不能刷新', async () => {
    const { session, refreshToken } = seedSession();
    await expect(service.refresh(`${session.id}.${'0'.repeat(64)}`)).rejects.toMatchObject({
      status: 401,
    });
    session.expiresAt = Date.now();
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });
    sessions.clear();
    await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });
    expect(rotateSession).not.toHaveBeenCalled();
  });

  it('Redis 轮换失败时不返回新凭证', async () => {
    const { refreshToken } = seedSession();
    const error = new Error('database write failed');
    rotateSession.mockRejectedValue(error);
    await expect(service.refresh(refreshToken)).rejects.toBe(error);
  });
});

describe('登出', () => {
  it('按会话 ID 撤销当前会话的两种 Token，其他会话保持有效', async () => {
    const first = seedSession();
    const second = seedSession();
    const firstClaims = accessClaims(first.session);
    const secondClaims = accessClaims(second.session);
    await expect(service.logout(first.session.id)).resolves.toBeNull();
    await expect(service.validateAccessToken(firstClaims)).rejects.toMatchObject({ status: 401 });
    await expect(service.refresh(first.refreshToken)).rejects.toMatchObject({ status: 401 });
    await expect(service.validateAccessToken(secondClaims)).resolves.toEqual(user);
    await expect(service.refresh(second.refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
      refreshTokenExpiresAt: new Date(second.session.expiresAt).toISOString(),
    });
  });

  it('不存在的会话与重复退出幂等成功', async () => {
    const { session } = seedSession();
    await expect(service.logout(session.id)).resolves.toBeNull();
    expect(sessions.has(session.id)).toBe(false);
    await expect(service.logout(session.id)).resolves.toBeNull();
    await expect(service.logout('invalid')).resolves.toBeNull();
  });

  it('Redis 撤销失败不返回成功', async () => {
    const { session } = seedSession();
    const error = new Error('database delete failed');
    deleteSession.mockRejectedValue(error);
    await expect(service.logout(session.id)).rejects.toBe(error);
  });
});

describe('修改密码', () => {
  const dto = { oldPassword: credentials.password, newPassword: ' new password ' };

  it('更新密码哈希并撤销该用户全部会话，保留其他用户会话', async () => {
    const first = seedSession();
    const second = seedSession();
    const other = seedSession();
    other.session.userId = 2;

    await expect(service.changePassword(user.id, dto)).resolves.toBeNull();
    expect(storedPasswordHash).toMatch(/^\$argon2id\$/);
    expect(storedPasswordHash).not.toBe(passwordHash);
    expect(await verify(storedPasswordHash, dto.newPassword)).toBe(true);
    expect(await verify(storedPasswordHash, dto.newPassword.trim())).toBe(false);
    expect(await verify(storedPasswordHash, dto.oldPassword)).toBe(false);
    for (const { session, refreshToken } of [first, second]) {
      await expect(service.validateAccessToken(accessClaims(session))).rejects.toMatchObject({
        status: 401,
      });
      await expect(service.refresh(refreshToken)).rejects.toMatchObject({ status: 401 });
    }
    await expect(service.validateAccessToken(accessClaims(other.session))).resolves.toEqual({
      id: 2,
      username: 'other',
    });
    await expect(service.login(credentials)).rejects.toMatchObject({ status: 401 });
    await expect(
      service.login({ username: user.username, password: dto.newPassword }),
    ).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
  });

  it.each(['wrong-password', credentials.password.trim()])(
    '旧密码不匹配时返回400且不更改密码或会话：%s',
    async (oldPassword) => {
      const { session } = seedSession();
      await expect(service.changePassword(user.id, { ...dto, oldPassword })).rejects.toMatchObject({
        status: 400,
        message: '旧密码不正确',
      });
      expect(storedPasswordHash).toBe(passwordHash);
      expect(sessions.has(session.id)).toBe(true);
      expect(updateUser).not.toHaveBeenCalled();
      expect(deleteSession).not.toHaveBeenCalled();
    },
  );

  it('用户不存在时返回401，不写入数据库', async () => {
    findUser.mockResolvedValue(null);
    await expect(service.changePassword(user.id, dto)).rejects.toMatchObject({ status: 401 });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('同一个旧密码并发修改时只有一个成功，失败方不覆盖新密码', async () => {
    const results = await Promise.allSettled([
      service.changePassword(user.id, dto),
      service.changePassword(user.id, { ...dto, newPassword: 'another-password' }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.reason).toMatchObject({ status: 409 });
    const successfulPassword =
      results[0]!.status === 'fulfilled' ? dto.newPassword : 'another-password';
    expect(await verify(storedPasswordHash, successfulPassword)).toBe(true);
    expect(authVersion).toBe(1);
  });

  it('密码更新失败时保留密码、认证版本和会话，并保留数据库错误', async () => {
    const { session, refreshToken } = seedSession();
    const error = new Error('password write failed');
    updateUser.mockRejectedValue(error);
    await expect(service.changePassword(user.id, dto)).rejects.toBe(error);
    expect(storedPasswordHash).toBe(passwordHash);
    expect(authVersion).toBe(0);
    await expect(service.validateAccessToken(accessClaims(session))).resolves.toEqual(user);
    await expect(service.refresh(refreshToken)).resolves.toMatchObject({
      accessToken: expect.any(String),
    });
    expect(deleteSession).not.toHaveBeenCalled();
  });
});
