import { Tag } from 'antd';
import { useCurrencyLabels } from '../contexts/CurrencyContext';

/**
 * 余额/计费类型标签。
 * - type='token'  -> 现金钱包，橙色，文案默认"金币"（管理员可自定义）
 * - type='credit' -> 积分钱包，紫色，文案默认"积分"（管理员可自定义）
 *
 * 替换原本散落在各页面的：
 *   <Tag color={v === 'token' ? 'orange' : 'purple'}>{v === 'token' ? '余额' : '积分'}</Tag>
 */
export default function CurrencyTag({ type }: { type: string | null | undefined }) {
  const { labels } = useCurrencyLabels();
  const isCredit = type === 'credit';
  return (
    <Tag color={isCredit ? 'purple' : 'orange'}>
      {isCredit ? labels.credit : labels.token}
    </Tag>
  );
}
