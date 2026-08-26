/**
 * 全屏 loading：加载 config 期间和路由懒加载之间用。
 * 设计上不显示文字，避免抖动；只用一个细线条 spinner。
 */
export default function LoadingScreen() {
  return (
    <div className="loading-screen">
      <div className="loading-spinner" />
    </div>
  );
}
