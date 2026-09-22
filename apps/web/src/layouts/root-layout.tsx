import { Spin } from 'antd';
import { NavLink, Outlet, useNavigation } from 'react-router';

export function RootLayout() {
  const navigation = useNavigation();

  return (
    <div className="min-h-screen text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <span className="text-lg font-semibold tracking-tight">NestJS Agent</span>
          <nav aria-label="主导航" className="flex gap-6">
            {[
              { to: '/', label: '首页' },
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
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-10" aria-busy={navigation.state !== 'idle'}>
        {navigation.state !== 'idle' && (
          <output className="mb-6 flex items-center gap-3">
            <Spin size="small" />
            <span>页面加载中…</span>
          </output>
        )}
        <Outlet />
      </main>
    </div>
  );
}
