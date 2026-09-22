import { StyleProvider } from '@ant-design/cssinjs';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { PropsWithChildren } from 'react';

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <StyleProvider layer>
      <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#0f766e', borderRadius: 8 } }}>
        <AntdApp>{children}</AntdApp>
      </ConfigProvider>
    </StyleProvider>
  );
}
