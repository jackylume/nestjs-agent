import type { RouteObject } from 'react-router';
import { RootLayout } from '@/layouts/root-layout';
import { NotFoundPage } from '@/pages/not-found';
import { RouteErrorPage } from '@/pages/route-error';

export const routes: RouteObject[] = [
  {
    path: '/',
    Component: RootLayout,
    errorElement: <RouteErrorPage />,
    hydrateFallbackElement: <output className="block p-10">页面加载中…</output>,
    children: [
      { index: true, lazy: () => import('@/pages/home') },
      { path: 'health', lazy: () => import('@/pages/health') },
      { path: '*', Component: NotFoundPage },
    ],
  },
];
