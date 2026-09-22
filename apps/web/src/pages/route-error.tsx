import { Button, Result } from 'antd';

export function RouteErrorPage() {
  return (
    <Result
      status="error"
      title="页面加载失败"
      subTitle="请重新加载页面后再试。"
      extra={<Button onClick={() => window.location.reload()}>重新加载</Button>}
    />
  );
}
