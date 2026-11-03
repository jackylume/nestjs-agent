import type { ChangePasswordRequest, UserResponse } from '@nestjs-agent/shared';
import { Alert, App, Avatar, Button, Dropdown, Form, Input, Modal, Spin } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
  Navigate,
  NavLink,
  Outlet,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from 'react-router';
import { changePassword } from '@/api/auth';
import { logoutSession } from '@/api/auth/session';
import { syncAuthStorage, useAuthStore } from '@/stores/auth';
import { passwordRules } from '@/validators/auth';

interface ChangePasswordValues extends ChangePasswordRequest {
  confirmPassword: string;
}

export function RootLayout() {
  const user = useLoaderData<UserResponse>();
  const { message } = App.useApp();
  const [form] = Form.useForm<ChangePasswordValues>();
  const navigation = useNavigation();
  const { revalidate } = useRevalidator();
  const token = useAuthStore((state) => state.token);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(
    () =>
      useAuthStore.subscribe((current, previous) => {
        if (current.sessionVersion === previous.sessionVersion || !current.token) return;
        setPasswordOpen(false);
        setPasswordError(null);
        setError(null);
        if (passwordOpen) form.resetFields();
        void revalidate();
      }),
    [form, passwordOpen, revalidate],
  );

  function closePasswordModal() {
    if (submitting.current) return;
    setPasswordOpen(false);
    setPasswordError(null);
    form.resetFields();
  }

  async function handleChangePassword({ oldPassword, newPassword }: ChangePasswordValues) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setPasswordError(null);
    const version = syncAuthStorage().sessionVersion;

    try {
      await changePassword({ oldPassword, newPassword }).send();
      const current = syncAuthStorage();
      if (current.sessionVersion === version) {
        void message.success('密码修改成功，请重新登录');
        current.clearToken();
      }
    } catch (passwordChangeError) {
      if (syncAuthStorage().sessionVersion === version) {
        setPasswordError(
          passwordChangeError instanceof Error && 'status' in passwordChangeError
            ? passwordChangeError.message
            : '修改密码失败，请稍后重试',
        );
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  async function handleLogout() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);

    try {
      await logoutSession();
    } catch {
      setError('退出登录失败，请稍后重试');
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <span className="text-lg font-semibold tracking-tight">NestJS Agent</span>
          <nav aria-label="主导航" className="flex flex-wrap items-center gap-6">
            {[
              { to: '/home', label: '首页' },
              { to: '/health', label: '服务状态' },
            ].map(({ to, label }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  isActive ? 'font-medium text-teal-700' : 'text-slate-500 hover:text-teal-700'
                }
              >
                {label}
              </NavLink>
            ))}
            <Dropdown
              trigger={['hover', 'click']}
              placement="bottomRight"
              disabled={pending}
              menu={{
                items: [
                  { key: 'change-password', label: '修改密码', disabled: pending },
                  { key: 'logout', label: '退出登录', danger: true, disabled: pending },
                ],
                onClick: ({ key }) => {
                  if (key === 'change-password') setPasswordOpen(true);
                  if (key === 'logout') void handleLogout();
                },
              }}
            >
              <Button
                type="text"
                className="h-auto px-2 py-1"
                disabled={pending}
                loading={pending}
                aria-label={`${user.username} 的用户菜单`}
                aria-haspopup="menu"
                aria-busy={pending}
              >
                <Avatar className="bg-teal-700" size={32}>
                  {user.username.slice(0, 1).toUpperCase()}
                </Avatar>
                <span className="max-w-32 truncate">{user.username}</span>
                <span aria-hidden="true" className="text-slate-400">
                  ▾
                </span>
              </Button>
            </Dropdown>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10" aria-busy={navigation.state !== 'idle'}>
        {error && <Alert className="mb-6" type="error" showIcon title={error} />}
        {navigation.state !== 'idle' && (
          <output className="mb-6 flex items-center gap-3">
            <Spin size="small" />
            <span>页面加载中…</span>
          </output>
        )}
        <Outlet />
      </main>
      <Modal
        title="修改密码"
        open={passwordOpen}
        onCancel={closePasswordModal}
        closable={!pending}
        keyboard={!pending}
        mask={{ closable: !pending }}
        footer={null}
      >
        <Form<ChangePasswordValues>
          form={form}
          name="change-password"
          layout="vertical"
          requiredMark={false}
          validateTrigger="onBlur"
          disabled={pending}
          onFinish={(values) => void handleChangePassword(values)}
          onValuesChange={() => setPasswordError(null)}
        >
          <p className="mb-5 text-slate-500">修改成功后需要重新登录。</p>
          <Form.Item label="旧密码" name="oldPassword" rules={passwordRules}>
            <Input.Password autoComplete="current-password" placeholder="请输入旧密码" />
          </Form.Item>
          <Form.Item label="新密码" name="newPassword" rules={passwordRules}>
            <Input.Password
              autoComplete="new-password"
              placeholder="6～16 位字母、数字、符号或空格"
            />
          </Form.Item>
          <Form.Item
            label="确认新密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value: string) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="再次输入新密码" />
          </Form.Item>
          <div aria-live="polite">
            {passwordError && (
              <Alert className="mb-5" type="error" showIcon title={passwordError} />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button aria-label="取消" disabled={pending} onClick={closePasswordModal}>
              取消
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={pending}
              disabled={pending}
              aria-label="确认修改"
              aria-busy={pending}
            >
              确认修改
            </Button>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
