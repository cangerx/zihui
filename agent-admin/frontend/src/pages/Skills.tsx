import { useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Input, Space, Switch, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { skillCatalogApi } from '../services/api';

const { Title, Text } = Typography;

type SkillRow = {
  skill_id: string;
  slug: string;
  name: string;
  description?: string;
  status: string;
  category: string;
  recommended: boolean;
  listed: boolean;
  latest_version?: string;
  latest_status?: string;
};

type SkillVersionRow = {
  version_id: string;
  version: string;
  status: string;
  sha256?: string;
  key_id?: string;
};

type SkillDetail = {
  skill?: SkillRow;
  versions?: SkillVersionRow[];
};

type SyncState = {
  cursor: number;
  last_error: string;
  last_success_at?: string | null;
};

export default function SkillsPage() {
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [sync, setSync] = useState<SyncState>({ cursor: 0, last_error: '', last_success_at: null });
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<SkillDetail | null>(null);

  const reload = async () => {
    setLoading(true);
    try {
      const res = await skillCatalogApi.list();
      setRows(res.data?.data || []);
      setSync(res.data?.sync || { cursor: 0, last_error: '', last_success_at: null });
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const patchSkill = async (skillId: string, data: Record<string, string | boolean>) => {
    try {
      await skillCatalogApi.update(skillId, data);
      await reload();
    } catch (e: any) {
      message.error(e.response?.data?.error || e.message || '保存失败');
    }
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Skills 管理</Title>
          <Text type="secondary">平台审核包的租户目录、分类推荐与同步记录。不在数字员工编辑器内管理。</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
          <Button
            type="primary"
            onClick={async () => {
              try {
                const res = await skillCatalogApi.sync();
                if (res.data?.ok) message.success(`已同步 ${res.data.applied} 条`);
                else message.warning(res.data?.error || '同步未完成');
                await reload();
              } catch (e: any) {
                message.error(e.response?.data?.error || '同步失败');
              }
            }}
          >
            立即同步
          </Button>
        </Space>
      </div>
      {rows.length === 0 && !loading ? (
        <Alert type="info" showIcon message="目录为空" description="尚未从授权端同步到已发布 Skill。配置 SKILL_REGISTRY_BASE_URL 后点击立即同步。" />
      ) : null}
      {sync.last_error ? <Alert type="error" showIcon message="上次同步失败" description={sync.last_error} /> : null}
      <Card size="small">
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="游标">{sync.cursor}</Descriptions.Item>
          <Descriptions.Item label="上次成功">{sync.last_success_at || '—'}</Descriptions.Item>
          <Descriptions.Item label="条数">{rows.length}</Descriptions.Item>
        </Descriptions>
      </Card>
      <Table
        rowKey="skill_id"
        loading={loading}
        dataSource={rows}
        pagination={false}
        columns={[
          { title: '名称', dataIndex: 'name' },
          { title: '简介', dataIndex: 'description', ellipsis: true, render: (v: string) => v || '—' },
          { title: 'slug', dataIndex: 'slug' },
          { title: '版本', dataIndex: 'latest_version' },
          { title: '版本状态', dataIndex: 'latest_status', render: (v) => <Tag>{v || '-'}</Tag> },
          {
            title: '分类',
            render: (_, row) => (
              <Input
                key={`${row.skill_id}:${row.category || ''}`}
                size="small"
                defaultValue={row.category}
                onBlur={(e) => {
                  const next = e.target.value;
                  if (next === (row.category || '')) return;
                  void patchSkill(row.skill_id, { category: next });
                }}
              />
            ),
          },
          {
            title: '推荐',
            render: (_, row) => (
              <Switch
                size="small"
                checked={row.recommended}
                onChange={(checked) => void patchSkill(row.skill_id, { recommended: checked })}
              />
            ),
          },
          {
            title: '全局上架',
            render: (_, row) => (
              <Switch
                size="small"
                checked={row.listed}
                onChange={(checked) => void patchSkill(row.skill_id, { listed: checked })}
              />
            ),
          },
          {
            title: '操作',
            render: (_, row) => (
              <Button
                size="small"
                onClick={async () => {
                  try {
                    const res = await skillCatalogApi.get(row.skill_id);
                    setDetail(res.data);
                  } catch (e: any) {
                    message.error(e.response?.data?.error || '加载版本失败');
                  }
                }}
              >
                版本
              </Button>
            ),
          },
        ]}
      />
      {detail ? (
        <Card size="small" title={`${detail.skill?.name || ''} 版本分发`} extra={<Button type="link" onClick={() => setDetail(null)}>关闭</Button>}>
          <Table
            rowKey="version_id"
            pagination={false}
            dataSource={detail.versions || []}
            columns={[
              { title: 'version', dataIndex: 'version' },
              { title: 'status', dataIndex: 'status', render: (v: string) => <Tag color={v === 'revoked' ? 'red' : 'green'}>{v}</Tag> },
              { title: 'sha256', dataIndex: 'sha256', ellipsis: true },
              { title: 'key', dataIndex: 'key_id' },
            ]}
          />
        </Card>
      ) : null}
    </Space>
  );
}
