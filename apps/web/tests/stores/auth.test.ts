import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vite-plus/test';
import { useAuthStore } from '@/stores/auth';

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
  const saved = localStorage.getItem('NESTJS_AGENT_AUTH');
  expect(JSON.parse(saved!).state).toEqual({ token: 'test-token', refreshToken: null });

  act(() => useAuthStore.getState().clearToken());
  localStorage.setItem('NESTJS_AGENT_AUTH', saved!);
  await act(async () => useAuthStore.persist.rehydrate());
  expect(first.result.current).toBe('test-token');

  act(() => useAuthStore.getState().clearToken());
  expect(first.result.current).toBeNull();
  expect(second.result.current).toBeNull();
  await act(async () => useAuthStore.persist.rehydrate());
  expect(useAuthStore.getState().token).toBeNull();
});

it('登录和刷新原子保存双 Token，退出同时清除，版本号仅在切换会话时变化', async () => {
  useAuthStore.getState().setSession({ accessToken: 'access-one', refreshToken: 'refresh-one' });
  const version = useAuthStore.getState().sessionVersion;
  expect(JSON.parse(localStorage.getItem('NESTJS_AGENT_AUTH')!).state).toEqual({
    token: 'access-one',
    refreshToken: 'refresh-one',
  });
  useAuthStore.getState().renewSession({ accessToken: 'access-two', refreshToken: 'refresh-two' });
  expect(useAuthStore.getState().sessionVersion).toBe(version);
  const saved = localStorage.getItem('NESTJS_AGENT_AUTH');
  useAuthStore.getState().clearToken();
  expect(useAuthStore.getState().token).toBeNull();
  expect(useAuthStore.getState().refreshToken).toBeNull();
  localStorage.setItem('NESTJS_AGENT_AUTH', saved!);
  await useAuthStore.persist.rehydrate();
  expect(useAuthStore.getState().token).toBe('access-two');
  expect(useAuthStore.getState().refreshToken).toBe('refresh-two');
});
