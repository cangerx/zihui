import { useEffect, useState } from 'react';
import { Table, Button, Space, Tag, message, Popconfirm, Typography, Card, Alert } from 'antd';
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { deckAssetApi } from '../services/api';

interface DeckAsset {
  id: number;
  kind: string;
  asset_key: string;
  platform: string;
  version: string;
  source_url: string;
  sha256: string;
  size: number;
  status: string;
  error: string;
  oem_project_key: string;
  created_at: string;
}

interface FfCheck {
  expected: number;
  ready: number;
  missing: { platform: string; asset_key: string }[];
}
interface TplCheck {
  manifest_ok: boolean;
  manifest_url: string;
  expected: number;
  ready: number;
  missing: { id: string; name: string }[];
}
interface CheckData {
  ffmpeg: FfCheck;
  template: TplCheck;
}

export default function DeckAssets() {
  const [data, setData] = useState<DeckAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [checkData, setCheckData] = useState<CheckData | null>(null);
  const [checking, setChecking] = useState(false);
  const [syncing, setSyncing] = useState<'ffmpeg' | 'template' | null>(null);
  const [syncMsg, setSyncMsg] = useState('');
  const [pulling, setPulling] = useState<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await deckAssetApi.list({ per_page: 200 });
      setData(r.data?.data ?? r.data ?? []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const runCheck = async () => {
    setChecking(true);
    try {
      const r = await deckAssetApi.check();
      setCheckData(r.data);
    } catch {
      message.error('完备性检查失败');
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    load();
    runCheck();
  }, []);

  // 循环分批拉取该类资源的缺失项, 直到 remaining=0 或某批无任何成功(剩下的拉不动)。
  const runSync = async (kind: 'ffmpeg' | 'template') => {
    setSyncing(kind);
    let total = 0;
    try {
      for (;;) {
        // ffmpeg 单文件较大(数十 MB), 小批量避免单请求超时; 模板小文件大批量。
        const limit = kind === 'ffmpeg' ? 2 : 12;
        const r = await deckAssetApi.sync({ kind, limit });
        const d = r.data ?? {};
        total += d.pulled ?? 0;
        setSyncMsg(`${kind === 'ffmpeg' ? 'ffmpeg' : '模板'} 已拉取 ${total} 项，剩余 ${d.remaining ?? 0}…`);
        await load();
        if ((d.remaining ?? 0) === 0) break;
        if ((d.pulled ?? 0) === 0) {
          message.warning(`剩余 ${d.remaining} 项拉取失败（母 CDN 对应文件可能未就位），已停止`);
          break;
        }
      }
      if (total > 0) message.success(`${kind === 'ffmpeg' ? 'ffmpeg' : '模板'} 拉取完成，共固化 ${total} 项`);
      else message.info('已是最新，无需拉取');
      await runCheck();
    } catch (e: any) {
      const d = e?.response?.data;
      if (d?.error === 'manifest_unreachable') {
        message.error(`母 CDN 模板清单未就位，请先上传到：${d.manifest_url}`);
      } else {
        message.error('拉取中断: ' + (d?.message ?? d?.error ?? e?.message ?? '请求错误'));
      }
    } finally {
      setSyncing(null);
      setSyncMsg('');
    }
  };

  const onPull = async (id: number) => {
    setPulling(id);
    try {
      await deckAssetApi.pull(id);
      message.success('已重新拉取并固化');
      load();
      runCheck();
    } catch (e: any) {
      message.error(e?.response?.data?.message ?? '拉取失败');
    } finally {
      setPulling(null);
    }
  };

  const onRemove = async (id: number) => {
    try {
      await deckAssetApi.remove(id);
      message.success('已删除');
      load();
      runCheck();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    { title: '类型', dataIndex: 'kind', render: (k: string) => <Tag color={k === 'ffmpeg' ? 'blue' : 'green'}>{k === 'ffmpeg' ? 'ffmpeg' : '模板'}</Tag> },
    { title: '资源键', dataIndex: 'asset_key' },
    { title: '平台', dataIndex: 'platform' },
    { title: '版本', dataIndex: 'version', render: (v: string) => v || '-' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (s: string, r: DeckAsset) => {
        const label = s === 'ready' ? '就绪' : s === 'pending' ? '待拉取' : s === 'failed' ? '失败' : s;
        return s === 'failed' && r.error ? (
          <Tag color="error" title={r.error}>{label}</Tag>
        ) : (
          <Tag color={s === 'ready' ? 'success' : 'default'}>{label}</Tag>
        );
      },
    },
    { title: '大小', dataIndex: 'size', render: (n: number) => (n ? (n / 1024 / 1024).toFixed(1) + ' MB' : '-') },
    {
      title: 'SHA256',
      dataIndex: 'sha256',
      render: (s: string) =>
        s ? (
          <Typography.Text code copyable={{ text: s }}>
            {s.slice(0, 10)}…
          </Typography.Text>
        ) : (
          '-'
        ),
    },
    {
      title: '操作',
      render: (_: unknown, r: DeckAsset) => (
        <Space>
          <Button size="small" icon={<CloudDownloadOutlined />} loading={pulling === r.id} onClick={() => onPull(r.id)}>
            重新拉取
          </Button>
          <Popconfirm title="删除该资产?" onConfirm={() => onRemove(r.id)}>
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const ff = checkData?.ffmpeg;
  const tpl = checkData?.template;

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} loading={checking} onClick={() => { runCheck(); load(); }}>
          重新检查
        </Button>
        {syncMsg && <Typography.Text type="secondary">{syncMsg}</Typography.Text>}
        <Typography.Text type="secondary">
          云控端自动比对母 CDN 应有资源与本站已固化资源，缺什么点「检查并拉取缺失」即可，无需手动登记。
        </Typography.Text>
      </Space>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <Card size="small" title="ffmpeg 二进制（解说视频导出依赖）" style={{ flex: 1, minWidth: 340 }}>
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            {ff ? (
              <>
                <Typography.Text strong>
                  {ff.ready}/{ff.expected}
                </Typography.Text>{' '}
                就绪{' '}
                {ff.missing.length === 0 ? <Tag color="success">完备</Tag> : <Tag color="warning">缺 {ff.missing.length} 项</Tag>}
              </>
            ) : (
              '检查中…'
            )}
          </Typography.Paragraph>
          {ff && ff.missing.length > 0 && (
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 8 }}>
              缺失：{ff.missing.map((m) => `${m.platform}/${m.asset_key}`).join('、')}
            </Typography.Paragraph>
          )}
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={syncing === 'ffmpeg'}
            disabled={syncing !== null}
            onClick={() => runSync('ffmpeg')}
          >
            检查并拉取缺失
          </Button>
        </Card>

        <Card size="small" title="模板包（AI PPT 受控模板）" style={{ flex: 1, minWidth: 340 }}>
          {tpl && tpl.manifest_ok === false ? (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message="模板资源尚未就绪"
              description="请联系服务商开通 / 配置 AI PPT 模板资源后再拉取。"
            />
          ) : (
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              {tpl ? (
                <>
                  母 CDN 共 <Typography.Text strong>{tpl.expected}</Typography.Text> 套，已就绪{' '}
                  <Typography.Text strong>{tpl.ready}</Typography.Text>{' '}
                  {tpl.missing.length === 0 ? <Tag color="success">完备</Tag> : <Tag color="warning">缺 {tpl.missing.length} 套</Tag>}
                </>
              ) : (
                '检查中…'
              )}
            </Typography.Paragraph>
          )}
          <Button
            type="primary"
            icon={<CloudDownloadOutlined />}
            loading={syncing === 'template'}
            disabled={syncing !== null || tpl?.manifest_ok === false}
            onClick={() => runSync('template')}
          >
            检查并拉取缺失
          </Button>
        </Card>
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />
    </div>
  );
}
