import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfigProvider } from 'antd';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AppProviders } from '@/config/providers';
import { routes } from '@/router';
import { useAuthStore } from '@/stores/auth';

const fetchMock = vi.fn<typeof fetch>();

function success(data: unknown = null) {
  return Response.json({ code: 200, success: true, data, msg: '请求成功' });
}

beforeEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
  useAuthStore.getState().setSession({ accessToken: 'access', refreshToken: 'refresh' });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) =>
    success(input === '/api/user/info' ? { id: 1, username: 'jacky' } : null),
  );
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

function renderLayout() {
  const router = createMemoryRouter(routes, { initialEntries: ['/home'] });
  render(
    <AppProviders>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <RouterProvider router={router} />
      </ConfigProvider>
    </AppProviders>,
  );
  return router;
}

async function openPasswordDialog(user: ReturnType<typeof userEvent.setup>, username = 'jacky') {
  await user.hover(await screen.findByRole('button', { name: `${username} 的用户菜单` }));
  const item = await screen.findByRole('menuitem', { name: '修改密码' });
  await waitFor(() => expect(getComputedStyle(item).pointerEvents).not.toBe('none'));
  await user.click(item);
  return screen.findByRole('dialog', { name: '修改密码' });
}

async function fillPasswords(
  user: ReturnType<typeof userEvent.setup>,
  confirmation = 'new-password',
) {
  await user.type(screen.getByLabelText('旧密码'), 'old-password');
  await user.type(screen.getByLabelText('新密码', { exact: true }), 'new-password');
  await user.type(screen.getByLabelText('确认新密码'), confirmation);
}

describe('用户菜单和修改密码', () => {
  it('展示用户名，悬停后显示修改密码和退出登录两项菜单', async () => {
    const user = userEvent.setup();
    renderLayout();
    const trigger = await screen.findByRole('button', { name: 'jacky 的用户菜单' });
    expect(trigger).toHaveTextContent('jacky');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.hover(trigger);

    const menu = await screen.findByRole('menu');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(2);
    expect(within(menu).getByRole('menuitem', { name: '修改密码' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: '退出登录' })).toBeInTheDocument();
  });

  it('修改密码成功后清除会话，提示重新登录', async () => {
    const user = userEvent.setup();
    const router = renderLayout();
    await openPasswordDialog(user);
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(await screen.findByText('密码修改成功，请重新登录')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    const [url, options] = fetchMock.mock.calls[1]!;
    expect(url).toBe('/api/auth/change-password');
    expect(options?.method).toBe('POST');
    expect(new Headers(options?.headers).get('Authorization')).toBe('Bearer access');
    expect(JSON.parse(options?.body as string)).toEqual({
      oldPassword: 'old-password',
      newPassword: 'new-password',
    });
    expect(useAuthStore.getState().token).toBeNull();
    expect(useAuthStore.getState().refreshToken).toBeNull();
  });

  it('旧密码错误时保留输入和会话，允许修改后重试', async () => {
    const user = userEvent.setup();
    const router = renderLayout();
    await openPasswordDialog(user);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 400, success: false, data: null, msg: '旧密码不正确' },
        { status: 400 },
      ),
    );
    await fillPasswords(user);

    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByText('旧密码不正确')).toBeInTheDocument();
    expect(screen.getByLabelText('旧密码')).toHaveValue('old-password');
    expect(screen.getByLabelText('新密码', { exact: true })).toHaveValue('new-password');
    expect(useAuthStore.getState().token).toBe('access');
    expect(router.state.location.pathname).toBe('/home');

    await user.clear(screen.getByLabelText('旧密码'));
    await user.type(screen.getByLabelText('旧密码'), 'correct-password');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('确认密码不一致时阻止提交，修正后可以提交', async () => {
    const user = userEvent.setup();
    renderLayout();
    await openPasswordDialog(user);
    await fillPasswords(user, 'different-password');

    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.clear(screen.getByLabelText('确认新密码'));
    await user.type(screen.getByLabelText('确认新密码'), 'new-password');
    await user.click(screen.getByRole('button', { name: '确认修改' }));

    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
  });

  it('取消后再次打开，清空密码和错误提示', async () => {
    const user = userEvent.setup();
    renderLayout();
    await openPasswordDialog(user);
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 400, success: false, data: null, msg: '旧密码不正确' },
        { status: 400 },
      ),
    );
    await fillPasswords(user);
    await user.click(screen.getByRole('button', { name: '确认修改' }));
    await screen.findByText('旧密码不正确');

    await user.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await openPasswordDialog(user);

    expect(screen.getByLabelText('旧密码')).toHaveValue('');
    expect(screen.getByLabelText('新密码', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('确认新密码')).toHaveValue('');
    expect(screen.queryByText('旧密码不正确')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('等待响应时不重复提交且不能关闭弹窗，网络失败后恢复操作', async () => {
    const user = userEvent.setup();
    renderLayout();
    const dialog = await openPasswordDialog(user);
    await fillPasswords(user);
    let rejectRequest!: (reason: Error) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((_, reject) => {
          rejectRequest = reject;
        }),
    );

    await user.dblClick(screen.getByRole('button', { name: '确认修改' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: '确认修改' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'jacky 的用户菜单' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'jacky 的用户菜单' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    await user.keyboard('{Escape}');
    expect(dialog).toBeInTheDocument();

    rejectRequest(new TypeError('network error'));

    await waitFor(() => expect(screen.getByRole('button', { name: '确认修改' })).toBeEnabled());
    expect(screen.getByRole('button', { name: '取消' })).toBeEnabled();
    expect(useAuthStore.getState().token).toBe('access');
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });

  it.each([200, 400])('改密请求返回 %s 前切换账号，不影响新账号会话和表单', async (status) => {
    const user = userEvent.setup();
    const router = renderLayout();
    await openPasswordDialog(user);
    await fillPasswords(user);
    let completeRequest!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          completeRequest = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: '确认修改' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    fetchMock.mockResolvedValueOnce(success({ id: 2, username: 'another' }));
    act(() =>
      useAuthStore.getState().setSession({
        accessToken: 'another-access',
        refreshToken: 'another-refresh',
      }),
    );
    completeRequest(
      status === 200
        ? success()
        : Response.json(
            { code: 400, success: false, data: null, msg: '旧密码不正确' },
            { status: 400 },
          ),
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'another 的用户菜单' })).toBeEnabled(),
    );
    expect(screen.queryByRole('dialog', { name: '修改密码' })).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/home');
    expect(useAuthStore.getState().token).toBe('another-access');
    expect(useAuthStore.getState().refreshToken).toBe('another-refresh');

    await openPasswordDialog(user, 'another');
    expect(screen.getByLabelText('旧密码')).toHaveValue('');
    expect(screen.getByLabelText('新密码', { exact: true })).toHaveValue('');
    expect(screen.getByLabelText('确认新密码')).toHaveValue('');
    expect(screen.queryByText('旧密码不正确')).not.toBeInTheDocument();
  });
});
