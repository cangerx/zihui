import { useEffect, useState } from 'react';
import { Alert, Typography } from 'antd';
import { officialModelRefApi, type OfficialRefLookup } from '../services/api';

const UNIT_LABELS: Record<string, string> = {
  per_million_tokens: '每百万 Token',
  per_million_input: '每百万输入 Token',
  per_million_output: '每百万输出 Token',
  per_call: '每次调用',
  per_second: '每秒',
  per_sku: '按档/套餐',
};

const cache = new Map<string, OfficialRefLookup>();
const inflight = new Map<string, Promise<OfficialRefLookup>>();

function cacheKey(modelId: string, modality: string) {
  return `${modality}::${modelId.trim().toLowerCase()}`;
}

function lookupOfficialRef(modelId: string, modality: string): Promise<OfficialRefLookup> {
  const key = cacheKey(modelId, modality);
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(key);
  if (pending) return pending;
  const request = officialModelRefApi.lookup(modelId, modality)
    .then((res) => {
      const data = res.data as OfficialRefLookup;
      cache.set(key, data);
      return data;
    })
    .catch(() => {
      const miss: OfficialRefLookup = { found: false };
      cache.set(key, miss);
      return miss;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

export function OfficialRefText({ modelId, modality, compact = false }: { modelId?: string; modality: string; compact?: boolean }) {
  const [ref, setRef] = useState<OfficialRefLookup | null>(null);
  const [loading, setLoading] = useState(false);
  const id = (modelId || '').trim();

  useEffect(() => {
    if (!id) {
      setRef(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    lookupOfficialRef(id, modality)
      .then((data) => { if (!cancelled) setRef(data); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, modality]);

  if (!id) return null;
  if (loading) return <Typography.Text type="secondary">查询官方参考…</Typography.Text>;
  if (!ref?.found) {
    return compact
      ? <Typography.Text type="secondary">未收录官方参考</Typography.Text>
      : <Alert type="warning" showIcon message="未收录官方参考" />;
  }

  const unit = UNIT_LABELS[ref.unit || ''] || ref.unit || '';
  const amount = ref.amount_cny != null ? `${ref.amount_cny} 元` : '金额未收录';
  const meta = [amount, unit, ref.captured_at ? `摘录 ${ref.captured_at}` : ''].filter(Boolean).join(' · ');
  const link = ref.source_url
    ? <Typography.Link href={ref.source_url} target="_blank" rel="noreferrer">官方价目</Typography.Link>
    : null;

  if (compact) {
    return <Typography.Text>{meta}{link ? <> · {link}</> : null}</Typography.Text>;
  }

  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="官方参考成本（人民币）"
      description={
        <div>
          <div>{meta}</div>
          {ref.text ? <Typography.Paragraph style={{ margin: '8px 0 4px' }}>{ref.text}</Typography.Paragraph> : null}
          {link}
        </div>
      }
    />
  );
}

export default function OfficialRefPanel({ modelId, modality }: { modelId?: string; modality: string }) {
  return <OfficialRefText modelId={modelId} modality={modality} />;
}
