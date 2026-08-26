import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { publicApi } from '../services/api';

/**
 * 公开站点配置（/public/site-config）的全局缓存。
 * - balance_type='token'  -> 现金钱包（cash），默认显示"金币"
 * - balance_type='credit' -> 积分钱包，默认显示"积分"
 * - site.title            -> 站点标题（左上角 + 浏览器 tab）
 *
 * 通过 /public/site-config 公开端点拉取（无需登录），登录页 / 注册页也能展示自定义文案。
 * 启动时先用 localStorage 缓存避免首屏闪烁。
 */
export interface CurrencyLabels {
  token: string;
  credit: string;
}

export interface SiteInfo {
  title: string;
}

const DEFAULT_LABELS: CurrencyLabels = { token: '金币', credit: '积分' };
const DEFAULT_SITE: SiteInfo = { title: 'Agent Admin' };

interface CurrencyContextValue {
  labels: CurrencyLabels;
  site: SiteInfo;
  loading: boolean;
  refresh: () => Promise<void>;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  labels: DEFAULT_LABELS,
  site: DEFAULT_SITE,
  loading: false,
  refresh: async () => {},
});

const STORAGE_KEY = 'site_config_cache';
const LEGACY_KEY = 'currency_labels_cache';

interface CachedConfig {
  labels: CurrencyLabels;
  site: SiteInfo;
}

function readCache(): CachedConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_KEY);
    if (!raw) return { labels: DEFAULT_LABELS, site: DEFAULT_SITE };
    const parsed = JSON.parse(raw);
    return {
      labels: {
        token: typeof parsed?.labels?.token === 'string' && parsed.labels.token
          ? parsed.labels.token
          : (typeof parsed?.token === 'string' && parsed.token ? parsed.token : DEFAULT_LABELS.token),
        credit: typeof parsed?.labels?.credit === 'string' && parsed.labels.credit
          ? parsed.labels.credit
          : (typeof parsed?.credit === 'string' && parsed.credit ? parsed.credit : DEFAULT_LABELS.credit),
      },
      site: {
        title: typeof parsed?.site?.title === 'string' && parsed.site.title
          ? parsed.site.title
          : DEFAULT_SITE.title,
      },
    };
  } catch {
    return { labels: DEFAULT_LABELS, site: DEFAULT_SITE };
  }
}

function writeCache(cfg: CachedConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    // 清掉旧版本残留键，避免长期占用 localStorage
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // localStorage 不可用时静默失败
  }
}

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const initial = readCache();
  const [labels, setLabels] = useState<CurrencyLabels>(initial.labels);
  const [site, setSite] = useState<SiteInfo>(initial.site);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await publicApi.siteConfig();
      const nextLabels: CurrencyLabels = {
        token: res.data?.currency?.token || DEFAULT_LABELS.token,
        credit: res.data?.currency?.credit || DEFAULT_LABELS.credit,
      };
      const nextSite: SiteInfo = {
        title: res.data?.site?.title || DEFAULT_SITE.title,
      };
      setLabels(nextLabels);
      setSite(nextSite);
      writeCache({ labels: nextLabels, site: nextSite });
    } catch {
      // 拉取失败保持当前值
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // 同步浏览器 tab title
  useEffect(() => {
    if (site.title) document.title = site.title;
  }, [site.title]);

  const value = useMemo<CurrencyContextValue>(
    () => ({ labels, site, loading, refresh }),
    [labels, site, loading, refresh]
  );

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrencyLabels(): CurrencyContextValue {
  return useContext(CurrencyContext);
}

export function useSiteInfo(): SiteInfo {
  return useContext(CurrencyContext).site;
}

/**
 * 工具函数：根据 balance_type / billing_type 取对应文案。
 * 与 useCurrencyLabels 配合使用：
 *   const { labels } = useCurrencyLabels();
 *   <Tag>{getCurrencyLabel(labels, record.balance_type)}</Tag>
 */
export function getCurrencyLabel(labels: CurrencyLabels, type: string | undefined | null): string {
  return type === 'credit' ? labels.credit : labels.token;
}
