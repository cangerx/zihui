import { useEffect, useState } from 'react';
import { Card, Input, Button, Space, message, Tag, Empty, InputNumber, Tooltip, Select } from 'antd';
import { SearchOutlined, ExperimentOutlined } from '@ant-design/icons';
import { knowledgeBaseApi } from '../services/api';

/**
 * 知识库检索调试页：选定知识库 + 输入 query，查看 hybrid 检索命中的 chunk（向量 + 关键词 RRF）。
 *
 * 用途：验证 embedding 模型、调试 chunk/检索参数、排查"数字员工说找不到"时实际命中内容。
 */

type Hit = {
  chunk_id: number;
  kb_id: number;
  kb_name: string;
  document_id: number;
  doc_title: string;
  score: number;
  chunk_text: string;
};

type KbOption = { id: number; name: string };

export default function KnowledgeBaseRetrievePreview() {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState<number>(8);
  const [kbIds, setKbIds] = useState<number[]>([]);
  const [kbOptions, setKbOptions] = useState<KbOption[]>([]);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<number>(0);

  useEffect(() => {
    knowledgeBaseApi.options()
      .then((res) => setKbOptions(res.data.data || []))
      .catch(() => {});
  }, []);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      message.warning('请输入测试问题');
      return;
    }
    setLoading(true);
    const start = Date.now();
    try {
      const res = await knowledgeBaseApi.retrievePreview({
        query: q,
        top_k: topK,
        kb_ids: kbIds.length ? kbIds : undefined,
      });
      setHits(res.data.hits || []);
      setLatency(Date.now() - start);
    } catch (e: any) {
      message.error(e?.response?.data?.message || '检索失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8, color: '#666' }}>
          选择知识库（留空=全部 active 库）后输入问题，查看 hybrid 检索命中情况（向量 + 关键词 RRF，不调对话模型）
        </div>
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            placeholder="选择知识库（留空检索全部）"
            value={kbIds}
            onChange={setKbIds}
            optionFilterProp="label"
            options={kbOptions.map((kb) => ({ value: kb.id, label: kb.name }))}
          />
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onPressEnter={handleSearch}
              placeholder="例如：产品如何退款？"
              prefix={<SearchOutlined />}
              allowClear
            />
            <Tooltip title="检索 Top K">
              <InputNumber
                value={topK}
                onChange={(v) => setTopK(typeof v === 'number' ? v : 8)}
                min={1}
                max={20}
                style={{ width: 90 }}
              />
            </Tooltip>
            <Button type="primary" loading={loading} icon={<ExperimentOutlined />} onClick={handleSearch}>
              检索
            </Button>
          </Space.Compact>
        </Space>
      </Card>

      {hits === null ? (
        <Empty description="尚未检索" />
      ) : hits.length === 0 ? (
        <Empty description="无命中（可能是 min_similarity 太高 / 模型未配置 / 文档未索引 / Qdrant 不可用）" />
      ) : (
        <div>
          <div style={{ marginBottom: 12, color: '#666' }}>
            命中 <b>{hits.length}</b> 条 chunk，耗时 <b>{latency}</b>ms
          </div>
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {hits.map((h, i) => (
              <Card
                key={h.chunk_id}
                size="small"
                title={
                  <Space>
                    <Tag color="blue">#{i + 1}</Tag>
                    <Tag color="geekblue">{h.kb_name}</Tag>
                    <span>《{h.doc_title}》</span>
                  </Space>
                }
                extra={
                  <Space>
                    <Tooltip title="融合相关度（越接近 1 越相关）">
                      <Tag color={h.score >= 0.7 ? 'success' : h.score >= 0.5 ? 'warning' : 'default'}>
                        score {h.score.toFixed(4)}
                      </Tag>
                    </Tooltip>
                    <Tag>doc {h.document_id} / chunk {h.chunk_id}</Tag>
                  </Space>
                }
              >
                <pre style={{
                  fontFamily: 'inherit', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  margin: 0, fontSize: 13, color: '#333', maxHeight: 240, overflow: 'auto',
                }}>
                  {h.chunk_text}
                </pre>
              </Card>
            ))}
          </Space>
        </div>
      )}
    </div>
  );
}
