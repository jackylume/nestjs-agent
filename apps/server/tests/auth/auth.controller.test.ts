import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Module,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { NodeAdapter } from '@nestjs/platform-node';
import type { LoginResponse, RegisterResponse, UserResponse } from '@nestjs-agent/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { ErrorFilter } from '../../src/common/filters/error.filter.js';
import { GlobalGuard } from '../../src/common/guards/global.guard.js';
import { SuccessInterceptor } from '../../src/common/interceptors/success.interceptor.js';
import { AuthController } from '../../src/auth/auth.controller.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { JwtStrategy } from '../../src/auth/jwt.strategy.js';
import { RegisterDto } from '../../src/auth/dto/register.dto.js';
import { LoginDto } from '../../src/auth/dto/login.dto.js';
import type { ChangePasswordDto } from '../../src/auth/dto/change-password.dto.js';
import { UserModule } from '../../src/user/user.module.js';

const register = vi.fn<(dto: RegisterDto) => Promise<RegisterResponse>>();
const login = vi.fn<(dto: LoginDto) => Promise<LoginResponse>>();
const logout = vi.fn<(sessionId: string) => Promise<null>>();
const refresh = vi.fn<(token: string) => Promise<LoginResponse>>();
const changePassword = vi.fn<(userId: number, dto: ChangePasswordDto) => Promise<null>>();
const validateAccessToken = vi.fn<(claims: unknown) => Promise<UserResponse>>();
const secret = randomBytes(32).toString('hex');
const jwt = new JwtService({ secret });
const claims = {
  sub: '1',
  sid: randomUUID(),
  type: 'access',
  exp: Math.floor(Date.now() / 1000) + 7200,
  iss: 'nestjs-agent',
  aud: 'nestjs-agent-web',
};
const token = jwt.sign(claims, { algorithm: 'HS256' });
const refreshToken = `11111111-1111-4111-8111-111111111111.${'ab'.repeat(32)}`;
const loginResponse: LoginResponse = {
  accessToken: token,
  accessTokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
  refreshToken,
  refreshTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};

@Module({
  imports: [PassportModule, UserModule],
  controllers: [AuthController],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
    {
      provide: AuthService,
      useValue: {
        register,
        login,
        logout,
        refresh,
        validateAccessToken,
        changePassword,
      },
    },
  ],
})
class TestAuthModule {}

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  vi.stubEnv('JWT_SECRET', secret);
  app = await NestFactory.create(TestAuthModule, new NodeAdapter(), { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
  );
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  try {
    await app?.close();
  } finally {
    vi.unstubAllEnvs();
  }
});

beforeEach(() => {
  register.mockReset();
  register.mockResolvedValue({ id: 1, username: 'jacky' });
  login.mockReset();
  login.mockResolvedValue(loginResponse);
  refresh.mockReset();
  refresh.mockResolvedValue(loginResponse);
  logout.mockReset();
  logout.mockResolvedValue(null);
  changePassword.mockReset();
  changePassword.mockResolvedValue(null);
  validateAccessToken.mockReset();
  validateAccessToken.mockResolvedValue({ id: 1, username: 'jacky' });
});

