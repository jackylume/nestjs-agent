import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHealth } from '@/features/health/api';
import { useAuthStore } from '@/stores/auth';
import { http } from './http';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  useAuthStore.getState().clearToken();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

describe('alova 请求客户端', () => {
  it('复用请求时读取最新 Token，清除后不再发送认证头，也不复用旧响应', async () => {
    fetchMock.mockImplementation(async () => Response.json({ status: 'ok' }));
    const request = http.Get('/auth-probe');
    for (const token of [null, 'first-token', 'second-token', null]) {
      if (token) useAuthStore.getState().setToken(token);
      else useAuthStore.getState().clearToken();
      await request.send();
      const headers = new Headers(fetchMock.mock.lastCall?.[1]?.headers);
      expect(headers.get('Authorization')).toBe(token ? `Bearer ${token}` : null);
    }
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('使用 /api 前缀解析响应，健康检查不复用缓存', async () => {
    fetchMock.mockImplementation(async () => Response.json({ status: 'ok' }));
    await expect(getHealth().send()).resolves.toEqual({ status: 'ok' });
    await expect(getHealth().send()).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
  });

  it('将 HTTP 错误转换为包含状态码的 ApiError', async () => {
    fetchMock.mockResolvedValue(Response.json({ message: '数据库暂不可用' }, { status: 503 }));
    await expect(getHealth().send()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: '数据库暂不可用',
    });
  });

  it('支持 NestJS 返回的多条验证错误', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ message: ['名称不能为空', '邮箱格式错误'] }, { status: 400 }),
    );
    await expect(getHealth().send()).rejects.toMatchObject({
      status: 400,
      message: '名称不能为空；邮箱格式错误',
    });
  });

  it('非 JSON 错误响应仍保留 HTTP 状态码', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }));
    await expect(getHealth().send()).rejects.toMatchObject({
      status: 502,
      message: '请求失败（502）',
    });
  });

  it('204 响应不尝试解析 JSON', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(http.Delete('/resource').send()).resolves.toBeUndefined();
  });

  it('网络异常不会被当作成功响应', async () => {
    fetchMock.mockRejectedValue(new TypeError('网络不可用'));
    await expect(getHealth().send()).rejects.toThrow('网络不可用');
  });
});
