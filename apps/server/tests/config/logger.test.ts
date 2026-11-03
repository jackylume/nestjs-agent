import 'reflect-metadata';
import { Controller, Get, Logger, Module, Param, ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, NestFactory } from '@nestjs/core';
import { NodeAdapter } from '@nestjs/platform-node';
import type { RegisterResponse } from '@nestjs-agent/shared';
import { Logger as PinoNestLogger, LoggerModule, PinoLogger } from 'nestjs-pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AuthController } from '../../src/auth/auth.controller.js';
import { AuthService } from '../../src/auth/auth.service.js';
import type { RegisterDto } from '../../src/auth/dto/register.dto.js';
import { Public } from '../../src/common/decorators/public.decorator.js';
import { ErrorFilter } from '../../src/common/filters/error.filter.js';
import { GlobalGuard } from '../../src/common/guards/global.guard.js';
import { SuccessInterceptor } from '../../src/common/interceptors/success.interceptor.js';
import { loggerOptions } from '../../src/config/logger.js';

interface LogEntry {
  level: number;
  msg: string;
  req?: { id: number | string; method: string; url: string };
  res?: { statusCode: number };
  responseTime?: number;
  context?: string;
  err?: { message: string; stack?: string };
}

const entries: LogEntry[] = [];
const output = {
  write(message: string) {
    for (const line of message.trim().split('\n')) {
      entries.push(JSON.parse(line) as LogEntry);
    }
  },
};
const register = vi.fn<(dto: RegisterDto) => Promise<RegisterResponse>>();
let completeResponse: (() => void) | undefined;
let notifyResponseStarted: (() => void) | undefined;
let responseReady: Promise<void>;
let responseStarted: Promise<void>;
let concurrentRequestCount = 0;
let notifyConcurrentStarted: (() => void) | undefined;
let completeConcurrentResponses: (() => void) | undefined;
let concurrentStarted: Promise<void>;
let concurrentResponsesReady: Promise<void>;

@Controller()
@Public()
class TestController {
  private readonly logger = new Logger(TestController.name);

  constructor(private readonly pino: PinoLogger) {}

  @Get()
  root() {
    return { status: 'ok' };
  }

  @Get('requests/:name')
  request() {
    return { status: 'ok' };
  }

  @Get('pending-response')
  async pendingResponse() {
    notifyResponseStarted?.();
    await responseReady;
    return { status: 'ok' };
  }

  @Get('business')
  business() {
    this.logger.log('nest business log');
    this.pino.info('pino business log');
    return { status: 'ok' };
  }

  @Get('concurrent/:name')
  async concurrent(@Param('name') name: string) {
    this.logger.log(`start ${name}`);
    concurrentRequestCount += 1;
    if (concurrentRequestCount === 2) notifyConcurrentStarted?.();
    await concurrentResponsesReady;
    this.pino.info(`end ${name}`);
    return { status: 'ok' };
  }

  @Get('failure')
  failure() {
    throw new Error('test failure');
  }
}

@Module({
  imports: [
    LoggerModule.forRoot({
      ...loggerOptions,
      pinoHttp: [loggerOptions.pinoHttp, output],
    }),
  ],
  controllers: [TestController, AuthController],
  providers: [
    { provide: APP_GUARD, useClass: GlobalGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessInterceptor },
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: AuthService, useValue: { register } },
  ],
})
class TestLoggerModule {}

let app: INestApplication;
let baseUrl: string;

beforeAll(async () => {
  app = await NestFactory.create(TestLoggerModule, new NodeAdapter(), { bufferLogs: true });
  app.useLogger(app.get(PinoNestLogger));
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, stopAtFirstError: true }),
  );
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => {
  completeResponse?.();
  completeConcurrentResponses?.();
  await app?.close();
});

beforeEach(() => {
  entries.length = 0;
  register.mockReset();
  register.mockResolvedValue({ id: 1, username: 'jacky' });
  responseReady = new Promise<void>((resolve) => {
    completeResponse = resolve;
  });
  responseStarted = new Promise<void>((resolve) => {
    notifyResponseStarted = resolve;
  });
  concurrentRequestCount = 0;
  concurrentStarted = new Promise<void>((resolve) => {
    notifyConcurrentStarted = resolve;
  });
  concurrentResponsesReady = new Promise<void>((resolve) => {
    completeConcurrentResponses = resolve;
  });
});

function expectCompletion(method: string, url: string, statusCode: number) {
  const completed = entries.filter((entry) => entry.res);
  expect(completed).toHaveLength(1);
  const entry = completed[0]!;
  expect(entry).toMatchObject({
    req: { method, url },
    res: { statusCode },
    responseTime: expect.any(Number),
  });
  expect(entry.req?.id).toBeDefined();
  expect(Object.keys(entry.req!).sort()).toEqual(['id', 'method', 'url']);
  expect(Object.keys(entry.res!)).toEqual(['statusCode']);
  expect(entry.responseTime).toBeGreaterThanOrEqual(0);
  return entry;
}

