import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from './providers';
import { routes } from './routes';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) =>
    Response.json(
      String(input).endsWith('/health/db')
        ? { status: 'ok', database: 'connected' }
        : { status: 'ok' },
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
});

function renderRoute(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe('应用路由和服务状态', () => {
  it('从首页导航到服务状态页并加载真实请求层', async () => {
    const user = userEvent.setup();
    renderRoute('/');
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '查看服务状态 →' }));
    expect(await screen.findByRole('heading', { name: '服务状态' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('已连接')).toHaveLength(2));
    expect(screen.getByRole('link', { name: '服务状态' })).toHaveAttribute('aria-current', 'page');
  });

  it('数据库失败时保留 API 成功状态，重新检查后可以恢复', async () => {
    const user = userEvent.setup();
    let databaseAvailable = false;
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/health/db')) {
        return databaseAvailable
          ? Response.json({ status: 'ok', database: 'connected' })
          : Response.json({ message: '数据库暂不可用' }, { status: 503 });
      }
      return Response.json({ status: 'ok' });
    });
    renderRoute('/health');
    expect(await screen.findByText('数据库暂不可用')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'NestJS API' })).getByText('已连接'),
    ).toBeInTheDocument();
    databaseAvailable = true;
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '重新检查' })).toHaveAttribute(
        'aria-busy',
        'false',
      ),
    );
    await user.click(screen.getByRole('button', { name: '重新检查' }));
    await waitFor(() => expect(screen.getAllByText('已连接')).toHaveLength(2));
    expect(screen.queryByText('数据库暂不可用')).not.toBeInTheDocument();
  });

  it('未知地址展示 404，并可返回首页', async () => {
    const user = userEvent.setup();
    renderRoute('/not-a-page');
    expect(await screen.findByText('页面不存在')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: '返回首页' }));
    expect(
      await screen.findByRole('heading', { name: '欢迎使用 NestJS Agent' }),
    ).toBeInTheDocument();
  });

  it('路由加载失败展示错误兜底', async () => {
    const rootRoute = routes[0]!;
    const router = createMemoryRouter([
      {
        ...rootRoute,
        index: false,
        children: [
          {
            index: true,
            loader: () => {
              throw new Error('route failed');
            },
          },
        ],
      },
    ]);
    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>,
    );
    expect(await screen.findByText('页面加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });
});
