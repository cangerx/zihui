import { useState } from 'react';
import { Card, Input, Button, Space, message, Tag, Empty, InputNumber, Tooltip } from 'antd';
import { SearchOutlined, ExperimentOutlined } from '@ant-design/icons';
import { docApi } from '../services/api';

/**
 * 检索调试页：admin 输入 query，看后端 retrieve 命中的 chunk 列表 + 距离 / 相似度。
 *
 * 用途：
 * - 验证 embedding 模型是否生效（命中相关文档 → 模型 OK）
 * - 调试 chunk_size / overlap / min_similarity 参数（命中数太少或太多时调整）
 * - 排查"问答说找不到信息"时实际命中的 chunk 是哪些，是否相关
 */

type Hit = {
  chunk_id: number;
  doc_id: number;
  doc_title: string;
  distance: number;
  similarity: number;
  chunk_text: string;
};

export default function DocRetrievePreview() {
  const [query, setQuery] = useState('');
  const [topK, setTopK] = useState<number>(8);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [latency, setLatency] = useState<number>(0);

  const handleSearch = async () => {
    const q = query.trim();
    if (!q) {
      message.warning('请输入测试问题');
      return;
    }
    setLoading(true);
    const start = Date.now();
    try {
      const res = await docApi.retrievePreview({ query: q, top_k: topK });
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
          输入用户可能提问的问题，立即看后端 RAG 检索的 chunk 命中情况（不调对话模型，仅 embedding + KNN）
        </div>
        <Space.Compact style={{ width: '100%' }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="例如：怎么开通 VIP？"
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
      </Card>

      {hits === null ? (
        <Empty description="尚未检索" />
      ) : hits.length === 0 ? (
        <Empty description="无命中（可能是 min_similarity 太高 / 模型未配置 / 文档未索引）" />
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
                    <span>《{h.doc_title}》</span>
                  </Space>
                }
                extra={
                  <Space>
                    <Tooltip title="cosine 相似度（越接近 1 越相关）">
                      <Tag color={h.similarity >= 0.7 ? 'success' : h.similarity >= 0.5 ? 'warning' : 'default'}>
                        sim {h.similarity.toFixed(4)}
                      </Tag>
                    </Tooltip>
                    <Tooltip title="向量距离（越小越相关）">
                      <Tag>dist {h.distance.toFixed(4)}</Tag>
                    </Tooltip>
                    <Tag>doc {h.doc_id} / chunk {h.chunk_id}</Tag>
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
