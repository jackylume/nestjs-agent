import { Card } from 'antd';
import { Link } from 'react-router';

export function Component() {
  return (
    <section>
      <h1 className="mb-3 text-3xl font-semibold tracking-tight">欢迎使用 NestJS Agent</h1>
      <p className="mb-8 text-base text-slate-500">从这里开始构建你的应用。</p>
      <Card title="服务连接">
        <p className="mb-5 text-slate-600">查看应用服务和数据库的实时连接状态。</p>
        <Link to="/health" className="font-medium text-teal-700 hover:text-teal-600">
          查看服务状态 →
        </Link>
      </Card>
    </section>
  );
}
