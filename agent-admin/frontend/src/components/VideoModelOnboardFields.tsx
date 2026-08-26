import { useEffect, useMemo, useState } from 'react';
import { Form, Input, InputNumber, Select } from 'antd';
import type { FormInstance } from 'antd/es/form';
import OfficialRefPanel from './OfficialRefPanel';
import { videoApi } from '../services/api';

const HAND_FILL = '__hand_fill__';

type Props = {
  form: FormInstance;
  creating: boolean;
  creditLabel: string;
  existingModels: any[];
};

export default function VideoModelOnboardFields({ form, creating, creditLabel, existingModels }: Props) {
  const providerKey = Form.useWatch('provider_key', form) as string | undefined;
  const modelId = Form.useWatch('model_id', form) as string | undefined;
  const [fetched, setFetched] = useState<Array<{ id: string; name?: string }>>([]);
  const [handFill, setHandFill] = useState(false);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!creating) return;
    const key = (providerKey || '').trim();
    if (!key) {
      setFetched([]);
      return;
    }
    let cancelled = false;
    setFetching(true);
    videoApi.accounts({ per_page: 200 })
      .then(async (res) => {
        const list = res.data?.data || res.data || [];
        const account = (Array.isArray(list) ? list : []).find((item: any) => item.provider_key === key && item.supports_model_fetch);
        if (!account) {
          if (!cancelled) setFetched([]);
          return;
        }
        try {
          const modelsRes = await videoApi.fetchProviderModels(account.id);
          if (!cancelled) setFetched(modelsRes.data.models || []);
        } catch {
          if (!cancelled) setFetched([]);
        }
      })
      .catch(() => { if (!cancelled) setFetched([]); })
      .finally(() => { if (!cancelled) setFetching(false); });
    return () => { cancelled = true; };
  }, [creating, providerKey]);

  const options = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of fetched) {
      const id = String(item.id || '').trim();
      if (id) map.set(id, item.name || id);
    }
    for (const model of existingModels) {
      if (providerKey && model.provider_key !== providerKey) continue;
      const id = String(model.model_id || '').trim();
      if (id && !map.has(id)) map.set(id, model.display_name || id);
    }
    const list = Array.from(map.entries()).map(([id, name]) => ({
      value: id,
      label: name && name !== id ? `${name}（${id}）` : id,
    }));
    list.push({ value: HAND_FILL, label: '列表没有，手填' });
    return list;
  }, [fetched, existingModels, providerKey]);

  if (!creating) {
    return (
      <>
        <Form.Item name="model_id" label="模型 ID" rules={[{ required: true, message: '请填写模型 ID' }]}>
          <Input disabled />
        </Form.Item>
        <OfficialRefPanel modelId={modelId} modality="video" />
      </>
    );
  }

  return (
    <>
      <Form.Item label="模型 ID" required tooltip="优先从上游拉取或已有模型中选择，没有再手填">
        <Select
          showSearch
          optionFilterProp="label"
          placeholder={fetching ? '正在拉取上游模型…' : '搜索或选择模型 ID'}
          options={options}
          value={handFill ? HAND_FILL : (modelId || undefined)}
          onChange={(value) => {
            if (value === HAND_FILL) {
              setHandFill(true);
              form.setFieldValue('model_id', '');
              return;
            }
            setHandFill(false);
            form.setFieldValue('model_id', value);
            if (!form.getFieldValue('display_name')) {
              const hit = fetched.find((item) => item.id === value);
              form.setFieldValue('display_name', hit?.name || value);
            }
          }}
        />
      </Form.Item>
      <Form.Item name="model_id" hidden rules={[{ required: true, message: '请填写模型 ID' }]}>
        <Input />
      </Form.Item>
      {handFill && (
        <Form.Item label="手填模型 ID" required>
          <Input
            placeholder="如 doubao-seedance-2-0-260128"
            value={modelId}
            onChange={(event) => form.setFieldValue('model_id', event.target.value)}
          />
        </Form.Item>
      )}
      <OfficialRefPanel modelId={modelId} modality="video" />
      <Form.Item
        name="default_credit_cost"
        label={`本站售价（${creditLabel}）`}
        tooltip="对照上方官方参考后自行填写。留空=待定价；不会把官方人民币回填为售价。"
      >
        <InputNumber min={0} precision={4} placeholder="留空为待定价，勿套用官方参考金额" style={{ width: '100%' }} />
      </Form.Item>
    </>
  );
}
