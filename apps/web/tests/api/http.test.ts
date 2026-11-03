import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { getHealth } from '@/api/health';
import { logout } from '@/api/auth';
import { refreshAccessToken } from '@/api/auth/session';
import { http } from '@/api/http';
import { useAuthStore } from '@/stores/auth';

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

function ok(data: unknown) {
  return Response.json({ code: 200, success: true, data, msg: '请求成功' });
}
function unauthorized() {
  return Response.json(
    { code: 401, success: false, data: null, msg: '登录已失效' },
    { status: 401 },
  );
}
function refreshed(accessToken: string) {
  return ok({
    accessToken,
    refreshToken: `refresh-${accessToken}`,
    refreshTokenExpiresAt: new Date(7 * 24 * 60 * 60 * 1000).toISOString(),
    accessTokenExpiresAt: '2026-10-26T02:00:00.000Z',
  });
}

async function withinTimeout<T>(promise: Promise<T>): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('请求未结束')), 200);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe('alova 请求客户端', () => {
  it('只有失效 Access Token 而缺少 Refresh Token 时清理旧登录状态', async () => {
    useAuthStore.getState().setToken('legacy-expired-access');
    fetchMock.mockResolvedValueOnce(unauthorized());
    await expect(http.Get('/private').send()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(useAuthStore.getState().token).toBeNull();
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
      token: null,
      refreshToken: null,
    });
  });

  it('Access Token 过期时提交 Refresh Token，保存轮换后的双 Token 并重试', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock.mockResolvedValueOnce(unauthorized());
    fetchMock.mockResolvedValueOnce(refreshed('new-access'));
    fetchMock.mockResolvedValueOnce(ok({ id: 1 }));

    await expect(http.Post('/private', { value: 'unchanged' }).send()).resolves.toEqual({ id: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/refresh');
    expect(fetchMock.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBeNull();
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(fetchMock.mock.calls[2]![1]?.body).toBe(fetchMock.mock.calls[0]![1]?.body);
    expect(useAuthStore.getState().token).toBe('new-access');
    expect(JSON.parse(fetchMock.mock.calls[1]![1]?.body as string)).toEqual({
      refreshToken: 'old-refresh',
    });
    expect(useAuthStore.getState().refreshToken).toBe('refresh-new-access');
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
      token: 'new-access',
      refreshToken: 'refresh-new-access',
    });
  });

  it('并发的 401 只刷新一次，较迟返回的旧 401 复用已续期 Token', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    let completeRefresh!: (response: Response) => void;
    let completeLate!: (response: Response) => void;
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/auth/refresh')
        return new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        });
      if (
        input === '/api/late' &&
        new Headers(init?.headers).get('Authorization') === 'Bearer expired-token'
      ) {
        return new Promise<Response>((resolve) => {
          completeLate = resolve;
        });
      }
      return new Headers(init?.headers).get('Authorization') === 'Bearer new-access'
        ? ok({ ready: true })
        : unauthorized();
    });
    const requests = [http.Get('/one').send(), http.Get('/two').send(), http.Get('/late').send()];
    await vi.waitFor(() => expect(completeRefresh).toBeDefined());
    completeRefresh(refreshed('new-access'));
    await Promise.all(requests.slice(0, 2));
    completeLate(unauthorized());
    await expect(requests[2]).resolves.toEqual({ ready: true });
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it('刷新期间新业务请求等待，刷新成功后只携带新 Token 发送', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    let completeRefresh!: (response: Response) => void;
    fetchMock.mockImplementation(async (input, init) => {
      if (input === '/api/auth/refresh') {
        return new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        });
      }
      return new Headers(init?.headers).get('Authorization') === 'Bearer new-access'
        ? ok({ ready: true })
        : unauthorized();
    });
    const first = http.Get('/first').send();
    void first.catch(() => undefined);
    await vi.waitFor(() => expect(completeRefresh).toBeDefined());

    const next = http.Get('/during-refresh').send();
    const requests = Promise.all([first, next]);
    void requests.catch(() => undefined);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/during-refresh')).toBe(false);
    completeRefresh(refreshed('new-access'));

    await expect(withinTimeout(requests)).resolves.toEqual([{ ready: true }, { ready: true }]);
    const nextCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/during-refresh');
    expect(nextCalls).toHaveLength(1);
    expect(new Headers(nextCalls[0]![1]?.headers).get('Authorization')).toBe('Bearer new-access');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(1);
  });

  it.each([500, 503, 'network'] as const)(
    '刷新失败 %s 时并发 401 和新请求全部结束，后续请求仍可刷新重试',
    async (failure) => {
      useAuthStore
        .getState()
        .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
      const responses = new Map<RequestInfo | URL, (response: Response) => void>();
      let completeRefresh!: (response: Response) => void;
      let rejectRefresh!: (error: Error) => void;
      fetchMock.mockImplementation(async (input) => {
        if (input === '/api/auth/refresh') {
          return new Promise<Response>((resolve, reject) => {
            completeRefresh = resolve;
            rejectRefresh = reject;
          });
        }
        return new Promise<Response>((resolve) => {
          responses.set(input, resolve);
        });
      });
      const first = http.Get('/first').send();
      const second = http.Get('/second').send();
      void first.catch(() => undefined);
      void second.catch(() => undefined);
      await vi.waitFor(() => expect(responses.size).toBe(2));
      responses.get('/api/first')!(unauthorized());
      await vi.waitFor(() => expect(completeRefresh).toBeDefined());
      responses.get('/api/second')!(unauthorized());
      const next = http.Get('/during-refresh').send();
      const requests = Promise.allSettled([first, second, next]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/during-refresh')).toBe(false);

      if (failure === 'network') rejectRefresh(new TypeError('offline'));
      else {
        completeRefresh(
          Response.json(
            { code: failure, success: false, data: null, msg: '稍后重试' },
            { status: failure },
          ),
        );
      }
      const results = await withinTimeout(requests);
      for (const result of results) {
        expect(result.status).toBe('rejected');
        if (result.status === 'rejected') {
          expect(result.reason).toMatchObject(
            failure === 'network' ? { message: 'offline' } : { status: failure },
          );
        }
      }
      expect(useAuthStore.getState().token).toBe('expired-token');
      expect(useAuthStore.getState().refreshToken).toBe('old-refresh');

      fetchMock.mockImplementation(async (input, init) => {
        if (input === '/api/auth/refresh') return refreshed('new-access');
        return new Headers(init?.headers).get('Authorization') === 'Bearer new-access'
          ? ok({ ready: true })
          : unauthorized();
      });
      await expect(withinTimeout(http.Get('/retry-after-failure').send())).resolves.toEqual({
        ready: true,
      });
      expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/refresh')).toHaveLength(2);
    },
  );

  it.each([null, false, 0, '', undefined])('刷新后重试保留成功返回值 %j', async (data) => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed('new-access'))
      .mockResolvedValueOnce(data === undefined ? new Response(null, { status: 204 }) : ok(data));

    await expect(http.Get('/data-after-refresh').send()).resolves.toBe(data);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
  });

  it('重试仍返回 401 时结束，不再刷新', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(refreshed('new-access'))
      .mockResolvedValueOnce(unauthorized());
    await expect(http.Get('/private').send()).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().token).toBeNull();
  });

  it.each(['/auth/login', '/auth/register', '/auth/refresh'])(
    '%s 的 401 不触发自动刷新',
    async (path) => {
      useAuthStore.getState().setToken('valid-access');
      fetchMock.mockResolvedValueOnce(unauthorized());
      await expect(http.Post(path).send()).rejects.toMatchObject({ status: 401 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().token).toBe('valid-access');
    },
  );

  it('退出保留已捕获的会话凭证，401 不刷新或清除新账号', async () => {
    useAuthStore.getState().setSession({ accessToken: 'new-account', refreshToken: 'new-refresh' });
    fetchMock.mockResolvedValueOnce(unauthorized());

    await expect(logout('old-account').send()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBe(
      'Bearer old-account',
    );
    expect(useAuthStore.getState().token).toBe('new-account');
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
  });

  it.each([500, 503])('刷新服务返回 %s 时保留现有状态供重试', async (status) => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock
      .mockResolvedValueOnce(unauthorized())
      .mockResolvedValueOnce(
        Response.json({ code: status, success: false, data: null, msg: '稍后重试' }, { status }),
      );
    await expect(http.Get('/private').send()).rejects.toMatchObject({ status });
    expect(useAuthStore.getState().token).toBe('expired-token');
  });

  it('刷新网络失败保留现有状态', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock.mockResolvedValueOnce(unauthorized()).mockRejectedValueOnce(new TypeError('offline'));
    await expect(http.Get('/private').send()).rejects.toThrow('offline');
    expect(useAuthStore.getState().token).toBe('expired-token');
  });

  it.each([true, false])('旧刷新响应不会覆盖新登录或退出状态：%s', async (newLogin) => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    let completeRefresh!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        }),
    );
    const result = expect(refreshAccessToken()).rejects.toMatchObject({ status: 401 });
    await vi.waitFor(() => expect(completeRefresh).toBeDefined());
    if (newLogin) useAuthStore.getState().setToken('another-account');
    else useAuthStore.getState().clearToken();
    completeRefresh(refreshed('stale-access'));
    await result;
    expect(useAuthStore.getState().token).toBe(newLogin ? 'another-account' : null);
  });

  it.each(['success', 401, 503, 'network'] as const)(
    '旧会话刷新返回 %s 时，新账号的等待请求仍成功且凭据不受影响',
    async (result) => {
      useAuthStore.getState().setSession({
        accessToken: 'account-A',
        refreshToken: 'session-A.old',
      });
      let completeRefresh!: (response: Response) => void;
      let rejectRefresh!: (error: Error) => void;
      fetchMock.mockImplementation(async (input, init) => {
        if (input === '/api/auth/refresh') {
          return new Promise<Response>((resolve, reject) => {
            completeRefresh = resolve;
            rejectRefresh = reject;
          });
        }
        return new Headers(init?.headers).get('Authorization') === 'Bearer account-B'
          ? ok({ account: 'B' })
          : unauthorized();
      });
      const oldRequest = http.Get('/old-account').send();
      void oldRequest.catch(() => undefined);
      await vi.waitFor(() => expect(completeRefresh).toBeDefined());

      // 模拟另一标签页切换账号，storage 事件尚未送达。
      localStorage.setItem(
        'NESTJS_AGENT_AUTH',
        JSON.stringify({
          state: { token: 'account-B', refreshToken: 'session-B.refresh' },
          version: 0,
        }),
      );
      const newRequest = http.Get('/new-account').send();
      const requests = Promise.allSettled([oldRequest, newRequest]);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(fetchMock.mock.calls.some(([url]) => url === '/api/new-account')).toBe(false);

      if (result === 'network') rejectRefresh(new TypeError('offline'));
      else if (result === 'success') completeRefresh(refreshed('stale-account-A'));
      else {
        completeRefresh(
          Response.json(
            { code: result, success: false, data: null, msg: '旧会话刷新失败' },
            { status: result },
          ),
        );
      }

      await expect(withinTimeout(requests)).resolves.toMatchObject([
        { status: 'rejected', reason: { status: 401 } },
        { status: 'fulfilled', value: { account: 'B' } },
      ]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/api/old-account',
        '/api/auth/refresh',
        '/api/new-account',
      ]);
      expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe(
        'Bearer account-B',
      );
      expect(useAuthStore.getState().token).toBe('account-B');
      expect(useAuthStore.getState().refreshToken).toBe('session-B.refresh');
      expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
        token: 'account-B',
        refreshToken: 'session-B.refresh',
      });
    },
  );

  it.each(['/auth/login', '/auth/register', '/auth/refresh'])(
    '公开接口 %s 不携带现有会话凭证',
    async (path) => {
      useAuthStore.getState().setToken('existing-token');
      fetchMock.mockResolvedValueOnce(
        Response.json({ code: 200, success: true, data: null, msg: '请求成功' }),
      );

      await http.Post(path, { username: 'jacky', password: '123456' }).send();

      expect(new Headers(fetchMock.mock.lastCall?.[1]?.headers).get('Authorization')).toBeNull();
      expect(useAuthStore.getState().getToken()).toBe('existing-token');
    },
  );

  it('访问凭证与刷新凭证均返回 401 时清除登录状态', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'old-refresh' });
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 401, success: false, data: null, msg: '登录已失效' }, { status: 401 }),
    );

    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 401, success: false, data: null, msg: '刷新凭证失效' },
        { status: 401 },
      ),
    );
    await expect(http.Get('/private').send()).rejects.toMatchObject({ status: 401 });

    expect(useAuthStore.getState().getToken()).toBeNull();
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state.token).toBeNull();
  });

  it.each([null, 'old-token'])('旧请求使用 %j 返回 401 时不会清除新登录状态', async (token) => {
    if (token) useAuthStore.getState().setToken(token);
    let resolveResponse!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const result = expect(http.Get('/delayed-private').send()).rejects.toMatchObject({
      status: 401,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    useAuthStore.getState().setToken('new-token');
    resolveResponse(
      Response.json({ code: 401, success: false, data: null, msg: '登录已失效' }, { status: 401 }),
    );
    await result;

    expect(useAuthStore.getState().getToken()).toBe('new-token');
  });

  it('同一路径的并发请求不会跨登录会话共享响应', async () => {
    useAuthStore.getState().setToken('old-token');
    let resolveOldResponse!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveOldResponse = resolve;
        }),
    );
    const oldResult = expect(http.Get('/session-probe').send()).rejects.toMatchObject({
      status: 401,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    useAuthStore.getState().setToken('new-token');
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 200, success: true, data: { id: 2 }, msg: '请求成功' }),
    );
    const newResult = http.Get('/session-probe').send();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await expect(newResult).resolves.toEqual({ id: 2 });
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-token',
    );

    resolveOldResponse(
      Response.json({ code: 401, success: false, data: null, msg: '登录已失效' }, { status: 401 }),
    );
    await oldResult;
    expect(useAuthStore.getState().getToken()).toBe('new-token');
  });

  it('复用请求时读取最新 Token，清除后不再发送认证头，也不复用旧响应', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ code: 200, success: true, data: { status: 'ok' }, msg: '请求成功' }),
    );
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

  it('使用同源 /api 地址并解包 data，健康检查不复用缓存', async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ code: 200, success: true, data: { status: 'ok' }, msg: '请求成功' }),
    );
    await expect(getHealth().send()).resolves.toEqual({ status: 'ok' });
    await expect(getHealth().send()).resolves.toEqual({ status: 'ok' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.any(Object));
  });

  it.each([null, false, 0, ''])('成功响应保留 data 的值 %j', async (data) => {
    fetchMock.mockResolvedValue(Response.json({ code: 200, success: true, data, msg: '请求成功' }));
    await expect(http.Get('/data-probe').send()).resolves.toBe(data);
  });

  it('其他正常的 2xx 响应也可以解包', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 201, success: true, data: { id: 1 }, msg: '请求成功' },
        { status: 201 },
      ),
    );
    await expect(http.Post('/resource', {}).send()).resolves.toEqual({ id: 1 });
  });

  it('将统一错误响应的 msg、HTTP 状态与 code 放入原生 Error', async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { code: 503, success: false, data: null, msg: '数据库暂不可用' },
        { status: 503 },
      ),
    );
    const request = getHealth().send();
    await expect(request).rejects.toBeInstanceOf(Error);
    await expect(request).rejects.toMatchObject({
      name: 'Error',
      status: 503,
      code: 503,
      message: '数据库暂不可用',
    });
  });

  it('HTTP 200 但 success 为 false 时仍拒绝，并保留业务 code', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 409, success: false, data: null, msg: '用户名已存在' }),
    );
    await expect(getHealth().send()).rejects.toMatchObject({
      name: 'Error',
      status: 200,
      code: 409,
      message: '用户名已存在',
    });
  });

  it('HTTP 错误不会被响应体的 success 标记掩盖', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ code: 500, success: true, data: null, msg: '服务器异常' }, { status: 500 }),
    );
    await expect(getHealth().send()).rejects.toMatchObject({
      name: 'Error',
      status: 500,
      code: 500,
      message: '服务器异常',
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
