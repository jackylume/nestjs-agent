import { createAlova } from 'alova';
import adapterFetch from 'alova/fetch';
import ReactHook from 'alova/react';
import { useAuthStore } from '@/stores/auth';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const http = createAlova({
  baseURL: '/api',
  statesHook: ReactHook,
  requestAdapter: adapterFetch(),
  timeout: 10_000,
  cacheFor: { GET: 0 },
  beforeRequest: (method) => {
    const token = useAuthStore.getState().getToken();
    if (token) method.config.headers.Authorization = `Bearer ${token}`;
    else delete method.config.headers.Authorization;
  },
  responded: async (response) => {
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      let message = `请求失败（${response.status}）`;
      if (body && typeof body === 'object' && 'message' in body) {
        if (typeof body.message === 'string') message = body.message;
        else if (
          Array.isArray(body.message) &&
          body.message.every((item) => typeof item === 'string')
        ) {
          message = body.message.join('；');
        }
      }
      throw new ApiError(message, response.status);
    }
    if (response.status === 204) return undefined;
    return response.json();
  },
});
