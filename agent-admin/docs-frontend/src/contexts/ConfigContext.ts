import { createContext, useContext } from 'react';
import type { DocsConfig } from '../services/api';

/**
 * 全站配置 Context。
 *
 * App.tsx 在拉到 /public/docs/config 后才挂载 Provider，所以子组件 useConfig
 * 默认能拿到非 null 的值。少数顶层错误页（DisabledPage）不在 Provider 内
 * 渲染，不需要这里。
 */
export const ConfigContext = createContext<DocsConfig | null>(null);

export function useConfig(): DocsConfig {
  const c = useContext(ConfigContext);
  if (!c) {
    throw new Error('useConfig must be used inside ConfigContext.Provider');
  }
  return c;
}
