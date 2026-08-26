"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Users,
  DollarSign,
  Copy,
  Check,
  Loader2,
  Gift,
  User,
  X,
  Link2,
  Download,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { referralAPI } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { usePageTitle } from "@/hooks/use-page-title";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

interface ReferralStats {
  invite_code: string;
  invited_count: number;
  total_commission: number;
  pending_commission: number;
  settled_commission: number;
}

interface CommissionItem {
  id: number;
  invitee_nickname: string;
  order_no: string;
  order_amount: number;
  rate: number;
  amount: number;
  status: string;
  created_at: string;
}

interface InviteeItem {
  id: number;
  nickname: string;
  avatar: string;
  created_at: string;
}

export default function ReferralPage() {
  usePageTitle("邀请有礼");
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [commissions, setCommissions] = useState<CommissionItem[]>([]);
  const [invitees, setInvitees] = useState<InviteeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<"invitees" | "commissions">("invitees");
  const qrCodeRef = useRef<SVGSVGElement>(null);

  const fetchData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [statsRes, commissionsRes, inviteesRes] = await Promise.all([
        referralAPI.stats(),
        referralAPI.commissions(),
        referralAPI.invitees(),
      ]);
      setStats(statsRes.data);
      setCommissions(commissionsRes.data?.data ?? []);
      setInvitees(inviteesRes.data?.data ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const referralLink =
    typeof window !== "undefined" && stats?.invite_code
      ? `${window.location.origin}/referral/${stats.invite_code}`
      : "";

  const handleCopy = () => {
    if (!referralLink) return;
    navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadQr = () => {
    if (!qrCodeRef.current || !stats?.invite_code) return;
    const source = new XMLSerializer().serializeToString(qrCodeRef.current);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `invite-${stats.invite_code}.svg`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <div className="text-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4">
            <Gift size={24} className="text-amber-500" />
          </div>
          <h3 className="text-sm font-medium text-neutral-600 mb-1">请先登录</h3>
          <p className="text-xs text-neutral-400 max-w-xs mb-4">
            登录后可查看您的邀请码和推广收益
          </p>
          <button
            onClick={() => useLoginModalStore.getState().openLoginModal()}
            className="px-6 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition-colors shadow-md"
          >
            去登录
          </button>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
        <Loader2 size={24} className="text-neutral-300 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-[#fafafa] dark:bg-[#0A0A0A]">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-100/60 dark:border-neutral-800/60 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-1.5 rounded-lg hover:bg-neutral-100 transition-colors"
            >
              <ArrowLeft size={16} className="text-neutral-500" />
            </Link>
            <h1 className="text-base font-semibold text-neutral-900">
              邀请有礼
            </h1>
          </div>
          <button
            onClick={() => setDrawerOpen(true)}
            className="px-4 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-colors"
          >
            推广详情
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6">
          {/* Two column layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left column: Invite code + QR */}
            <div className="lg:col-span-5 space-y-5">
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl border border-neutral-200/60 p-6 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-neutral-900 mb-5">
                  专属邀请码
                </h2>
                <div className="text-center mb-5">
                  <p className="text-[10px] text-neutral-400 tracking-[0.3em] uppercase mb-1">
                    CODE
                  </p>
                  <p className="text-2xl font-bold tracking-[0.15em] text-neutral-900">
                    {stats?.invite_code?.toUpperCase() || "—"}
                  </p>
                </div>

                {/* QR Code */}
                <div className="flex flex-col items-center">
                  <div className="w-48 h-48 rounded-xl border border-neutral-100 bg-white p-2 mb-3">
                    {referralLink ? (
                      <QRCodeSVG
                        ref={qrCodeRef}
                        value={referralLink}
                        size={176}
                        level="M"
                        className="h-full w-full"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-neutral-300">
                        <Loader2 size={20} className="animate-spin" />
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleDownloadQr}
                    disabled={!referralLink}
                    className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-neutral-600 transition-colors"
                  >
                    <Download size={12} />
                    下载二维码图片
                  </button>
                </div>
              </motion.div>
            </div>

            {/* Right column: Stats + Link + Tips */}
            <div className="lg:col-span-7 space-y-5">
              {/* Stats row */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 }}
                className="grid grid-cols-2 gap-4"
              >
                <div className="bg-white rounded-2xl border border-neutral-200/60 p-5 shadow-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Users size={14} className="text-blue-400" />
                    <span className="text-[11px] text-neutral-400">已邀请好友</span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <p className="text-3xl font-bold text-neutral-900">
                      {stats?.invited_count ?? 0}
                    </p>
                    <span className="text-xs text-neutral-400">人</span>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-neutral-200/60 p-5 shadow-sm">
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign size={14} className="text-amber-400" />
                    <span className="text-[11px] text-neutral-400">累计佣金</span>
                  </div>
                  <p className="text-3xl font-bold text-neutral-900">
                    <span className="text-base text-neutral-400 mr-0.5">¥</span>
                    {(stats?.total_commission ?? 0).toFixed(2)}
                  </p>
                </div>
              </motion.div>

              {/* Invitation link */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-white rounded-2xl border border-neutral-200/60 p-6 shadow-sm"
              >
                <h2 className="text-sm font-semibold text-neutral-900 mb-1">
                  邀请链接
                </h2>
                <p className="text-xs text-neutral-400 mb-4">
                  复制链接分享给好友，好友通过链接注册成功后，双方各得200积分奖励，好友注册年内消费将产生佣金
                </p>

                <div className="px-3 py-2.5 rounded-xl bg-amber-50 border border-amber-100 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">🎁</span>
                    <div>
                      <p className="text-xs font-medium text-amber-700">注册奖励</p>
                      <p className="text-[11px] text-amber-600/80">
                        好友成功注册后，您和好友都将获得200积分
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-50 border border-neutral-200/60 min-w-0">
                    <Link2 size={14} className="text-neutral-400 shrink-0" />
                    <span className="flex-1 text-xs text-neutral-600 truncate">
                      {referralLink || "加载中..."}
                    </span>
                  </div>
                  <button
                    onClick={handleCopy}
                    className={cn(
                      "flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-medium transition-all shrink-0",
                      copied
                        ? "bg-green-500 text-white"
                        : "bg-neutral-900 text-white hover:bg-neutral-800"
                    )}
                  >
                    {copied ? (
                      <><Check size={13} /> 已复制</>
                    ) : (
                      <><Copy size={13} /> 复制链接</>
                    )}
                  </button>
                </div>
              </motion.div>

              {/* Tips */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-white rounded-2xl border border-neutral-200/60 p-6 shadow-sm"
              >
                <h3 className="text-sm font-semibold text-neutral-900 mb-3 flex items-center gap-2">
                  <span className="text-amber-500">🔥</span> 推广小贴士
                </h3>
                <ul className="space-y-2">
                  {[
                    "分享推广码或链接到朋友圈、微信群，获取更多点击。",
                    "好友成功注册后，您和好友都将获得200积分奖励。",
                    "新用户注册一年内的消费，您将获得支付金额 10% 的佣金奖励。",
                  ].map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-neutral-500">
                      <span className="text-amber-400 mt-0.5">•</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </div>
        </div>
      </div>

      {/* Drawer overlay */}
      <AnimatePresence>
        {drawerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/20 z-40"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 400, damping: 35 }}
              className="fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-white shadow-2xl z-50 flex flex-col"
            >
              {/* Drawer header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100">
                <div className="flex items-center gap-2">
                  <X
                    size={16}
                    className="text-neutral-400 cursor-pointer hover:text-neutral-600 transition-colors"
                    onClick={() => setDrawerOpen(false)}
                  />
                  <h2 className="text-sm font-semibold text-neutral-900">推广详情</h2>
                </div>
              </div>

              {/* Drawer tabs */}
              <div className="flex border-b border-neutral-100">
                <button
                  onClick={() => setDrawerTab("invitees")}
                  className={cn(
                    "flex-1 py-3 text-xs font-medium text-center transition-colors relative",
                    drawerTab === "invitees"
                      ? "text-neutral-900"
                      : "text-neutral-400 hover:text-neutral-600"
                  )}
                >
                  我邀请的用户
                  {drawerTab === "invitees" && (
                    <motion.div
                      layoutId="drawer-tab"
                      className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-neutral-900 rounded-full"
                    />
                  )}
                </button>
                <button
                  onClick={() => setDrawerTab("commissions")}
                  className={cn(
                    "flex-1 py-3 text-xs font-medium text-center transition-colors relative",
                    drawerTab === "commissions"
                      ? "text-neutral-900"
                      : "text-neutral-400 hover:text-neutral-600"
                  )}
                >
                  佣金明细
                  {drawerTab === "commissions" && (
                    <motion.div
                      layoutId="drawer-tab"
                      className="absolute bottom-0 left-1/4 right-1/4 h-[2px] bg-neutral-900 rounded-full"
                    />
                  )}
                </button>
              </div>

              {/* Drawer content */}
              <div className="flex-1 overflow-y-auto p-4">
                {drawerTab === "invitees" ? (
                  invitees.length === 0 ? (
                    <div className="py-16 text-center">
                      <div className="w-12 h-12 rounded-xl bg-neutral-50 flex items-center justify-center mx-auto mb-3">
                        <Users size={20} className="text-neutral-300" />
                      </div>
                      <p className="text-xs text-neutral-400">暂无邀请记录</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {invitees.map((inv) => (
                        <div
                          key={inv.id}
                          className="flex items-center gap-3 p-3 rounded-xl bg-neutral-50"
                        >
                          <div className="w-8 h-8 rounded-full bg-neutral-200 flex items-center justify-center shrink-0">
                            {inv.avatar ? (
                              <img src={inv.avatar} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <User size={14} className="text-neutral-400" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-neutral-700 truncate">
                              {inv.nickname}
                            </p>
                            <p className="text-[10px] text-neutral-400">
                              {new Date(inv.created_at).toLocaleDateString("zh-CN")}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : commissions.length === 0 ? (
                  <div className="py-16 text-center">
                    <div className="w-12 h-12 rounded-xl bg-neutral-50 flex items-center justify-center mx-auto mb-3">
                      <FileText size={20} className="text-neutral-300" />
                    </div>
                    <p className="text-xs text-neutral-400">暂无佣金记录</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {commissions.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-neutral-50"
                      >
                        <div>
                          <p className="text-xs font-medium text-neutral-700">
                            {c.invitee_nickname} 消费 ¥{c.order_amount.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-neutral-400 mt-0.5">
                            {new Date(c.created_at).toLocaleDateString("zh-CN")} · 订单 {c.order_no}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-green-600">
                            +¥{c.amount.toFixed(2)}
                          </p>
                          <p
                            className={cn(
                              "text-[10px]",
                              c.status === "settled"
                                ? "text-green-500"
                                : c.status === "pending"
                                ? "text-amber-500"
                                : "text-neutral-400"
                            )}
                          >
                            {c.status === "settled" ? "已结算" : c.status === "pending" ? "待结算" : "已取消"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
