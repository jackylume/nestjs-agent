import type { RegisterRequest, RegisterResponse } from '@nestjs-agent/shared';
import { Alert, Button, Form, Input } from 'antd';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { register } from '@/api/auth';
import { passwordRules, usernameRules } from '@/validators/auth';
import { AuthLayout } from '@/layouts/auth-layout';

interface RegisterValues extends RegisterRequest {
  confirmPassword: string;
}

export function Component() {
  const [form] = Form.useForm<RegisterValues>();
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registeredUser, setRegisteredUser] = useState<RegisterResponse | null>(null);

  async function handleRegister({ username, password }: RegisterValues) {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);

    try {
      const user = await register({ username: username.trim(), password }).send();
      form.resetFields(['password', 'confirmPassword']);
      setRegisteredUser(user);
    } catch (registrationError) {
      if (registrationError instanceof Error && 'status' in registrationError) {
        setError(
          registrationError.status === 409
            ? '用户名已被使用，请换一个试试'
            : registrationError.status === 400
              ? registrationError.message
              : '注册失败，请稍后重试',
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
    <AuthLayout title="注册账号" eyebrow="开始新的旅程" description="创建你的 NestJS Agent 账号。">
      {registeredUser ? (
        <div aria-live="polite">
          <Alert
            type="success"
            showIcon
            title="注册成功"
            description={`账号 ${registeredUser.username} 已创建，可以返回登录。`}
          />
        </div>
      ) : (
        <Form<RegisterValues>
          form={form}
          name="register"
          layout="vertical"
          size="large"
          requiredMark={false}
          validateTrigger="onBlur"
          disabled={pending}
          onFinish={(values) => void handleRegister(values)}
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
              autoComplete="new-password"
              spellCheck={false}
              className="h-12"
            />
          </Form.Item>

          <Form.Item
            label="确认密码"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator(_, value: string) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password
              placeholder="再次输入密码"
              autoComplete="new-password"
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
            aria-label="注册"
            aria-busy={pending}
          >
            注册 <span aria-hidden="true">→</span>
          </Button>
        </Form>
      )}

      <p className="mt-7 text-center text-sm text-slate-500">
        {!registeredUser && '已有账号？ '}
        <Link to="/login" className="font-medium text-teal-700 hover:text-teal-600">
          返回登录
        </Link>
      </p>
    </AuthLayout>
  );
}
