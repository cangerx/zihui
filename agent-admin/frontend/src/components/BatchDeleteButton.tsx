import { useState } from 'react';
import { Button, Modal, Popconfirm, message } from 'antd';

export interface BatchDeleteResult {
  deleted: number;
  archived?: number;
  errors: { id: number; error: string }[];
  total: number;
}

interface Props {
  selectedKeys: number[];
  onClear: () => void;
  batchDelete: (ids: number[]) => Promise<{ data: BatchDeleteResult }>;
  onDone: () => void;
  itemName?: string;
}

/**
 * 通用「批量删除」按钮。
 *
 * 后端约定返回结构：{ deleted, archived?, errors: [{id,error}], total }
 *   - 全部成功：message.success 绿色
 *   - 部分失败：Modal.warning 黄色弹窗 + 失败明细
 *   - 调用本身失败：message.error 红色
 *
 * 依赖 Popconfirm 二次确认，按钮在未选中时自动禁用。
 */
export default function BatchDeleteButton({
  selectedKeys, onClear, batchDelete, onDone, itemName = '记录',
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!selectedKeys.length) return;
    setLoading(true);
    try {
      const res = await batchDelete(selectedKeys);
      const { deleted = 0, archived = 0, errors = [], total = selectedKeys.length } = res.data || {};
      const summary: string[] = [];
      if (deleted) summary.push(`已删除 ${deleted} 条`);
      if (archived) summary.push(`归档 ${archived} 条`);
      if (errors.length) summary.push(`失败 ${errors.length} 条`);

      if (errors.length) {
        Modal.warning({
          title: `批量操作完成（共 ${total} 条）`,
          width: 520,
          content: (
            <div style={{ fontSize: 12 }}>
              <div>{summary.join('，')}</div>
              <div style={{ marginTop: 8 }}>
                失败明细：
                <ul style={{ paddingLeft: 20, margin: '4px 0', maxHeight: 200, overflowY: 'auto' }}>
                  {errors.map((e) => (
                    <li key={e.id}>ID {e.id}: {e.error}</li>
                  ))}
                </ul>
              </div>
            </div>
          ),
        });
      } else {
        message.success(summary.join('，') || '操作完成');
      }
      onClear();
      onDone();
    } catch (err: any) {
      message.error(err.response?.data?.error || '批量删除失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popconfirm
      title={`确认删除选中的 ${selectedKeys.length} 条${itemName}？`}
      disabled={!selectedKeys.length || loading}
      onConfirm={handleConfirm}
      okText="确认删除"
      cancelText="取消"
    >
      <Button danger disabled={!selectedKeys.length} loading={loading}>
        批量删除 ({selectedKeys.length})
      </Button>
    </Popconfirm>
  );
}
