import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { MockInstance } from 'vite-plus/test';

const storageKey = 'NESTJS_AGENT_AUTH';
const sessionId = '11111111-1111-4111-8111-111111111111';
const otherSessionId = '22222222-2222-4222-8222-222222222222';
const oldRefresh = `${sessionId}.${'a'.repeat(64)}`;
const newRefresh = `${sessionId}.${'b'.repeat(64)}`;
const fetchMock = vi.fn<typeof fetch>();
let addListener: MockInstance<typeof window.addEventListener>;

function ok(data: unknown) {
  return Response.json({ code: 200, success: true, data, msg: '请求成功' });
}

function unauthorized() {
  return Response.json(
    { code: 401, success: false, data: null, msg: '登录已失效' },
    { status: 401 },
  );
}

function tokens(accessToken = 'new-access', refreshToken = newRefresh) {
  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(7_200_000).toISOString(),
    refreshTokenExpiresAt: new Date(7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

function announceStorage() {
  window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));
}

async function openTab() {
  vi.resetModules();
  const store = (await import('@/stores/auth')).useAuthStore;
  const api = await import('@/api/http');
  const session = await import('@/api/auth/session');
  return { store, ...api, ...session };
}

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  addListener = vi.spyOn(window, 'addEventListener');
  // 模拟浏览器按同名 Web Lock 串行执行不同标签页的回调。
  let tail: Promise<unknown> = Promise.resolve();
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: {
      request: vi.fn((_name: string, operation: () => Promise<unknown>) => {
        const request = tail.then(operation);
        tail = request.catch(() => undefined);
        return request;
      }),
    },
  });
});

afterEach(() => {
  for (const [event, listener] of addListener.mock.calls) {
    if (event === 'storage') window.removeEventListener(event, listener);
  }
  Reflect.deleteProperty(navigator, 'locks');
  localStorage.clear();
});

describe('多个标签页共享双 Token', () => {
  it('没有 Web Locks 时退出与刷新仍串行，退出成功后不再刷新旧会话', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const tab = await openTab();
    tab.store.getState().setSession(tokens('old-access', oldRefresh));
    let completeLogout!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeLogout = resolve;
        }),
    );

    const logout = tab.logoutSession();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const refresh = expect(tab.refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    completeLogout(ok(null));
    await logout;
    await refresh;

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/auth/logout']);
    expect(tab.store.getState().token).toBeNull();
    expect(tab.store.getState().refreshToken).toBeNull();
    expect(JSON.parse(localStorage.getItem(storageKey)!).state).toEqual({
      token: null,
      refreshToken: null,
    });
  });

  it('没有 Web Locks 时退出网络失败不会阻塞排队的登录保存', async () => {
    Reflect.deleteProperty(navigator, 'locks');
    const tab = await openTab();
    tab.store.getState().setSession(tokens('old-access', oldRefresh));
    let rejectLogout!: (error: Error) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          rejectLogout = reject;
        }),
    );

    const logout = expect(tab.logoutSession()).rejects.toThrow('offline');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const nextSession = tokens('another-account', `${otherSessionId}.${'c'.repeat(64)}`);
    const save = tab.saveSession(nextSession);
    expect(tab.store.getState().token).toBe('old-access');
    rejectLogout(new TypeError('offline'));
    await logout;
    await save;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tab.store.getState().token).toBe('another-account');
    expect(tab.store.getState().refreshToken).toBe(nextSession.refreshToken);
    expect(JSON.parse(localStorage.getItem(storageKey)!).state).toEqual({
      token: 'another-account',
      refreshToken: nextSession.refreshToken,
    });
  });

  it('storage 事件同步同会话轮换，切换账号或退出时更新版本', async () => {
    const first = await openTab();
    first.store.getState().setSession(tokens('old-access', oldRefresh));
    const second = await openTab();
    const originalVersion = second.store.getState().sessionVersion;

    first.store.getState().renewSession(tokens());
    announceStorage();
    expect(second.store.getState().token).toBe('new-access');
    expect(second.store.getState().refreshToken).toBe(newRefresh);
    expect(second.store.getState().sessionVersion).toBe(originalVersion);

    first.store
      .getState()
      .setSession(tokens('other-access', `${otherSessionId}.${'c'.repeat(64)}`));
    announceStorage();
    expect(second.store.getState().sessionVersion).toBeGreaterThan(originalVersion);
    first.store.getState().clearToken();
    announceStorage();
    expect(second.store.getState().token).toBeNull();
    expect(second.store.getState().refreshToken).toBeNull();
  });

  it('两个标签页同时刷新同一会话，只发送一次刷新请求并复用轮换结果', async () => {
    const first = await openTab();
    first.store.getState().setSession(tokens('old-access', oldRefresh));
    const second = await openTab();
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );

    const firstResult = first.refreshAccessToken();
    const secondResult = second.refreshAccessToken();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    complete(ok(tokens()));
    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      'new-access',
      'new-access',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(second.store.getState().refreshToken).toBe(newRefresh);
  });

  it('A 轮换后 B 的旧请求 401 使用最新 Access Token，不删除新存储', async () => {
    const first = await openTab();
    first.store.getState().setSession(tokens('old-access', oldRefresh));
    const second = await openTab();
    let completeOldRequest!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeOldRequest = resolve;
        }),
    );
    const request = second.http.Get('/private').send();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    first.store.getState().renewSession(tokens());
    // 即使 storage 事件还未送达，处理响应前也必须读取最新持久化状态。
    fetchMock.mockResolvedValueOnce(ok({ id: 1 }));
    completeOldRequest(unauthorized());
    await expect(request).resolves.toEqual({ id: 1 });
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(JSON.parse(localStorage.getItem(storageKey)!).state.refreshToken).toBe(newRefresh);
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/refresh')).toBe(false);
  });

  it('旧刷新请求 401 不会清除另一标签已写入的新 Refresh Token', async () => {
    const first = await openTab();
    first.store.getState().setSession(tokens('old-access', oldRefresh));
    const second = await openTab();
    let completeOldRefresh!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeOldRefresh = resolve;
        }),
    );
    const request = second.refreshAccessToken();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.store.getState().renewSession(tokens());
    completeOldRefresh(unauthorized());

    await expect(request).resolves.toBe('new-access');
    expect(JSON.parse(localStorage.getItem(storageKey)!).state.refreshToken).toBe(newRefresh);
  });

  it('旧请求返回时另一标签已经登录其他账号，不能覆盖或清除新账号', async () => {
    const first = await openTab();
    first.store.getState().setSession(tokens('old-access', oldRefresh));
    const second = await openTab();
    let complete!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          complete = resolve;
        }),
    );
    const result = expect(second.refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    first.store
      .getState()
      .setSession(tokens('another-account', `${otherSessionId}.${'c'.repeat(64)}`));
    complete(ok(tokens()));
    await result;
    expect(JSON.parse(localStorage.getItem(storageKey)!).state.token).toBe('another-account');
  });
});
