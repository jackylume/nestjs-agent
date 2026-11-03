import type { FormRule } from 'antd';

const trimUsername = (value: string | undefined) => value?.trim();

export const usernameRules: FormRule[] = [
  { required: true, transform: trimUsername, message: '请输入用户名' },
  {
    min: 3,
    max: 32,
    transform: trimUsername,
    message: '用户名长度应为 3～32 个字符',
  },
  {
    transform: trimUsername,
    validator(_, value: string | undefined) {
      if (value && /[^\x21-\x7E]/.test(value)) {
        return Promise.reject(new Error('用户名只能包含英文字母、数字和英文符号，不能包含空格'));
      }
      return Promise.resolve();
    },
  },
];

export const passwordRules: FormRule[] = [
  { required: true, whitespace: true, message: '请输入密码' },
  { min: 6, max: 16, message: '密码长度应为 6～16 个字符' },
  {
    validator(_, value: string | undefined) {
      if (value && /[^\x20-\x7E]/.test(value)) {
        return Promise.reject(new Error('密码只能包含英文字母、数字、英文符号和空格'));
      }
      return Promise.resolve();
    },
  },
];
