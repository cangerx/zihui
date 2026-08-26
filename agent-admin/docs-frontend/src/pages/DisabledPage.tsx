type Props = {
  variant?: 'disabled' | 'error';
  message?: string;
};

/**
 * 顶层错误 / 禁用页面，不依赖 ConfigContext，可在任何时机渲染。
 *
 * - disabled：admin 设置里把 docs_enabled 关了
 * - error：拉 /config 接口失败（网络问题 / 后端炸了）
 */
export default function DisabledPage({ variant = 'disabled', message }: Props) {
  const isError = variant === 'error';
  return (
    <div className="centered-screen">
      <div className="empty-state">
        <h1>{isError ? '加载失败' : '文档站点未启用'}</h1>
        <p style={{ color: '#666', marginTop: 8 }}>
          {isError
            ? (message || '无法连接到服务器，请稍后重试。')
            : '管理员尚未启用文档功能，请稍后再来。'}
        </p>
      </div>
    </div>
  );
}
