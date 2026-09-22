import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useAuthStore } from './auth';

afterEach(() => {
  useAuthStore.getState().clearToken();
  useAuthStore.persist.clearStorage();
});

it('解构后的 getToken 始终读取最新值', () => {
  const { getToken, setToken, clearToken } = useAuthStore.getState();
  expect(getToken()).toBeNull();
  setToken('first-token');
  expect(getToken()).toBe('first-token');
  setToken('second-token');
  expect(getToken()).toBe('second-token');
  clearToken();
  expect(getToken()).toBeNull();
});

it('组件共享 Token 更新，重新加载存储后恢复，退出后清除', async () => {
  const first = renderHook(() => useAuthStore((state) => state.token));
  const second = renderHook(() => useAuthStore((state) => state.token));
  act(() => useAuthStore.getState().setToken('test-token'));
  expect(first.result.current).toBe('test-token');
  expect(second.result.current).toBe('test-token');
  const saved = localStorage.getItem('nestjs-agent-auth');
  expect(JSON.parse(saved!).state).toEqual({ token: 'test-token' });

  act(() => useAuthStore.getState().clearToken());
  localStorage.setItem('nestjs-agent-auth', saved!);
  await act(async () => useAuthStore.persist.rehydrate());
  expect(first.result.current).toBe('test-token');

  act(() => useAuthStore.getState().clearToken());
  expect(first.result.current).toBeNull();
  expect(second.result.current).toBeNull();
  await act(async () => useAuthStore.persist.rehydrate());
  expect(useAuthStore.getState().token).toBeNull();
});
