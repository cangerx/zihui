"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Settings,
  User,
  CreditCard,
  History,
  Mail,
  Phone,
  Crown,
  Coins,
  LogOut,
  BarChart3,
  MessageCircle,
  ImageIcon,
  Zap,
  Building2,
  Users,
  Globe,
  Palette,
  Package,
  Wallet,
  ArrowRight,
  Camera,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { userAPI, orderAPI, agentAPI, uploadAPI } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageContainer, PageHeader, PageContent } from "@/components/ui/page-shell";
import { useLoginModalStore } from "@/store/login-modal";
import { featureFlags } from "@/lib/features";

interface CreditLog {
  id: number;
  type: string;
  amount: number;
  balance: number;
  model: string;
  detail: string;
  created_at: string;
}

interface UsageStats {
  balance: number;
  total_recharged: number;
  total_consumed: number;
  today_consumed: number;
  conversations: number;
  messages: number;
  generations: number;
  model_stats: { model: string; total: number; count: number }[];
}

const TABS = [
  "账号设置",
  "使用统计",
  "安全设置",
  "消费记录",
  "订单记录",
  ...(featureFlags.agency ? ["代理商"] : []),
] as const;
const TAB_ICONS = [User, BarChart3, Settings, History, CreditCard, Building2];

export default function SettingsPage() {
  const { user, credits, logout, isLoading, fetchProfile } = useAuthStore();
  const { toast } = useToast();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(0);
  const [creditLogs, setCreditLogs] = useState<CreditLog[]>([]);
  const [creditLogsPage, setCreditLogsPage] = useState(1);
  const [creditLogsTotal, setCreditLogsTotal] = useState(0);
  const [creditLogsLoading, setCreditLogsLoading] = useState(false);
  const CREDIT_LOGS_PAGE_SIZE = 20;
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [usageStats, setUsageStats] = useState<UsageStats | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    if (user) setNickname(user.nickname || "");
  }, [user]);

  useEffect(() => {
    if (activeTab === 1) loadUsageStats();
    if (activeTab === 3) loadCreditLogs(creditLogsPage);
    if (activeTab === 4) loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, creditLogsPage]);

  const loadCreditLogs = async (page: number = 1) => {
    setCreditLogsLoading(true);
    try {
      const res = await userAPI.getCreditLogs({ page, page_size: CREDIT_LOGS_PAGE_SIZE });
      setCreditLogs(res.data.data || []);
      setCreditLogsTotal(res.data.total || 0);
    } catch {
      // handle error
    } finally {
      setCreditLogsLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!nickname.trim()) return;
    setSaving(true);
    try {
      await userAPI.updateProfile({ nickname: nickname.trim() });
      toast("保存成功", "success");
      fetchProfile();
    } catch {
      toast("保存失败", "error");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd || newPwd.length < 6) {
      toast("新密码至少6位", "error");
      return;
    }
    setPwdSaving(true);
    try {
      await userAPI.changePassword({ old_password: oldPwd, new_password: newPwd });
      toast("密码修改成功", "success");
      setOldPwd(""); setNewPwd("");
    } catch (e: any) {
      toast(e.response?.data?.error || "修改失败", "error");
    } finally {
      setPwdSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const uploadRes = await uploadAPI.upload(file);
      const url = uploadRes.data?.data?.url || uploadRes.data?.url;
      if (url) {
        await userAPI.updateProfile({ avatar: url });
        await fetchProfile();
        toast("头像更新成功", "success");
      }
    } catch {
      toast("上传失败", "error");
    } finally {
      setAvatarUploading(false);
      e.target.value = "";
    }
  };

  const handleDeleteAccount = async () => {
    try {
      await userAPI.deleteAccount();
      toast("账号已注销", "success");
      setShowDeleteConfirm(false);
      logout();
    } catch (err: any) {
      toast(err.response?.data?.error || "注销失败", "error");
    }
  };

  const loadUsageStats = async () => {
    try {
      const res = await userAPI.getUsageStats();
      setUsageStats(res.data);
    } catch { /* handle error */ }
  };

  const loadOrders = async () => {
    try {
      const res = await orderAPI.list();
      setOrders(res.data.data || []);
    } catch { /* handle error */ }
  };

  const [agentData, setAgentData] = useState<any>(null);
  const [agentStatus, setAgentStatus] = useState<'loading' | 'agent' | 'not_agent' | 'error'>('loading');
  const [threshold, setThreshold] = useState<any>(null);
  const [applyForm, setApplyForm] = useState({ site_name: '', code: '' });
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (featureFlags.agency && activeTab === 5) loadAgentData();
  }, [activeTab]);

  const loadAgentData = async () => {
    setAgentStatus('loading');
    try {
      const res = await agentAPI.stats();
      setAgentData(res.data);
      setAgentStatus('agent');
    } catch (err: any) {
      if (err.response?.status === 403) {
        setAgentStatus('not_agent');
        try {
          const t = await agentAPI.threshold();
          setThreshold(t.data);
        } catch { /* ignore */ }
      } else {
        setAgentStatus('error');
      }
    }
  };

  const handleApply = async () => {
    if (!applyForm.code || !applyForm.site_name) { toast('请填写所有字段', 'error'); return; }
    if (!/^[a-z0-9-]{3,30}$/.test(applyForm.code)) { toast('编码只能包含小写字母、数字和横线', 'error'); return; }
    setApplying(true);
    try {
      await agentAPI.apply(applyForm);
      toast('申请已提交，审核通过后自动开通', 'success');
      loadAgentData();
    } catch (e: any) { toast(e.response?.data?.error || '申请失败', 'error'); }
    finally { setApplying(false); }
  };

  if (isLoading) {
    return (
      <PageContainer>
        <PageHeader title="个人中心" icon={<Settings size={16} className="text-neutral-400" />} />
        <PageContent>
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="h-24 rounded-2xl bg-neutral-100 animate-pulse" />
            <div className="h-10 w-48 rounded-xl bg-neutral-100 animate-pulse" />
            <div className="h-64 rounded-2xl bg-neutral-100 animate-pulse" />
          </div>
        </PageContent>
      </PageContainer>
    );
  }

  if (!user) {
    return (
      <PageContainer>
        <PageHeader title="个人中心" icon={<Settings size={16} className="text-neutral-400" />} />
        <PageContent>
          <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-12 text-center shadow-sm">
            <div className="w-14 h-14 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center mx-auto mb-4">
              <User size={24} className="text-neutral-400" />
            </div>
            <p className="text-neutral-500 text-sm mb-4">请先登录</p>
            <button
              onClick={() => useLoginModalStore.getState().openLoginModal()}
              className="px-6 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-md"
            >
              去登录
            </button>
          </div>
        </PageContent>
      </PageContainer>
    );
  }

  return (
    <>
    <PageContainer>
      <PageHeader title="个人中心" icon={<Settings size={16} className="text-neutral-400" />} />
      <PageContent>
        <div className="max-w-3xl mx-auto">

      {/* User card */}
      <div className="bg-white/80 rounded-2xl border border-neutral-200/60 mb-6 shadow-sm overflow-hidden">
        <div className="h-16 bg-neutral-100 dark:bg-neutral-800" />
        <div className="px-6 pb-6 -mt-8">
          <div className="flex items-end justify-between">
            <div className="flex items-end gap-4">
              <div className="relative group">
                <div className="w-16 h-16 rounded-full bg-white p-0.5 shadow-md ring-2 ring-white">
                  <div className="w-full h-full rounded-full bg-neutral-100 flex items-center justify-center overflow-hidden">
                    {user.avatar ? (
                      <img src={user.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                    ) : (
                      <User size={24} className="text-neutral-400" />
                    )}
                  </div>
                </div>
                <label className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center cursor-pointer transition-opacity">
                  {avatarUploading ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Camera size={16} className="text-white" />
                  )}
                  <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} disabled={avatarUploading} />
                </label>
              </div>
              <div className="pb-1">
                <h2 className="text-base font-semibold text-neutral-900">{user.nickname}</h2>
                <div className="flex items-center gap-3 mt-1 text-xs text-neutral-400">
                  {user.email && (
                    <span className="flex items-center gap-1">
                      <Mail size={12} /> {user.email}
                    </span>
                  )}
                  {user.phone && !user.phone.startsWith("u_") && (
                    <span className="flex items-center gap-1">
                      <Phone size={12} /> {user.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3 pb-1">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                <Crown size={12} />
                VIP {user.vip_level || 0}
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-100 text-neutral-600 text-xs font-medium">
                <Coins size={12} />
                {credits?.balance?.toFixed(0) || 0} 积分
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-neutral-100">
        {TABS.map((label, i) => {
          const Icon = TAB_ICONS[i];
          return (
            <button
              key={label}
              onClick={() => setActiveTab(i)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors",
                activeTab === i
                  ? "border-neutral-900 text-neutral-900 font-medium"
                  : "border-transparent text-neutral-500 hover:text-neutral-700"
              )}
            >
              <Icon size={16} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 0 && (
        <div className="bg-white/80 rounded-2xl border border-neutral-200/60 divide-y divide-neutral-100 shadow-sm">
          <div className="p-5">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">昵称</label>
            <div className="flex gap-3">
              <input
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="flex-1 px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 focus:bg-white focus:shadow-sm transition-all"
              />
              <button
                onClick={handleSaveProfile}
                disabled={saving}
                className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors shadow-md"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
          <div className="p-5">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">邮箱</label>
            <p className="text-sm text-neutral-500">{user.email || "未绑定"}</p>
          </div>
          <div className="p-5">
            <label className="block text-sm font-medium text-neutral-700 mb-1.5">手机号</label>
            <p className="text-sm text-neutral-500">{user.phone || "未绑定"}</p>
          </div>
          <div className="p-5">
            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 transition-colors"
            >
              <LogOut size={16} />
              退出登录
            </button>
          </div>
        </div>
      )}

      {activeTab === 1 && usageStats && (
        <div className="space-y-4">
          {/* Stats overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-blue-50">
                  <Coins size={14} className="text-blue-500" />
                </div>
                <span className="text-xs text-neutral-400">当前余额</span>
              </div>
              <p className="text-xl font-bold text-neutral-900">{usageStats.balance.toFixed(1)}</p>
            </div>
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-red-50">
                  <Zap size={14} className="text-red-500" />
                </div>
                <span className="text-xs text-neutral-400">今日消耗</span>
              </div>
              <p className="text-xl font-bold text-neutral-900">{usageStats.today_consumed.toFixed(1)}</p>
            </div>
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-amber-50">
                  <Zap size={14} className="text-amber-500" />
                </div>
                <span className="text-xs text-neutral-400">累计消耗</span>
              </div>
              <p className="text-xl font-bold text-neutral-900">{usageStats.total_consumed.toFixed(1)}</p>
            </div>
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <div className="p-1.5 rounded-lg bg-green-50">
                  <Coins size={14} className="text-green-500" />
                </div>
                <span className="text-xs text-neutral-400">累计充值</span>
              </div>
              <p className="text-xl font-bold text-neutral-900">{usageStats.total_recharged.toFixed(1)}</p>
            </div>
          </div>

          {/* Usage counts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm text-center">
              <MessageCircle size={20} className="mx-auto text-neutral-400 mb-1.5" />
              <p className="text-2xl font-bold text-neutral-900">{usageStats.conversations}</p>
              <p className="text-xs text-neutral-400 mt-0.5">对话数</p>
            </div>
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm text-center">
              <MessageCircle size={20} className="mx-auto text-neutral-400 mb-1.5" />
              <p className="text-2xl font-bold text-neutral-900">{usageStats.messages}</p>
              <p className="text-xs text-neutral-400 mt-0.5">消息数</p>
            </div>
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm text-center">
              <ImageIcon size={20} className="mx-auto text-neutral-400 mb-1.5" />
              <p className="text-2xl font-bold text-neutral-900">{usageStats.generations}</p>
              <p className="text-xs text-neutral-400 mt-0.5">图片生成</p>
            </div>
          </div>

          {/* Per-model breakdown */}
          {usageStats.model_stats && usageStats.model_stats.length > 0 && (
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 shadow-sm">
              <div className="px-5 py-3 border-b border-neutral-100">
                <h3 className="text-sm font-medium text-neutral-700">模型消耗排行</h3>
              </div>
              <div className="divide-y divide-neutral-100">
                {usageStats.model_stats.map((ms, i) => {
                  const maxTotal = usageStats.model_stats[0]?.total || 1;
                  const pct = Math.round((ms.total / maxTotal) * 100);
                  return (
                    <div key={ms.model} className="px-5 py-3">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-sm text-neutral-700 font-medium">{ms.model}</span>
                        <div className="flex items-center gap-3 text-xs text-neutral-400">
                          <span>{ms.count} 次</span>
                          <span className="font-medium text-neutral-600">{ms.total.toFixed(1)} 积分</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-neutral-800 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 3 && (
        <div className="bg-white/80 rounded-2xl border border-neutral-200/60 shadow-sm">
          {creditLogsLoading && creditLogs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-neutral-400 text-sm">加载中...</p>
            </div>
          ) : creditLogs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-neutral-400 text-sm">暂无消费记录</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 text-neutral-400 text-xs">
                    <th className="text-left px-5 py-3 font-medium">时间</th>
                    <th className="text-left px-5 py-3 font-medium">类型</th>
                    <th className="text-left px-5 py-3 font-medium">模型</th>
                    <th className="text-right px-5 py-3 font-medium">积分变动</th>
                    <th className="text-right px-5 py-3 font-medium">余额</th>
                  </tr>
                </thead>
                <tbody>
                  {creditLogs.map((log) => (
                    <tr key={log.id} className="border-b border-neutral-100 last:border-0">
                      <td className="px-5 py-3 text-neutral-500">
                        {new Date(log.created_at).toLocaleString("zh-CN")}
                      </td>
                      <td className="px-5 py-3">{log.detail || log.type}</td>
                      <td className="px-5 py-3 text-neutral-400">{log.model || "-"}</td>
                      <td className={cn("px-5 py-3 text-right font-medium", log.amount >= 0 ? "text-green-600" : "text-red-500")}>
                        {log.amount >= 0 ? "+" : ""}{log.amount.toFixed(1)}
                      </td>
                      <td className="px-5 py-3 text-right text-neutral-500">{log.balance.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {creditLogsTotal > CREDIT_LOGS_PAGE_SIZE && (
                <div className="flex items-center justify-between px-5 py-3 border-t border-neutral-100">
                  <div className="text-xs text-neutral-400">
                    共 {creditLogsTotal} 条，第 {creditLogsPage} / {Math.max(1, Math.ceil(creditLogsTotal / CREDIT_LOGS_PAGE_SIZE))} 页
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCreditLogsPage((p) => Math.max(1, p - 1))}
                      disabled={creditLogsPage <= 1 || creditLogsLoading}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      上一页
                    </button>
                    <button
                      onClick={() => setCreditLogsPage((p) => p + 1)}
                      disabled={creditLogsPage >= Math.ceil(creditLogsTotal / CREDIT_LOGS_PAGE_SIZE) || creditLogsLoading}
                      className="px-3 py-1.5 rounded-lg border border-neutral-200 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      下一页
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 2 && (
        <div className="bg-white/80 rounded-2xl border border-neutral-200/60 divide-y divide-neutral-100 shadow-sm">
          <div className="p-5">
            <label className="block text-sm font-medium text-neutral-700 mb-3">修改密码</label>
            <div className="space-y-3 max-w-md">
              <input
                type="password"
                value={oldPwd}
                onChange={(e) => setOldPwd(e.target.value)}
                placeholder="当前密码"
                className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 transition-all"
              />
              <input
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder="新密码（至少6位）"
                className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 transition-all"
              />
              <button
                onClick={handleChangePassword}
                disabled={pwdSaving}
                className="px-4 py-2 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors shadow-md"
              >
                {pwdSaving ? "保存中..." : "修改密码"}
              </button>
            </div>
          </div>
          <div className="p-5">
            <label className="block text-sm font-medium text-red-600 mb-2">危险操作</label>
            <p className="text-xs text-neutral-400 mb-3">注销账号后，所有数据将被清除且无法恢复。</p>
            {showDeleteConfirm ? (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-red-50 border border-red-100">
                <AlertTriangle size={20} className="text-red-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-red-700">确定要注销账号吗？此操作不可撤销。</p>
                </div>
                <button onClick={handleDeleteAccount} className="px-4 py-1.5 rounded-lg bg-red-600 text-white text-xs font-medium hover:bg-red-700 transition-colors">
                  确认注销
                </button>
                <button onClick={() => setShowDeleteConfirm(false)} className="px-4 py-1.5 rounded-lg bg-neutral-200 text-neutral-700 text-xs font-medium hover:bg-neutral-300 transition-colors">
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors"
              >
                <Trash2 size={14} /> 注销账号
              </button>
            )}
          </div>
        </div>
      )}

      {featureFlags.agency && activeTab === 5 && (
        <div className="space-y-4">
          {agentStatus === 'loading' && (
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-12 text-center shadow-sm">
              <div className="text-neutral-400 text-sm">加载中...</div>
            </div>
          )}
          {agentStatus === 'not_agent' && (
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 shadow-sm overflow-hidden">
              <div className="p-8 text-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center mx-auto mb-4">
                  <Building2 size={24} className="text-indigo-500" />
                </div>
                <h3 className="text-lg font-semibold text-neutral-900 mb-1">成为代理商</h3>
                <p className="text-sm text-neutral-500 mb-2">拥有专属品牌分站，赚取佣金收益</p>

                {/* Threshold info */}
                {threshold && threshold.type !== 'none' && (
                  <div className={cn(
                    "inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm mb-5",
                    threshold.qualified ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
                  )}>
                    {threshold.type === 'recharge' && (
                      threshold.qualified
                        ? <span>✓ 已满足充值门槛（累计 ¥{threshold.current?.toFixed(0)}）</span>
                        : <span>需累计充值 ≥ ¥{threshold.required?.toFixed(0)}，当前 ¥{threshold.current?.toFixed(0)}，还差 ¥{threshold.gap?.toFixed(0)}</span>
                    )}
                    {threshold.type === 'package' && (
                      threshold.qualified
                        ? <span>✓ 已购买「{threshold.package_name}」套餐</span>
                        : <span>需先购买「{threshold.package_name}」套餐（¥{threshold.package_price}）</span>
                    )}
                  </div>
                )}

                {/* Not qualified: guide to recharge/buy */}
                {threshold && !threshold.qualified && (
                  <div className="mb-4">
                    <Link
                      href="/pricing"
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 transition-colors shadow-md"
                    >
                      {threshold.type === 'recharge' ? '去充值' : '去购买套餐'}
                      <ArrowRight size={14} />
                    </Link>
                  </div>
                )}

                {/* Qualified or no threshold: show apply form */}
                {(!threshold || threshold.qualified) && (
                  <div className="max-w-sm mx-auto space-y-3 mt-4">
                    <input
                      value={applyForm.site_name}
                      onChange={(e) => setApplyForm({ ...applyForm, site_name: e.target.value })}
                      placeholder="站点名称（您的品牌名）"
                      className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 transition-all"
                    />
                    <div>
                      <input
                        value={applyForm.code}
                        onChange={(e) => setApplyForm({ ...applyForm, code: e.target.value.toLowerCase() })}
                        placeholder="分站编码（如: myshop）"
                        className="w-full px-3 py-2 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 transition-all"
                      />
                      <p className="text-[11px] text-neutral-400 mt-1 ml-1">将作为分站标识：{applyForm.code || 'xxx'}</p>
                    </div>
                    <button
                      onClick={handleApply}
                      disabled={applying}
                      className="w-full px-4 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors shadow-md"
                    >
                      {applying ? '提交中...' : '申请成为代理商'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {agentStatus === 'error' && (
            <div className="bg-white/80 rounded-2xl border border-neutral-200/60 p-12 text-center shadow-sm">
              <p className="text-red-400 text-sm">加载失败</p>
              <button onClick={loadAgentData} className="mt-3 text-sm text-neutral-500 hover:text-neutral-700">重试</button>
            </div>
          )}
          {agentStatus === 'agent' && agentData && (() => {
            const agent = agentData.agent;
            return (
              <>
                {/* Agent stats */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: '分站用户', value: agentData.user_count ?? 0, icon: Users, color: 'blue' },
                    { label: '总收入', value: `¥${(agentData.total_revenue ?? 0).toFixed(2)}`, icon: Coins, color: 'green' },
                    { label: '累计佣金', value: `¥${(agentData.total_commission ?? 0).toFixed(2)}`, icon: Wallet, color: 'amber' },
                    { label: '待结算', value: `¥${(agentData.pending_commission ?? 0).toFixed(2)}`, icon: Zap, color: 'orange' },
                  ].map((s) => (
                    <div key={s.label} className="bg-white/80 rounded-2xl border border-neutral-200/60 p-4 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`p-1.5 rounded-lg bg-${s.color}-50`}>
                          <s.icon size={14} className={`text-${s.color}-500`} />
                        </div>
                        <span className="text-xs text-neutral-400">{s.label}</span>
                      </div>
                      <p className="text-xl font-bold text-neutral-900">{s.value}</p>
                    </div>
                  ))}
                </div>

                {/* Agent info */}
                <div className="bg-white/80 rounded-2xl border border-neutral-200/60 shadow-sm">
                  <div className="px-5 py-3 border-b border-neutral-100 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-neutral-700">基本信息</h3>
                    <span className={cn('px-2 py-0.5 rounded-lg text-xs',
                      agent?.status === 'active' ? 'bg-green-50 text-green-600' :
                      agent?.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                      'bg-neutral-100 text-neutral-500'
                    )}>
                      {({ active: '正常', pending: '待审核', suspended: '已停用', expired: '已过期' } as any)[agent?.status] || agent?.status}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm">
                    <div><span className="text-neutral-400">编码</span><span className="ml-2 font-mono font-medium">{agent?.code}</span></div>
                    <div><span className="text-neutral-400">站点名称</span><span className="ml-2 font-medium">{agent?.site_name || '-'}</span></div>
                    <div><span className="text-neutral-400">子域名</span><span className="ml-2 font-mono text-xs">{agent?.subdomain}</span></div>
                    <div><span className="text-neutral-400">自定义域名</span><span className="ml-2">{agent?.custom_domain || '未绑定'}</span></div>
                    <div><span className="text-neutral-400">定价模式</span><span className="ml-2">{agent?.pricing_mode === 'custom' ? '自定义定价' : '佣金分成'}</span></div>
                    <div><span className="text-neutral-400">佣金比例</span><span className="ml-2 font-semibold">{((agent?.commission_rate ?? 0) * 100).toFixed(0)}%</span></div>
                  </div>
                </div>

                {/* Quick links */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { href: '/agent/brand', label: '品牌设置', icon: Palette },
                    { href: '/agent/domain', label: '域名管理', icon: Globe },
                    { href: '/agent/packages', label: '套餐定价', icon: Package },
                    { href: '/agent/users', label: '用户管理', icon: Users },
                    { href: '/agent/withdraw', label: '佣金提现', icon: Wallet },
                  ].map((link) => (
                    <Link key={link.href} href={link.href}
                      className="flex items-center gap-2 justify-center rounded-xl border border-neutral-200/60 bg-white/80 px-3 py-3 text-sm font-medium text-neutral-600 hover:border-neutral-300 hover:text-neutral-900 hover:shadow-sm transition-all"
                    >
                      <link.icon size={15} />
                      {link.label}
                    </Link>
                  ))}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {activeTab === 4 && (
        <div className="bg-white/80 rounded-2xl border border-neutral-200/60 shadow-sm">
          {orders.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-neutral-400 text-sm">暂无订单记录</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-100 text-neutral-400 text-xs">
                  <th className="text-left px-5 py-3 font-medium">订单号</th>
                  <th className="text-left px-5 py-3 font-medium">类型</th>
                  <th className="text-right px-5 py-3 font-medium">金额</th>
                  <th className="text-right px-5 py-3 font-medium">积分</th>
                  <th className="text-center px-5 py-3 font-medium">状态</th>
                  <th className="text-left px-5 py-3 font-medium">时间</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o: any) => (
                  <tr key={o.id} className="border-b border-neutral-100 last:border-0">
                    <td className="px-5 py-3 text-neutral-500 font-mono text-xs">{o.order_no}</td>
                    <td className="px-5 py-3">{o.type === 'subscribe' ? '订阅' : '充值'}</td>
                    <td className="px-5 py-3 text-right">¥{o.amount}</td>
                    <td className="px-5 py-3 text-right">{o.credits}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={cn("px-2 py-0.5 rounded-lg text-xs",
                        o.status === 'paid' ? 'bg-green-50 text-green-600' :
                        o.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                        'bg-neutral-100 text-neutral-500'
                      )}>{({pending:'待支付',paid:'已支付',refunded:'已退款',expired:'已过期'} as any)[o.status] || o.status}</span>
                    </td>
                    <td className="px-5 py-3 text-neutral-500">{new Date(o.created_at).toLocaleString('zh-CN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
        </div>
      </PageContent>
    </PageContainer>

    {/* Logout Confirmation Modal */}
    <AnimatePresence>
      {showLogoutConfirm && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowLogoutConfirm(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            transition={{ type: "spring", stiffness: 400, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-[340px] bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl border border-neutral-200/50 dark:border-neutral-800/50 overflow-hidden"
          >
            <div className="p-6 text-center">
              <div className="mx-auto w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center mb-4">
                <LogOut size={22} className="text-red-500" />
              </div>
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white mb-1.5">确认退出</h3>
              <p className="text-sm text-neutral-500 dark:text-neutral-400">退出后需要重新登录才能使用完整功能</p>
            </div>
            <div className="flex border-t border-neutral-100 dark:border-neutral-800">
              <button
                onClick={() => setShowLogoutConfirm(false)}
                className="flex-1 py-3 text-sm font-medium text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
              >
                取消
              </button>
              <div className="w-px bg-neutral-100 dark:bg-neutral-800" />
              <button
                onClick={() => {
                  setShowLogoutConfirm(false);
                  logout();
                  router.push("/");
                }}
                className="flex-1 py-3 text-sm font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              >
                退出登录
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
}
