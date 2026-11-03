import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form, Input } from 'antd';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AppProviders } from '@/config/providers';
import { routes } from '@/router';
import { passwordRules, usernameRules } from '@/validators/auth';
import { useAuthStore } from '@/stores/auth';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

function renderRoute(path = '/register') {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

async function fillRegistration(
  user: ReturnType<typeof userEvent.setup>,
  username = 'jacky',
  password = 'test-password',
  confirmPassword = password,
) {
  for (const [label, value] of [
    ['用户名', username],
    ['密码', password],
    ['确认密码', confirmPassword],
  ] as const) {
    await user.clear(screen.getByLabelText(label));
    await user.paste(value);
  }
}

describe('注册界面', () => {
  it('可以从登录页进入注册页，并返回登录页', async () => {
    const user = userEvent.setup();
    const router = renderRoute('/login');
    await screen.findByRole('heading', { name: '登录账号' });

    await user.click(screen.getByRole('link', { name: '立即注册' }));
    expect(await screen.findByRole('heading', { name: '注册账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/register');
    expect(screen.queryByRole('link', { name: '返回首页' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'NestJS Agent' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '返回登录' })).toHaveAttribute('href', '/login');
    expect(screen.getByLabelText('密码')).toHaveAttribute('autocomplete', 'new-password');
    expect(screen.getByLabelText('确认密码')).toHaveAttribute('autocomplete', 'new-password');

    await user.click(screen.getByRole('link', { name: '返回登录' }));
    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('空字段与纯空白用户名、密码不能发起注册请求', async () => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '注册账号' });

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('请输入用户名')).toBeInTheDocument();
    expect(await screen.findByText('请输入密码')).toBeInTheDocument();
    expect(await screen.findByText('请再次输入密码')).toBeInTheDocument();

    await fillRegistration(user, '   ', '        ');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('请输入用户名')).toBeInTheDocument();
    expect(await screen.findByText('请输入密码')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('校验用户名和密码长度，以及两次密码是否一致', async () => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '注册账号' });

    await fillRegistration(user, 'a'.repeat(33), 'p'.repeat(17));
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('用户名长度应为 3～32 个字符')).toBeInTheDocument();
    expect(await screen.findByText('密码长度应为 6～16 个字符')).toBeInTheDocument();

    await fillRegistration(user, 'ab', 'short');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('用户名长度应为 3～32 个字符')).toBeInTheDocument();
    expect(await screen.findByText('密码长度应为 6～16 个字符')).toBeInTheDocument();

    await fillRegistration(user, 'jacky', 'test-password', 'another-password');
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['中文𠮷', 'jacky😀', 'jack y', 'jac\tky'])(
    '用户名 %s 包含非允许字符时不能提交',
    async (username) => {
      const user = userEvent.setup();
      renderRoute();
      await screen.findByRole('heading', { name: '注册账号' });
      await fillRegistration(user, username);

      await user.click(screen.getByRole('button', { name: '注册' }));

      expect(
        await screen.findByText('用户名只能包含英文字母、数字和英文符号，不能包含空格'),
      ).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(['pass中文', 'pass😀xx'])('密码 %s 包含非 ASCII 字符时不能提交', async (password) => {
    const user = userEvent.setup();
    renderRoute();
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user, 'jacky', password);

    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(
      await screen.findByText('密码只能包含英文字母、数字、英文符号和空格'),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { username: 'abc', password: '123456' },
    { username: 'a'.repeat(32), password: 'p'.repeat(16) },
    { username: '!@#', password: ' pass word ' },
    { username: '@@@', password: '!!!!!!' },
    { username: '123456', password: '123456' },
  ])('允许边界长度、纯符号和纯数字账号注册：$username', async ({ username, password }) => {
    const user = userEvent.setup();
    renderRoute();
    fetchMock.mockResolvedValueOnce(
      Response.json({ code: 200, success: true, data: { id: 1, username }, msg: '请求成功' }),
    );
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user, username, password);

    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('注册成功')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toEqual({
      username,
      password,
    });
  });

  it.each([
    { field: 'username', value: 'ja\ncky' },
    { field: 'username', value: 'jac\u0000ky' },
    { field: 'password', value: 'pass\tword' },
    { field: 'password', value: 'secret\n' },
    { field: 'password', value: 'secret\u0000' },
  ])('原始 $field 值中的控制字符不能绕过校验：$value', async ({ field, value }) => {
    const { result } = renderHook(() => Form.useForm<{ username: string; password: string }>());
    const [form] = result.current;
    render(
      <Form form={form}>
        <Form.Item name="username" rules={usernameRules}>
          <Input />
        </Form.Item>
        <Form.Item name="password" rules={passwordRules}>
          <Input.Password />
        </Form.Item>
      </Form>,
    );

    await act(async () => {
      form.setFieldsValue({ username: 'jacky', password: 'secret', [field]: value });
      await expect(form.validateFields()).rejects.toMatchObject({
        errorFields: [
          expect.objectContaining({
            name: [field],
            errors: expect.arrayContaining([
              field === 'username'
                ? '用户名只能包含英文字母、数字和英文符号，不能包含空格'
                : '密码只能包含英文字母、数字、英文符号和空格',
            ]),
          }),
        ],
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('提交去除首尾空白的用户名和原样密码，成功后隐藏密码表单且不登录', async () => {
    const user = userEvent.setup();
    const router = renderRoute();
    fetchMock.mockResolvedValueOnce(
      Response.json({
        code: 200,
        success: true,
        data: { id: 1, username: 'jacky' },
        msg: '请求成功',
      }),
    );
    await screen.findByRole('heading', { name: '注册账号' });
    const savedAuth = localStorage.getItem('NESTJS_AGENT_AUTH');
    await fillRegistration(user, '  jacky  ', ' pass word ');

    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(await screen.findByText('注册成功')).toBeInTheDocument();
    expect(screen.getByText('账号 jacky 已创建，可以返回登录。')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/auth/register');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({
      username: 'jacky',
      password: ' pass word ',
    });
    expect(screen.queryByLabelText('密码')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('确认密码')).not.toBeInTheDocument();
    expect(useAuthStore.getState().getToken()).toBeNull();
    expect(localStorage.getItem('NESTJS_AGENT_AUTH')).toBe(savedAuth);
    expect(router.state.location.pathname).toBe('/register');

    await user.click(screen.getByRole('link', { name: '返回登录' }));
    expect(await screen.findByRole('heading', { name: '登录账号' })).toBeInTheDocument();
  });

  it('用户名冲突时保留表单，修改用户名后可以重新注册', async () => {
    const user = userEvent.setup();
    renderRoute();
    fetchMock
      .mockResolvedValueOnce(
        Response.json(
          { code: 409, success: false, data: null, msg: '用户名已存在' },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          code: 200,
          success: true,
          data: { id: 2, username: 'jacky2' },
          msg: '请求成功',
        }),
      );
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user);

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('用户名已被使用，请换一个试试')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toHaveValue('test-password');
    expect(screen.getByRole('button', { name: '注册' })).toBeEnabled();

    await user.type(screen.getByLabelText('用户名'), '2');
    expect(screen.queryByText('用户名已被使用，请换一个试试')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('注册成功')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.lastCall?.[1]?.body as string)).toMatchObject({
      username: 'jacky2',
    });
  });

  it('展示服务器返回的输入校验错误，并允许修改后重试', async () => {
    const user = userEvent.setup();
    renderRoute();
    fetchMock.mockResolvedValueOnce(
      Response.json(
        { code: 400, success: false, data: null, msg: '用户名格式不正确' },
        { status: 400 },
      ),
    );
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user);

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('用户名格式不正确')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeEnabled();
    expect(screen.getByLabelText('密码')).toHaveValue('test-password');

    await user.type(screen.getByLabelText('用户名'), '2');
    expect(screen.queryByText('用户名格式不正确')).not.toBeInTheDocument();
  });

  it('网络失败时显示可理解的提示，同一份表单可以重试', async () => {
    const user = userEvent.setup();
    renderRoute();
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(
      Response.json({
        code: 200,
        success: true,
        data: { id: 1, username: 'jacky' },
        msg: '请求成功',
      }),
    );
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user);

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('无法连接服务器，请检查网络后重试')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeEnabled();
    expect(screen.getByLabelText('密码')).toHaveValue('test-password');

    await user.click(screen.getByRole('button', { name: '注册' }));
    expect(await screen.findByText('注册成功')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('请求未完成时禁用提交按钮，重复点击和回车不会产生额外请求', async () => {
    const user = userEvent.setup();
    renderRoute();
    let resolveResponse: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    await screen.findByRole('heading', { name: '注册账号' });
    await fillRegistration(user);
    const submit = screen.getByRole('button', { name: '注册' });

    await user.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(submit).toBeDisabled();
    expect(submit).toHaveAttribute('aria-busy', 'true');

    await user.click(submit);
    await user.click(screen.getByLabelText('确认密码'));
    await user.keyboard('{Enter}{Enter}');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveResponse?.(
        Response.json({
          code: 200,
          success: true,
          data: { id: 1, username: 'jacky' },
          msg: '请求成功',
        }),
      );
    });
    expect(await screen.findByText('注册成功')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
