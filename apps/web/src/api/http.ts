import type { ApiResponse } from '@nestjs-agent/shared';
import { createAlova } from 'alova';
import { createServerTokenAuthentication } from 'alova/client';
import adapterFetch from 'alova/fetch';
import ReactHook from 'alova/react';
import { refreshAccessToken } from '@/api/auth/session';
import { syncAuthStorage } from '@/stores/auth';

const sessionPaths = new Set(['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout']);
const { onAuthRequired, onResponseRefreshToken } = createServerTokenAuthentication<
  typeof ReactHook,
  typeof adapterFetch
>({
  assignToken: (method) => {
    const auth = syncAuthStorage();
    if (auth.sessionVersion !== method.meta.sessionVersion)
      throw Object.assign(new Error('登录状态已变更'), { status: 401, code: 401 });
    if (auth.token) method.config.headers.Authorization = `Bearer ${auth.token}`;
    else delete method.config.headers.Authorization;
  },
  refreshTokenOnSuccess: {
    isExpired: (response, method) => {
      const auth = syncAuthStorage();
      if (response.status !== 401 || auth.sessionVersion !== method.meta.sessionVersion)
        return false;
      if (method.meta.retried) {
        if (method.config.headers.Authorization === `Bearer ${auth.token}`) auth.clearToken();
        return false;
      }
      method.meta.retried = true;
      return true;
    },
    handler: async (_response, method) => {
      const auth = syncAuthStorage();
      // 较迟返回的旧 401 直接复用已经轮换的 Token。
      if (auth.token && method.config.headers.Authorization !== `Bearer ${auth.token}`) return;
      const version = method.meta.sessionVersion;
      try {
        await refreshAccessToken(version);
      } catch (error) {
        // 切换账号后放行队列，新账号继续请求；旧请求由 assignToken 拒绝。
        if (syncAuthStorage().sessionVersion === version) throw error;
      }
    },
  },
});
const authorize = onAuthRequired();

export const http = createAlova({
  baseURL: '/api',
  statesHook: ReactHook,
  requestAdapter: adapterFetch(),
  timeout: 10_000,
  shareRequest: false,
  cacheFor: { GET: 0 },
  beforeRequest: (method) => {
    method.meta = {
      ...method.meta,
      sessionVersion: method.meta?.sessionVersion ?? syncAuthStorage().sessionVersion,
      authRole: sessionPaths.has(method.url) ? null : undefined,
    };
    if (sessionPaths.has(method.url) && method.url !== '/auth/logout')
      delete method.config.headers.Authorization;
    return authorize(method);
  },
  responded: onResponseRefreshToken({
    onSuccess: async (response): Promise<unknown> => {
      if (response.status === 204) return undefined;
      const body = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !body.success) {
        throw Object.assign(new Error(body.msg || `请求失败（${response.status}）`), {
          status: response.status,
          code: body.code ?? response.status,
        });
      }
      return body.data;
    },
    onError: (error) => {
      throw error;
    },
  }),
});