function postRegistration(body: unknown) {
  return fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /auth/register', () => {
  it.each([
    { username: 'ab', password: 'password' },
    { username: 'jacky', password: 'abcdef\n' },
  ])('输入无效时返回 400，且不调用 Service：%j', async (body) => {
    const response = await postRegistration(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      success: false,
      data: null,
      msg: expect.any(String),
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('以清理后的 DTO 调用 Service 并返回 200，保留密码原文、剔除额外字段', async () => {
    const response = await postRegistration({
      username: '  jacky  ',
      password: ' pass word ',
      id: 999,
      passwordHash: 'supplied-hash',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { id: 1, username: 'jacky' },
      msg: '请求成功',
    });
    expect(register).toHaveBeenCalledExactlyOnceWith({
      username: 'jacky',
      password: ' pass word ',
    });
    expect(register.mock.calls[0]![0]).toBeInstanceOf(RegisterDto);
  });

  it('用户名冲突仍返回 409，不会被成功状态码覆盖', async () => {
    register.mockRejectedValueOnce(new ConflictException('用户名已存在'));

    const response = await postRegistration({ username: 'jacky', password: 'password' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 409,
      success: false,
      data: null,
      msg: '用户名已存在',
    });
    expect(register).toHaveBeenCalledOnce();
  });
});

describe('POST /auth/login', () => {
  it('允许未登录用户登录，清理用户名且保持密码原文', async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: ' jacky ', password: ' pass word ', role: 'admin' }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: loginResponse,
      msg: '请求成功',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(login).toHaveBeenCalledExactlyOnceWith({ username: 'jacky', password: ' pass word ' });
    expect(login.mock.calls[0]![0]).toBeInstanceOf(LoginDto);
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it('无效输入返回 400，不执行密码校验', async () => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jacky', password: 123456 }),
    });
    expect(response.status).toBe(400);
    expect(login).not.toHaveBeenCalled();
  });

  it('错误凭证返回统一的 401', async () => {
    login.mockRejectedValueOnce(new UnauthorizedException('用户名或密码错误'));
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'jacky', password: 'wrong-pass' }),
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 401,
      success: false,
      data: null,
      msg: '用户名或密码错误',
    });
  });
});

function postToken(path: string, body?: unknown, authorization?: string) {
  return fetch(`${baseUrl}/auth/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authorization ? { Authorization: authorization } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('POST /auth/refresh', () => {
  it('不依赖 Access Token，接收 Refresh Token 并返回新的双 Token', async () => {
    const response = await postToken(
      'refresh',
      { refreshToken, ignored: 'extra' },
      'Bearer expired',
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: loginResponse,
      msg: '请求成功',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(refresh).toHaveBeenCalledExactlyOnceWith(refreshToken);
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it('过期或已使用的 Refresh Token 返回 401', async () => {
    refresh.mockRejectedValueOnce(new UnauthorizedException('登录已失效，请重新登录'));
    const response = await postToken('refresh', { refreshToken });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      code: 401,
      success: false,
      data: null,
      msg: '登录已失效，请重新登录',
    });
  });

  it('数据库错误返回 500，不伪装成登录过期', async () => {
    refresh.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await postToken('refresh', { refreshToken });
    expect(response.status).toBe(500);
  });
});

describe('POST /auth/logout', () => {
  it('从 Authorization Header 读取 Access Token 并按会话 ID 退出', async () => {
    const response = await postToken('logout', undefined, `Bearer ${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: null,
      msg: '请求成功',
    });
    expect(logout).toHaveBeenCalledExactlyOnceWith(claims.sid);
    expect(validateAccessToken).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(claims));
  });

  it('缺少或过期的 Access Token 返回 401，不调用退出服务', async () => {
    for (const authorization of [undefined, 'Bearer expired']) {
      const response = await postToken('logout', undefined, authorization);
      expect(response.status).toBe(401);
    }
    expect(logout).not.toHaveBeenCalled();
  });

  it('服务失败时返回 500', async () => {
    logout.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await postToken('logout', undefined, `Bearer ${token}`);
    expect(response.status).toBe(500);
  });
});

