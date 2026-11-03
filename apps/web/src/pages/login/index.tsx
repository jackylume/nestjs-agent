import type { LoginRequest } from '@nestjs-agent/shared';
import { Alert, Button, Form, Input } from 'antd';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { login } from '@/api/auth';
import { saveSession } from '@/api/auth/session';
import { passwordRules, usernameRules } from '@/validators/auth';
import { AuthLayout } from '@/layouts/auth-layout';

export function Component() {
  const navigate = useNavigate();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin({ username, password }: LoginRequest) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);

    try {
      const session = await login({ username: username.trim(), password }).send();
      await saveSession(session);
      await navigate('/home', { replace: true });
    } catch (loginError) {
      if (loginError instanceof Error && 'status' in loginError) {
        setError(
          loginError.status === 401
            ? '用户名或密码错误'
            : loginError.status === 400
              ? loginError.message
              : '登录失败，请稍后重试',
        );
      } else {
        setError('无法连接服务器，请检查网络后重试');
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <AuthLayout
      title="登录账号"
      eyebrow="欢迎回来"
      description="使用用户名和密码登录 NestJS Agent。"
    >
      <Form<LoginRequest>
        name="login"
        layout="vertical"
        size="large"
        requiredMark={false}
        validateTrigger="onBlur"
        disabled={pending}
        onFinish={(values) => void handleLogin(values)}
        onValuesChange={() => setError(null)}
      >
        <Form.Item label="用户名" name="username" rules={usernameRules}>
          <Input
            placeholder="3～32 位英文字母、数字或符号"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-12"
          />
        </Form.Item>

        <Form.Item label="密码" name="password" rules={passwordRules}>
          <Input.Password
            placeholder="6～16 位字母、数字、符号或空格"
            autoComplete="current-password"
            spellCheck={false}
            className="h-12"
          />
        </Form.Item>

        <div aria-live="polite">
          {error && <Alert className="mb-6" type="error" showIcon title={error} />}
        </div>

        <Button
          type="primary"
          htmlType="submit"
          block
          className="h-12"
          loading={pending}
          disabled={pending}
          aria-label="登录"
          aria-busy={pending}
        >
          登录 <span aria-hidden="true">→</span>
        </Button>
      </Form>

      <p className="mt-7 text-center text-sm text-slate-500">
        还没有账号？{' '}
        <Link to="/register" className="font-medium text-teal-700 hover:text-teal-600">
          立即注册
        </Link>
      </p>
    </AuthLayout>
  );
}
