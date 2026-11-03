import { replace, type RouteObject } from 'react-router';
import { RootLayout } from '@/layouts/root-layout';
import { NotFoundPage } from '@/pages/not-found';
import { RouteErrorPage } from '@/pages/route-error';
import { getUserInfo } from '@/api/user';
import { refreshAccessToken } from '@/api/auth/session';
import { useAuthStore } from '@/stores/auth';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    loader: async ({ request }) => {
      try {
        if (!useAuthStore.getState().getToken()) await refreshAccessToken();
        const user = await getUserInfo().send();
        if (!useAuthStore.getState().getToken()) return replace('/login');
        return new URL(request.url).pathname === '/' ? replace('/home') : user;
      } catch (error) {
        if (error instanceof Error && 'status' in error && error.status === 401)
          return replace('/login');
        throw error;
      }
    },
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <output className="block p-10">页面加载中…</output>,
    children: [
      {
        index: true,
        Component: () => null,
      },
      { path: 'home', lazy: () => import('@/pages/home') },
      { path: 'health', lazy: () => import('@/pages/health') },
      { path: '*', Component: NotFoundPage },
    ],
  },
  {
    path: '/login',
    lazy: () => import('@/pages/login'),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <output className="block p-10">页面加载中…</output>,
  },
  {
    path: '/register',
    lazy: () => import('@/pages/register'),
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <output className="block p-10">页面加载中…</output>,
  },
];
