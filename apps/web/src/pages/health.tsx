import { useRequest } from 'alova/client';
import { Alert, Button, Card, Tag } from 'antd';
import { getDatabaseHealth, getHealth } from '@/features/health/api';

function ServiceStatus({
  title,
  loading,
  connected,
  error,
}: {
  title: string;
  loading: boolean;
  connected: boolean;
  error?: Error;
}) {
  return (
    <section aria-label={title}>
      <Card title={title}>
        <div aria-live="polite">
          {loading ? (
            <Tag color="processing">检查中…</Tag>
          ) : error ? (
            <Alert type="error" showIcon title="连接失败" description={error.message} />
          ) : connected ? (
            <Tag color="success">已连接</Tag>
          ) : (
            <Alert type="warning" showIcon title="服务响应异常" />
          )}
        </div>
      </Card>
    </section>
  );
}

export function Component() {
  const health = useRequest(getHealth);
  const database = useRequest(getDatabaseHealth);

  return (
    <section>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-3 text-3xl font-semibold tracking-tight">服务状态</h1>
          <p className="text-base text-slate-500">检查应用服务与数据库是否可用。</p>
        </div>
        <Button
          type="primary"
          aria-label="重新检查"
          aria-busy={health.loading || database.loading}
          loading={health.loading || database.loading}
          onClick={() => void Promise.allSettled([health.send(), database.send()])}
        >
          重新检查
        </Button>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <ServiceStatus
          title="NestJS API"
          loading={health.loading}
          connected={health.data?.status === 'ok'}
          error={health.error}
        />
        <ServiceStatus
          title="PostgreSQL"
          loading={database.loading}
          connected={database.data?.database === 'connected'}
          error={database.error}
        />
      </div>
    </section>
  );
}