describe('NestJS Pino 日志', () => {
  it('根路径完成后输出一条 JSON 请求日志', async () => {
    const response = await fetch(`${baseUrl}/`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { status: 'ok' },
      msg: '请求成功',
    });
    expect(expectCompletion('GET', '/', 200).level).toBe(30);
    expect(entries).toHaveLength(1);
  });

  it('保留原始编码路径，移除查询参数且不记录请求头', async () => {
    const response = await fetch(`${baseUrl}/requests/Some%20Path?token=query-secret`, {
      headers: { Authorization: 'Bearer header-secret' },
    });

    expect(response.status).toBe(200);
    await response.json();
    expectCompletion('GET', '/requests/Some%20Path', 200);
    expect(entries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toMatch(/query-secret|header-secret/);
  });

  it('响应尚未完成时不记录，完成后记录最终状态和耗时', async () => {
    const request = fetch(`${baseUrl}/pending-response`);

    try {
      await responseStarted;
      expect(entries).toHaveLength(0);
    } finally {
      completeResponse?.();
    }

    const response = await request;
    expect(response.status).toBe(200);
    await response.json();
    expectCompletion('GET', '/pending-response', 200);
    expect(entries).toHaveLength(1);
  });

  it('记录注册请求的 200，不记录请求体、查询参数或 token', async () => {
    register.mockResolvedValueOnce({ id: 1, username: 'private-test-user' });
    const response = await fetch(`${baseUrl}/auth/register?token=query-secret`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer header-secret',
      },
      body: JSON.stringify({ username: 'private-test-user', password: 'body-secret' }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      code: 200,
      success: true,
      data: { id: 1, username: 'private-test-user' },
      msg: '请求成功',
    });
    expect(register).toHaveBeenCalledOnce();
    expect(expectCompletion('POST', '/auth/register', 200).level).toBe(30);
    expect(entries).toHaveLength(1);
    const messages = JSON.stringify(entries);
    for (const sensitiveText of [
      'query-secret',
      'header-secret',
      'body-secret',
      'private-test-user',
    ]) {
      expect(messages).not.toContain(sensitiveText);
    }
  });

  it('记录真实 ValidationPipe 拒绝请求后的最终 400', async () => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ab', password: 'password' }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      code: 400,
      success: false,
      data: null,
      msg: expect.any(String),
    });
    expect(register).not.toHaveBeenCalled();
    expect(expectCompletion('POST', '/auth/register', 400).level).toBe(40);
    expect(entries).toHaveLength(1);
  });

  it('未知路径输出一条 404 请求日志', async () => {
    const response = await fetch(`${baseUrl}/missing-page?token=query-secret`);

    expect(response.status).toBe(404);
    await response.json();
    expect(expectCompletion('GET', '/missing-page', 404).level).toBe(40);
    expect(entries).toHaveLength(1);
  });

  it('Nest Logger、PinoLogger 与请求完成日志共享 request id', async () => {
    const response = await fetch(`${baseUrl}/business`);
    await response.json();
    const completed = expectCompletion('GET', '/business', 200);

    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.msg === 'nest business log')).toMatchObject({
      req: completed.req,
      context: TestController.name,
    });
    expect(entries.find((entry) => entry.msg === 'pino business log')).toMatchObject({
      req: completed.req,
    });
  });

  it('重叠请求在 await 前后保持各自的 request id', async () => {
    const first = fetch(`${baseUrl}/concurrent/first`);
    const second = fetch(`${baseUrl}/concurrent/second`);

    try {
      await concurrentStarted;
      expect(entries.filter((entry) => entry.res)).toHaveLength(0);
      expect(entries.map((entry) => entry.msg).sort()).toEqual(['start first', 'start second']);
    } finally {
      completeConcurrentResponses?.();
    }

    const responses = await Promise.all([first, second]);
    await Promise.all(responses.map((response) => response.json()));
    const ids = [];
    for (const name of ['first', 'second']) {
      const records = entries.filter((entry) => entry.req?.url === `/concurrent/${name}`);
      expect(records).toHaveLength(3);
      expect(records.map((entry) => entry.msg)).toEqual(
        expect.arrayContaining([`start ${name}`, `end ${name}`]),
      );
      expect(records.filter((entry) => entry.res?.statusCode === 200)).toHaveLength(1);
      expect(new Set(records.map((entry) => entry.req?.id)).size).toBe(1);
      ids.push(records[0]!.req!.id);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('500 请求包含错误级别的完成日志和可关联的 Nest 异常日志', async () => {
    const response = await fetch(`${baseUrl}/failure`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: 500,
      success: false,
      data: null,
      msg: '服务器内部错误',
    });
    const completed = expectCompletion('GET', '/failure', 500);
    expect(completed.level).toBe(50);
    expect(completed.err?.message).toBeTruthy();
    const exception = entries.find((entry) => entry.context === 'ErrorFilter');
    expect(exception).toMatchObject({ level: 50, req: completed.req });
    expect(JSON.stringify(exception)).toContain('test failure');
  });
});
