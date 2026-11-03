import 'reflect-metadata';
import {
  ConflictException,
  Controller,
  Get,
  HttpException,
  Module,
  NotImplementedException,
  Param,
  Post,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import type { RegisterResponse } from '@nestjs-agent/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AuthController } from '../../src/auth/auth.controller.js';
import { AuthService } from '../../src/auth/auth.service.js';
import type { RegisterDto } from '../../src/auth/dto/register.dto.js';
import { DatabaseService } from '../../src/database/database.service.js';
import { HealthController } from '../../src/health/health.controller.js';
import { RedisService } from '../../src/redis/redis.service.js';
import { Public } from '../../src/common/decorators/public.decorator.js';
import { ErrorFilter } from '../../src/common/filters/error.filter.js';
import { GlobalGuard } from '../../src/common/guards/global.guard.js';
import { SuccessInterceptor } from '../../src/common/interceptors/success.interceptor.js';

const register = vi.fn<(dto: RegisterDto) => Promise<RegisterResponse>>();
const checkConnection = vi.fn<() => Promise<void>>();
const checkRedisConnection = vi.fn<() => Promise<void>>();

@Controller('response-test')
@Public()
class TestResponseController {
  @Get('object')
  object() {
    return { value: 'ok' };
  }

  @Post('created')
  created() {
    return { created: true };
  }

  @Get('null')
  nullValue() {
    return null;
  }

  @Get('undefined')
  undefinedValue() {
    return undefined;
  }

  @Get('falsy/:kind')
  falsy(@Param('kind') kind: 'false' | 'zero' | 'empty') {
    return { false: false, zero: 0, empty: '' }[kind];
  }

  @Get('string-exception')
  stringException() {
    throw new HttpException('自定义请求错误', 400);
  }

  @Get('http-error')
  httpError() {
    throw Object.assign(new Error('请求无法处理'), { statusCode: 422 });
  }

  @Get('unknown-error')
  unknownError() {
    throw new Error('private database connection detail');
  }

  @Post('not-implemented')
  notImplemented() {
    throw new NotImplementedException('功能尚未实现');
  }
}

@Module({
  controllers: [TestResponseController, AuthController, HealthController],
  providers: [
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
    {
      provide: AuthService,
      useValue: { register },
    },
    { provide: DatabaseService, useValue: { checkConnection } },
    { provide: RedisService, useValue: { checkConnection: checkRedisConnection } },
  ],
})
class TestResponseModule {}

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create(TestResponseModule, new NodeAdapter(), { logger: false });
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
  );
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
});

beforeEach(() => {
  register.mockReset();
  register.mockResolvedValue({ id: 1, username: 'jacky' });
  checkConnection.mockReset();
  checkConnection.mockResolvedValue(undefined);
  checkRedisConnection.mockReset();
  checkRedisConnection.mockResolvedValue(undefined);
});

function postRegistration(body: unknown) {
  return fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('统一 HTTP 响应', () => {
  it.each([
    { method: 'GET', path: 'object', data: { value: 'ok' } },
    { method: 'POST', path: 'created', data: { created: true } },
    { method: 'GET', path: 'null', data: null },
    { method: 'GET', path: 'undefined', data: null },
    { method: 'GET', path: 'falsy/false', data: false },
    { method: 'GET', path: 'falsy/zero', data: 0 },
    { method: 'GET', path: 'falsy/empty', data: '' },
  ])(
    '$method $path 成功统一返回 200，保留原数据或将空值转为 null',
    async ({ method, path, data }) => {
      const response = await fetch(`${baseUrl}/response-test/${path}`, { method });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ code: 200, success: true, data, msg: '请求成功' });
    },
  );

  it('健康检查保留业务数据并使用统一成功结构', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { status: 'ok' },
      msg: '请求成功',
    });
    expect(checkConnection).not.toHaveBeenCalled();
    expect(checkRedisConnection).not.toHaveBeenCalled();
  });

  it('数据库健康检查成功时包装原始结果', async () => {
    const response = await fetch(`${baseUrl}/health/db`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { status: 'ok', database: 'connected' },
      msg: '请求成功',
    });
    expect(checkConnection).toHaveBeenCalledOnce();
  });

  it('Redis 健康检查成功时包装原始结果', async () => {
    const response = await fetch(`${baseUrl}/health/redis`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { status: 'ok', redis: 'connected' },
      msg: '请求成功',
    });
    expect(checkRedisConnection).toHaveBeenCalledOnce();
  });

  it('DTO 多个字段校验失败时只返回第一条错误并保留 HTTP 400', async () => {
    const response = await postRegistration({ username: 'ab', password: 'abc' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      success: false,
      data: null,
      msg: '用户名须为 3–32 个字符',
    });
    expect(register).not.toHaveBeenCalled();
  });

  it('用户名冲突保留 HTTP 409 和原始业务提示', async () => {
    register.mockRejectedValueOnce(new ConflictException('用户名已存在'));
    const response = await postRegistration({ username: 'jacky', password: 'password' });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      code: 409,
      success: false,
      data: null,
      msg: '用户名已存在',
    });
  });

  it('未知路由也返回统一的 HTTP 404 错误结构', async () => {
    const response = await fetch(`${baseUrl}/unknown-route`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      code: 404,
      success: false,
      data: null,
      msg: 'Cannot GET /unknown-route',
    });
  });

  it('未实现的接口保留 HTTP 501 和原始提示', async () => {
    const response = await fetch(`${baseUrl}/response-test/not-implemented`, {
      method: 'POST',
    });

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      code: 501,
      success: false,
      data: null,
      msg: '功能尚未实现',
    });
  });

  it('数据库健康检查失败保留 HTTP 503 且不泄漏数据库错误', async () => {
    checkConnection.mockRejectedValueOnce(new Error('private database connection detail'));
    const response = await fetch(`${baseUrl}/health/db`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 503,
      success: false,
      data: null,
      msg: '数据库暂不可用',
    });
  });

  it('Redis 健康检查失败保留 HTTP 503', async () => {
    checkRedisConnection.mockRejectedValueOnce(new ServiceUnavailableException('Redis 暂不可用'));
    const response = await fetch(`${baseUrl}/health/redis`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      code: 503,
      success: false,
      data: null,
      msg: 'Redis 暂不可用',
    });
  });

  it('未知异常返回 HTTP 500，隐藏内部错误和堆栈', async () => {
    const response = await fetch(`${baseUrl}/response-test/unknown-error`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 500,
      success: false,
      data: null,
      msg: '服务器内部错误',
    });
  });

  it('支持响应体为字符串的 HttpException', async () => {
    const response = await fetch(`${baseUrl}/response-test/string-exception`);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      success: false,
      data: null,
      msg: '自定义请求错误',
    });
  });

  it('保留非 HttpException 的合法 statusCode 和 message', async () => {
    const response = await fetch(`${baseUrl}/response-test/http-error`);

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      code: 422,
      success: false,
      data: null,
      msg: '请求无法处理',
    });
  });

  it('JSON 解析失败返回统一 HTTP 400，不会进入注册 Service', async () => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      success: false,
      data: null,
      msg: expect.any(String),
    });
    expect(register).not.toHaveBeenCalled();
  });
});
