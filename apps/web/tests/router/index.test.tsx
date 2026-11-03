import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { refreshAccessToken } from '@/api/auth/session';
import { AppProviders } from '@/config/providers';
import { routes } from '@/router';
import { useAuthStore } from '@/stores/auth';

const fetchMock = vi.fn<typeof fetch>();

function isDatabaseHealthRequest(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return url.endsWith('/health/db');
}

beforeEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) =>
    input === '/api/auth/refresh'
      ? Response.json({ code: 401, success: false, data: null, msg: '请登录' }, { status: 401 })
      : Response.json({
          code: 200,
          success: true,
          data:
            input === '/api/user/info'
              ? { id: 1, username: 'jacky' }
              : isDatabaseHealthRequest(input)
                ? { status: 'ok', database: 'connected' }
                : { status: 'ok' },
          msg: '请求成功',
        }),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

async function logoutMenuItem(user: ReturnType<typeof userEvent.setup>) {
  await user.hover(screen.getByRole('button', { name: 'jacky 的用户菜单' }));
  const item = await screen.findByRole('menuitem', { name: '退出登录' });
  await waitFor(() => expect(getComputedStyle(item).pointerEvents).not.toBe('none'));
  return item;
}

describe('应用路由和服务状态', () => {
  it('本地只有 Refresh Token 时刷新并恢复登录', async () => {
    useAuthStore.setState({ token: null, refreshToken: 'saved-refresh' });
    fetchMock.mockImplementation(async (input) =>
      Response.json({
        code: 200,
        success: true,
        data:
          input === '/api/auth/refresh'
            ? {
                accessToken: 'restored-access',
                refreshToken: 'restored-refresh',
                refreshTokenExpiresAt: new Date(7 * 24 * 60 * 60 * 1000).toISOString(),
                accessTokenExpiresAt: '2026-10-26T02:00:00.000Z',
              }
            : { id: 1, username: 'jacky' },
        msg: '请求成功',
      }),
    );
    const router = renderRoute('/home');
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/home');
    expect(useAuthStore.getState().token).toBe('restored-access');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/auth/refresh');
  });

  it('刷新服务暂时不可用时显示加载错误，保留现有 Token，不展示后台', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'saved-refresh' });
    fetchMock.mockImplementation(async (input) =>
      input === '/api/user/info'
        ? Response.json({ code: 401, success: false, data: null, msg: '过期' }, { status: 401 })
        : Response.json(
            { code: 503, success: false, data: null, msg: '稍后重试' },
            { status: 503 },
          ),
    );
    renderRoute('/home');
    expect(await screen.findByText('页面加载失败')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    expect(useAuthStore.getState().token).toBe('expired-token');
  });

  it('验证持久化 Token 完成前不展示后台内容', async () => {
    useAuthStore.getState().setToken('stored-token');
    let resolveUser!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveUser = resolve;
        }),
    );
    renderRoute('/home');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/user/info');
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get('Authorization')).toBe(
      'Bearer stored-token',
    );
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
    resolveUser(
      Response.json({
        code: 200,
        success: true,
        data: { id: 1, username: 'jacky' },
        msg: '请求成功',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
  });

  it.each(['/', '/home', '/health', '/not-a-page'])(
    '没有本地 Token 时访问 %s 直接跳转登录，不发起后台请求',
    async (path) => {
      const router = renderRoute(path);

      expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe('/login');
      expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: '欢迎使用 NestJS Agent' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('页面不存在')).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('未登录跳转替换历史记录，后退返回上一个公开页面', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/register', '/health'] });
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    await screen.findByRole('heading', { name: '登录账号' });

    await act(async () => {
      await router.navigate(-1);
    });

    expect(await screen.findByRole('heading', { name: '注册账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/register');
  });

  it('已有登录状态时访问根地址会进入首页', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const router = renderRoute('/');

    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/home');
  });

  it('在后台清除登录状态后立即返回登录页', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const router = renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });

    act(() => useAuthStore.getState().clearToken());

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('navigation', { name: '主导航' })).not.toBeInTheDocument();
  });

  it('退出登录撤销当前会话，清除存储并返回登录页', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const user = userEvent.setup();
    const router = renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });

    await user.click(await logoutMenuItem(user));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/auth/logout');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer test-token');
    expect(options?.body).toBeUndefined();
    expect(useAuthStore.getState().refreshToken).toBeNull();
    expect(useAuthStore.getState().getToken()).toBeNull();
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state.token).toBeNull();
  });

  it('退出失败保留会话并提示重试，等待期间不重复提交', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    let rejectRequest!: (reason: Error) => void;
    const user = userEvent.setup();
    const router = renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });
    const button = screen.getByRole('button', { name: 'jacky 的用户菜单' });
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        }),
    );

    await user.dblClick(await logoutMenuItem(user));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    rejectRequest(new TypeError('network error'));
    expect(await screen.findByText('退出登录失败，请稍后重试')).toBeInTheDocument();
    expect(useAuthStore.getState().getToken()).toBe('test-token');
    expect(router.state.location.pathname).toBe('/home');
    expect(button).toBeEnabled();

    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 200, success: true, data: null, msg: '请求成功' }),
    );
    await user.click(await logoutMenuItem(user));
    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('退出返回 401 时刷新凭证，再重试撤销会话', async () => {
    useAuthStore.getState().setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    const user = userEvent.setup();
    renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { code: 401, success: false, data: null, msg: '凭证已过期' },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          success: true,
          data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
          msg: '请求成功',
        }),
      );

    await user.click(await logoutMenuItem(user));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/user/info',
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/auth/logout',
    ]);
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      'Bearer old-access',
    );
    expect(JSON.parse(fetchMock.mock.calls[2]![1]?.body as string)).toEqual({
      refreshToken: 'old-refresh',
    });
    expect(new Headers(fetchMock.mock.calls[3]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('退出重试仍返回 401 时停止刷新，保留会话并允许再次退出', async () => {
    useAuthStore.getState().setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    const user = userEvent.setup();
    const router = renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { code: 401, success: false, data: null, msg: '凭证已过期' },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          success: true,
          data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
          msg: '请求成功',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: 401, success: false, data: null, msg: '凭证无效' }, { status: 401 }),
      )
      .mockRejectedValue(new Error('不应发送额外请求'));
    const button = screen.getByRole('button', { name: 'jacky 的用户菜单' });

    await user.click(await logoutMenuItem(user));

    expect(await screen.findByText('退出登录失败，请稍后重试')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/user/info',
      '/api/auth/logout',
      '/api/auth/refresh',
      '/api/auth/logout',
    ]);
    expect(new Headers(fetchMock.mock.calls[3]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(router.state.location.pathname).toBe('/home');
    expect(useAuthStore.getState().token).toBe('new-access');
    expect(useAuthStore.getState().refreshToken).toBe('new-refresh');
    expect(button).toBeEnabled();

    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 200, success: true, data: null, msg: '请求成功' }),
    );
    await user.click(await logoutMenuItem(user));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(fetchMock.mock.calls[4]![0]).toBe('/api/auth/logout');
    expect(new Headers(fetchMock.mock.calls[4]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('刷新进行中点击退出，等待轮换完成后使用新凭证且不重复刷新', async () => {
    useAuthStore.getState().setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    const user = userEvent.setup();
    renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });
    let completeRefresh!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeRefresh = resolve;
        }),
    );
    const refreshing = refreshAccessToken();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const button = screen.getByRole('button', { name: 'jacky 的用户菜单' });
    await user.click(await logoutMenuItem(user));
    expect(button).toBeDisabled();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/auth/logout')).toBe(false);
    await act(async () => {
      completeRefresh(
        Response.json({
          code: 200,
          success: true,
          data: { accessToken: 'new-access', refreshToken: 'new-refresh' },
          msg: '请求成功',
        }),
      );
      await refreshing;
    });

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/user/info',
      '/api/auth/refresh',
      '/api/auth/logout',
    ]);
    expect(new Headers(fetchMock.mock.calls[2]![1]?.headers).get('Authorization')).toBe(
      'Bearer new-access',
    );
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('退出请求返回前切换账号，不清除新账号的会话', async () => {
    useAuthStore.getState().setSession({ accessToken: 'old-access', refreshToken: 'old-refresh' });
    const user = userEvent.setup();
    const router = renderRoute('/home');
    await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' });
    let completeLogout!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeLogout = resolve;
        }),
    );
    const button = screen.getByRole('button', { name: 'jacky 的用户菜单' });
    await user.click(await logoutMenuItem(user));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]![0]).toBe('/api/auth/logout');
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).get('Authorization')).toBe(
      'Bearer old-access',
    );

    act(() =>
      useAuthStore.getState().setSession({
        accessToken: 'another-account',
        refreshToken: 'another-refresh',
      }),
    );
    completeLogout(Response.json({ code: 200, success: true, data: null, msg: '请求成功' }));
    await waitFor(() => expect(button).toBeEnabled());

    expect(router.state.location.pathname).toBe('/home');
    expect(useAuthStore.getState().token).toBe('another-account');
    expect(useAuthStore.getState().refreshToken).toBe('another-refresh');
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
      token: 'another-account',
      refreshToken: 'another-refresh',
    });
  });

  it('受保护请求返回 401 时清除会话并返回登录页', async () => {
    useAuthStore
      .getState()
      .setSession({ accessToken: 'expired-token', refreshToken: 'saved-refresh' });
    fetchMock.mockImplementation(async () =>
      Response.json({ code: 401, success: false, data: null, msg: '登录已失效' }, { status: 401 }),
    );
    const router = renderRoute('/health');

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(useAuthStore.getState().getToken()).toBeNull();
  });

  it('从首页导航到服务状态页并加载真实请求层', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const user = userEvent.setup();
    renderRoute('/home');
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '查看服务状态 →' }));
    expect(await screen.findByRole('heading', { name: '服务状态' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('已连接')).toHaveLength(2));
    expect(screen.getByRole('link', { name: '服务状态' })).toHaveAttribute('aria-current', 'page');
  });

  it('数据库失败时保留 API 成功状态，重新检查后可以恢复', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const user = userEvent.setup();
    let databaseAvailable = false;
    fetchMock.mockImplementation(async (input) => {
      if (isDatabaseHealthRequest(input)) {
        return databaseAvailable
          ? Response.json({
              code: 200,
              success: true,
              data: { status: 'ok', database: 'connected' },
              msg: '请求成功',
            })
          : Response.json(
              { code: 503, success: false, data: null, msg: '数据库暂不可用' },
              { status: 503 },
            );
      }
      return Response.json({
        code: 200,
        success: true,
        data: input === '/api/user/info' ? { id: 1, username: 'jacky' } : { status: 'ok' },
        msg: '请求成功',
      });
    });
    renderRoute('/health');
    expect(await screen.findByText('数据库暂不可用')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'NestJS API' })).getByText('已连接'),
    ).toBeInTheDocument();
    databaseAvailable = true;
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新检查' })).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    );
    await user.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(screen.getAllByText('已连接')).toHaveLength(2));
    expect(screen.queryByText('数据库暂不可用')).not.toBeInTheDocument();
  });

  it('未知地址展示 404，并可返回首页', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const user = userEvent.setup();
    const router = renderRoute('/not-a-page');
    expect(await screen.findByText('页面不存在')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/home');
    await user.click(screen.getByRole('link', { name: '返回首页' }));
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/home');
  });

  it('路由加载失败展示错误兜底', async () => {
    useAuthStore.getState().setSession({ accessToken: 'test-token', refreshToken: 'test-refresh' });
    const rootRoute = routes[0]!;
    const router = createMemoryRouter([
      {
        ...rootRoute,
        index: false,
        children: [
          {
            index: true,
            loader: () => {
              throw new Error('route failed');
            },
          },
        ],
      },
    ]);
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText('页面加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
