import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AppProviders } from '@/config/providers';
import { routes } from '@/router';
import { useAuthStore } from '@/stores/auth';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(
    Response.json({
      code: 200,
      success: true,
      data: { id: 1, username: 'jacky' },
      msg: '请求成功',
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

function renderRoute(path = '/login') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('登录界面', () => {
  it('未登录可以直接打开登录页，页面不提供进入后台的链接', async () => {
    const router = renderRoute();

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'NestJS Agent' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '立即注册' })).toHaveAttribute('href', '/register');
  });

  it('空字段和纯空白用户名不能通过校验，也不会发起请求', async () => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });

    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('请输入用户名')).toBeInTheDocument();
    expect(await screen.findByText('请输入密码')).toBeInTheDocument();

    await user.type(screen.getByLabelText('用户名'), '   ');
    await user.type(screen.getByLabelText('密码'), 'test-password');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('请输入用户名')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['ab', '123456', '用户名长度应为 3～32 个字符'],
    ['a'.repeat(33), '123456', '用户名长度应为 3～32 个字符'],
    ['jack y', '123456', '用户名只能包含英文字母、数字和英文符号，不能包含空格'],
    ['用户123', '123456', '用户名只能包含英文字母、数字和英文符号，不能包含空格'],
    ['jacky', '12345', '密码长度应为 6～16 个字符'],
    ['jacky', '1'.repeat(17), '密码长度应为 6～16 个字符'],
    ['jacky', 'pass😀word', '密码只能包含英文字母、数字、英文符号和空格'],
  ])('登录表单校验用户名 %j 和密码 %j', async (username, password, error) => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });
    await user.click(screen.getByLabelText('用户名'));
    await user.paste(username);
    await user.click(screen.getByLabelText('密码'));
    await user.paste(password);

    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText(error)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('支持密码自动填充和鼠标、键盘显隐切换，保留密码且不提交表单', async () => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });

    const password = screen.getByLabelText('密码');
    expect(screen.getByLabelText('用户名')).toHaveAttribute('autocomplete', 'username');
    expect(password).toHaveAttribute('autocomplete', 'current-password');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(screen.getByLabelText('用户名'), 'jacky');
    await user.type(password, 'test-password');

    await user.click(screen.getByRole('button', { name: '显示' }));
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('test-password');

    await user.click(screen.getByRole('button', { name: '隐藏' }));
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('test-password');

    await user.tab();
    expect(screen.getByRole('button', { name: '显示' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('test-password');
    expect(screen.getByRole('button', { name: '隐藏' })).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard(' ');
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveValue('test-password');
    expect(screen.getByRole('button', { name: '显示' })).toHaveAttribute('aria-pressed', 'false');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['abc', '123456'],
    ['a'.repeat(32), '1'.repeat(16)],
    ['  !@#  ', ' pass word '],
  ])('用户名 %j 和密码 %j 支持回车登录，保存会话并进入首页', async (username, password) => {
    const user = userEvent.setup();
    const router = renderRoute();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        code: 200,
        success: true,
        data: {
          accessToken: 'session-token',
          refreshToken: 'session-refresh',
          refreshTokenExpiresAt: new Date(7 * 24 * 60 * 60 * 1000).toISOString(),
          accessTokenExpiresAt: '2026-11-01T00:00:00.000Z',
        },
        msg: '请求成功',
      }),
    );
    await screen.findByRole('heading', { name: '登录账号' });
    await user.click(screen.getByLabelText('用户名'));
    await user.paste(username);
    await user.click(screen.getByLabelText('密码'));
    await user.paste(password);
    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/home');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({ username: username.trim(), password });
    const [userUrl, userOptions] = fetchMock.mock.calls[1]!;
    expect(userUrl).toBe('/api/user/info');
    expect(userOptions?.method).toBe('GET');
    expect(new Headers(userOptions?.headers).get('Authorization')).toBe('Bearer session-token');
    expect(useAuthStore.getState().getToken()).toBe('session-token');
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
      token: 'session-token',
      refreshToken: 'session-refresh',
    });
    expect(localStorage.getItem('NESTJS_AGENT_AUTH')).not.toContain(password);
  });

  it.each([
    [401, '认证失败', '用户名或密码错误'],
    [400, '用户名格式错误', '用户名格式错误'],
    [500, '内部错误', '登录失败，请稍后重试'],
  ])('登录返回 %s 时显示错误并保留输入，修改后清除提示', async (status, message, expected) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: status, success: false, data: null, msg: message }, { status }),
    );
    const user = userEvent.setup();
    const router = renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });
    await user.type(screen.getByLabelText('用户名'), 'jacky');
    await user.type(screen.getByLabelText('密码'), ' pass word ');
    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText(expected)).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toHaveValue(' pass word ');
    expect(router.state.location.pathname).toBe('/login');
    expect(useAuthStore.getState().getToken()).toBeNull();
    expect(screen.getByRole('button', { name: '登录' })).toBeEnabled();
    await user.type(screen.getByLabelText('用户名'), '2');
    expect(screen.queryByText(expected)).not.toBeInTheDocument();
  });

  it('已有有效会话时，重新登录的错误密码不会清除原会话', async () => {
    useAuthStore.getState().setToken('existing-token');
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 401, success: false, data: null, msg: '用户名或密码错误' },
        { status: 401 },
      ),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });
    await user.type(screen.getByLabelText('用户名'), 'jacky');
    await user.type(screen.getByLabelText('密码'), 'wrong-password');

    await user.click(screen.getByRole('button', { name: '登录' }));

    expect(await screen.findByText('用户名或密码错误')).toBeInTheDocument();
    expect(new Headers(fetchMock.mock.lastCall?.[1]?.headers).get('Authorization')).toBeNull();
    expect(useAuthStore.getState().getToken()).toBe('existing-token');
    expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state.token).toBe(
      'existing-token',
    );
  });

  it('等待登录响应时禁用表单避免重复请求，网络失败后可以重试', async () => {
    let rejectRequest!: (reason: Error) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '登录账号' });
    await user.type(screen.getByLabelText('用户名'), 'jacky');
    await user.type(screen.getByLabelText('密码'), '123456');
    const button = screen.getByRole('button', { name: '登录' });
    await user.dblClick(button);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByLabelText('用户名')).toBeDisabled();
    expect(screen.getByLabelText('密码')).toBeDisabled();
    rejectRequest(new TypeError('network error'));
    expect(await screen.findByText('无法连接服务器，请检查网络后重试')).toBeInTheDocument();
    expect(button).toBeEnabled();
    expect(useAuthStore.getState().getToken()).toBeNull();

    fetchMock.mockResolvedValueOnce(
      Response.json({
        code: 200,
        success: true,
        data: {
          accessToken: 'retry-token',
          refreshToken: 'retry-refresh',
          refreshTokenExpiresAt: new Date(7 * 24 * 60 * 60 * 1000).toISOString(),
          accessTokenExpiresAt: '2026-11-01T00:00:00.000Z',
        },
        msg: '请求成功',
      }),
    );
    await user.click(button);
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().getToken()).toBe('retry-token');
  });
});
