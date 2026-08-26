import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * URL 查询参数与列表筛选/分页 state 双向同步。
 *
 * 用法：
 *   const [params, setParams] = useUrlSyncedParams({ page: 1, per_page: 50 });
 *
 * 行为：
 * - 首次挂载从 URL 读取参数，覆盖 defaults
 * - setParams 时把当前 state 写回 URL（replace）
 * - 值为 undefined / null / '' 的键会从 URL 中移除
 * - numberKeys 中列出的键会自动转 number；其余保留 string
 */
type Params = Record<string, any>;

interface Options {
  /** 数字键（page、per_page、id 类）会自动 Number()，避免 URL 字符串污染分页/筛选 */
  numberKeys?: string[];
}

const DEFAULT_NUMBER_KEYS = [
  'page', 'per_page',
  'user_id', 'plan_id', 'code_id', 'cloud_model_id', 'group_id',
];

export function useUrlSyncedParams<T extends Params = Params>(
  defaults: T,
  options: Options = {}
) {
  const { numberKeys = DEFAULT_NUMBER_KEYS } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  // 仅在挂载时计算初始 state；后续不再因 URL 变化而重置（避免 setParams 写 URL 后回环）
  const initial = useMemo<T>(() => {
    const merged: Params = { ...defaults };
    searchParams.forEach((value, key) => {
      if (value === '') return;
      if (numberKeys.includes(key) && /^-?\d+$/.test(value)) {
        merged[key] = Number(value);
      } else {
        merged[key] = value;
      }
    });
    return merged as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [params, setParamsState] = useState<T>(initial);

  const setParams = useCallback(
    (next: T | ((prev: T) => T)) => {
      setParamsState((prev) => {
        const merged = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        const sp = new URLSearchParams();
        Object.entries(merged).forEach(([k, v]) => {
          if (v === undefined || v === null || v === '') return;
          sp.set(k, String(v));
        });
        setSearchParams(sp, { replace: true });
        return merged;
      });
    },
    [setSearchParams]
  );

  return [params, setParams] as const;
}
