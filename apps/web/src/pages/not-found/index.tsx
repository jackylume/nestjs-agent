import { Result } from 'antd';
import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请检查访问地址，或返回首页。"
      extra={<Link to="/home">返回首页</Link>}
    />
  );
}