describe('POST /auth/refresh 参数校验', () => {
  it.each([
    {},
    { refreshToken: 123 },
    { refreshToken: token },
    { refreshToken: 'invalid' },
    { refreshToken: `${refreshToken}\n` },
    { refreshToken: ` ${refreshToken}` },
  ])('拒绝无效 Refresh Token：%j', async (body) => {
    const response = await postToken('refresh', body);
    expect(response.status).toBe(400);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('GET /user/info', () => {
  it('返回经过鉴权的用户信息', async () => {
    const response = await fetch(`${baseUrl}/user/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { id: 1, username: 'jacky' },
      msg: '请求成功',
    });
    expect(validateAccessToken).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(claims));
  });

  it.each([undefined, 'Basic abc', `Bearer ${token} extra`])(
    '拒绝缺失或畸形请求头：%s',
    async (authorization) => {
      const response = await fetch(`${baseUrl}/user/info`, {
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(validateAccessToken).not.toHaveBeenCalled();
    },
  );

  it.each([
    { name: '过期', overrides: { exp: Math.floor(Date.now() / 1000) - 1 } },
    { name: '尚未生效', overrides: { nbf: Math.floor(Date.now() / 1000) + 3600 } },
    { name: '错误 issuer', overrides: { iss: 'other-service' } },
    { name: '错误 audience', overrides: { aud: 'other-app' } },
  ])('Passport 拒绝 $name JWT，且不查询会话', async ({ overrides }) => {
    const invalidToken = await jwt.signAsync({ ...claims, ...overrides }, { algorithm: 'HS256' });
    const response = await fetch(`${baseUrl}/user/info`, {
      headers: { Authorization: `Bearer ${invalidToken}` },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ msg: '登录已失效，请重新登录' });
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it('Passport 拒绝篡改的签名与其他算法，且不查询会话', async () => {
    const [header, payload, signature] = token.split('.');
    const tampered = `${header}.${payload}.${signature![0] === 'a' ? 'b' : 'a'}${signature!.slice(1)}`;
    const wrongAlgorithm = await jwt.signAsync(claims, { algorithm: 'HS384' });
    for (const invalidToken of [tampered, wrongAlgorithm, 'a.b.c']) {
      const response = await fetch(`${baseUrl}/user/info`, {
        headers: { Authorization: `Bearer ${invalidToken}` },
      });
      expect(response.status).toBe(401);
    }
    expect(validateAccessToken).not.toHaveBeenCalled();
  });

  it('会话已失效时返回 401', async () => {
    validateAccessToken.mockRejectedValueOnce(new UnauthorizedException('登录已失效，请重新登录'));
    const response = await fetch(`${baseUrl}/user/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ msg: '登录已失效，请重新登录' });
  });

  it('会话查询失败时保留 500，不误报为认证失败', async () => {
    validateAccessToken.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await fetch(`${baseUrl}/user/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(500);
  });
});

describe('POST /auth/change-password', () => {
  const passwords = { oldPassword: ' old password ', newPassword: ' new password ' };

  it('使用鉴权用户 ID，保留密码首尾空格并剔除额外字段', async () => {
    const response = await postToken(
      'change-password',
      { ...passwords, userId: 999, username: 'other-user' },
      `Bearer ${token}`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: null,
      msg: '请求成功',
    });
    expect(changePassword).toHaveBeenCalledExactlyOnceWith(1, passwords);
    expect(validateAccessToken).toHaveBeenCalledExactlyOnceWith(expect.objectContaining(claims));
  });

  it.each([undefined, 'Bearer expired'])('未通过鉴权时返回 401：%s', async (authorization) => {
    const response = await postToken('change-password', passwords, authorization);

    expect(response.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  for (const field of ['oldPassword', 'newPassword']) {
    it.each([undefined, 123456, 'short', 'a'.repeat(17), '      ', '含有中文字符', 'abcdef\n'])(
      `拒绝无效 ${field}：%j`,
      async (value) => {
        const response = await postToken(
          'change-password',
          { ...passwords, [field]: value },
          `Bearer ${token}`,
        );

        expect(response.status).toBe(400);
        expect(changePassword).not.toHaveBeenCalled();
      },
    );
  }

  it.each([
    { error: new BadRequestException('旧密码不正确'), status: 400, message: '旧密码不正确' },
    {
      error: new UnauthorizedException('登录已失效，请重新登录'),
      status: 401,
      message: '登录已失效，请重新登录',
    },
    {
      error: new ConflictException('密码已变更，请重新操作'),
      status: 409,
      message: '密码已变更，请重新操作',
    },
  ])('保留服务异常状态 $status', async ({ error, status, message }) => {
    changePassword.mockRejectedValueOnce(error);
    const response = await postToken('change-password', passwords, `Bearer ${token}`);

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      code: status,
      success: false,
      data: null,
      msg: message,
    });
  });

  it('数据库错误返回 500', async () => {
    changePassword.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await postToken('change-password', passwords, `Bearer ${token}`);

    expect(response.status).toBe(500);
  });
});
