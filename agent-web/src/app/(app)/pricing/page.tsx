"use client";

import { useState, useEffect } from "react";
import { Check, Sparkles, CreditCard, Loader2, Wallet, X, Gift } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { PageContainer, PageHeader, PageContent } from "@/components/ui/page-shell";
import { packageAPI, orderAPI, redeemAPI } from "@/lib/api";
import api from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { useSiteConfigStore } from "@/store/site-config";
import PaymentModal from "@/components/payment-modal";

interface PackageItem {
  id: number;
  name: string;
  type: string;
  original_price: number;
  price: number;
  credits: number;
  daily_free_chat: number;
  daily_free_image: number;
  features: string[] | null;
  description: string;
  sort: number;
  status: string;
}

const typeLabels: Record<string, string> = {
  monthly: "/月",
  quarterly: "/季",
  yearly: "/年",
};

const freePlan = {
  name: "免费版",
  price: 0,
  features: ["基础 AI 聊天", "每日 5 次免费对话", "标准生图模型", "注册送 100 积分"],
};

export default function PricingPage() {
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ordering, setOrdering] = useState(false);
  const [selectedPkg, setSelectedPkg] = useState<PackageItem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"wechat" | "alipay">("wechat");
  const [paymentModal, setPaymentModal] = useState<{
    open: boolean;
    orderNo: string;
    payUrl: string;
    amount: number;
    expireAt: string;
  }>({ open: false, orderNo: "", payUrl: "", amount: 0, expireAt: "" });
  const token = useAuthStore((s) => s.token);
  const fetchProfile = useAuthStore((s) => s.fetchProfile);
  const { openLoginModal } = useLoginModalStore();
  const { toast } = useToast();
  const [redeemCode, setRedeemCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);



  const handleRedeem = async () => {
    if (!redeemCode.trim()) return;
    if (!token) {
      useLoginModalStore.getState().openLoginModal();
      return;
    }
    setRedeeming(true);
    try {
      const res = await redeemAPI.redeem(redeemCode.trim());
      toast(`兑换成功！获得 ${res.data.credits} 积分`, "success");
      setRedeemCode("");
      fetchProfile();
    } catch (e: any) {
      toast(e.response?.data?.error || "兑换失败", "error");
    } finally {
      setRedeeming(false);
    }
  };

  const { agentCode, isAgentSite } = useSiteConfigStore();

  useEffect(() => {
    const loadPackages = async () => {
      try {
        if (isAgentSite && agentCode) {
          // Load agent-specific packages
          const res = await api.get("/agent/public-packages", { params: { agent_code: agentCode } });
          setPackages(res.data.data || []);
        } else {
          const res = await packageAPI.list();
          setPackages(res.data.data || []);
        }
      } catch {
        // fallback
      } finally {
        setLoading(false);
      }
    };
    loadPackages();
  }, [isAgentSite, agentCode]);

  const handleSelectPkg = (pkg: PackageItem) => {
    if (!token) {
      useLoginModalStore.getState().openLoginModal();
      return;
    }
    setSelectedPkg(pkg);
    setPaymentMethod("wechat");
  };

  const handleConfirmPay = async () => {
    if (!selectedPkg) return;
    setOrdering(true);
    try {
      const res = await orderAPI.create({
        package_id: selectedPkg.id,
        type: "subscribe",
        payment_method: paymentMethod,
      });
      const data = res.data?.data;
      if (data?.pay_url) {
        setSelectedPkg(null);
        setPaymentModal({
          open: true,
          orderNo: data.order.order_no,
          payUrl: data.pay_url,
          amount: data.order.amount,
          expireAt: data.expire_at,
        });
      }
    } catch {
      toast("创建订单失败，请重试", "error");
    } finally {
      setOrdering(false);
    }
  };

  const allPlans = [freePlan, ...packages.map((p) => ({
    ...p,
    features: p.features || (p.description ? p.description.split(",") : [`${p.credits} 积分`, `每日 ${p.daily_free_chat} 次对话`, `每日 ${p.daily_free_image} 次生图`]),
  }))];

  if (mounted && !token) {
    return (
      <PageContainer>
        <div className="flex-1 flex items-center justify-center py-20">
          <p className="text-sm text-neutral-400">请先登录后再查看方案</p>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="选择方案"
        description="所有方案均支持微信和支付宝付款"
        icon={<CreditCard size={16} className="text-neutral-400" />}
      />
      <PageContent>
        <div className="max-w-4xl mx-auto">
          {loading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="animate-spin text-neutral-400" size={32} />
            </div>
          ) : (
            <div className={cn("grid gap-5", allPlans.length <= 3 ? "grid-cols-1 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3")}>
              {allPlans.map((plan, i) => {
                const isPackage = "id" in plan;
                const pkg = isPackage ? (plan as PackageItem & { features: string[] }) : null;
                const recommended = i === 1;

                return (
                  <motion.div
                    key={isPackage ? (plan as PackageItem).id : "free"}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                    className={cn(
                      "rounded-2xl border backdrop-blur-sm flex flex-col hover:shadow-lg transition-all relative overflow-hidden",
                      recommended
                        ? "border-neutral-900 shadow-md ring-1 ring-neutral-900/5 bg-white"
                        : "border-neutral-200/60 shadow-sm hover:border-neutral-300 bg-white/80"
                    )}
                  >
                    {recommended && (
                      <div className="bg-neutral-900 dark:bg-neutral-100 px-6 py-3">
                        <span className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                          <Sparkles size={12} /> 最受欢迎
                        </span>
                      </div>
                    )}

                    <div className="p-6 flex flex-col flex-1">
                      <h3 className="text-lg font-semibold text-neutral-900">{plan.name}</h3>
                      <div className="mt-3 mb-1 flex items-baseline gap-1">
                        <span className="text-sm text-neutral-400">¥</span>
                        <span className="text-4xl font-bold text-neutral-900 tracking-tight">{plan.price}</span>
                        {pkg && <span className="text-sm text-neutral-400 ml-1">{typeLabels[pkg.type] || ""}</span>}
                        {pkg && pkg.original_price > pkg.price && (
                          <span className="ml-2 text-sm text-neutral-300 line-through">¥{pkg.original_price}</span>
                        )}
                      </div>
                      {pkg && (
                        <div className="mt-2 mb-5 inline-flex self-start items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-medium">
                          <Sparkles size={11} />
                          {pkg.credits} 积分
                        </div>
                      )}
                      {!pkg && <p className="text-sm text-neutral-400 mt-2 mb-5">注册即享免费体验</p>}

                      <ul className="space-y-3 flex-1 mb-6">
                        {(plan.features || []).map((feature: string) => (
                          <li key={feature} className="flex items-start gap-2.5 text-sm text-neutral-600">
                            <div className="w-4 h-4 rounded-full bg-emerald-50 flex items-center justify-center shrink-0 mt-0.5">
                              <Check size={10} className="text-emerald-500" />
                            </div>
                            {feature}
                          </li>
                        ))}
                      </ul>

                      <motion.button
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        disabled={ordering}
                        onClick={() => pkg && handleSelectPkg(pkg)}
                        className={cn(
                          "w-full py-3 rounded-xl text-sm font-medium transition-all disabled:opacity-50",
                          recommended
                            ? "bg-neutral-900 text-white hover:bg-neutral-800 shadow-lg shadow-neutral-300/30"
                            : pkg
                              ? "bg-neutral-100 text-neutral-800 hover:bg-neutral-200"
                              : "border border-neutral-200 text-neutral-400 cursor-default"
                        )}
                      >
                        {!pkg ? "当前方案" : "立即开通"}
                      </motion.button>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

          {/* Redeem code section */}
          <div className="max-w-4xl mx-auto mt-10">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.4 }}
              className="rounded-2xl border border-neutral-200/60 bg-white/80 backdrop-blur-sm p-6 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-4">
                <Gift size={18} className="text-amber-500" />
                <h3 className="text-base font-semibold text-neutral-900">兑换码</h3>
              </div>
              <p className="text-sm text-neutral-500 mb-4">输入兑换码可直接获得积分</p>
              <div className="flex gap-3 max-w-md">
                <input
                  value={redeemCode}
                  onChange={(e) => setRedeemCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
                  placeholder="请输入兑换码"
                  className="flex-1 px-4 py-2.5 rounded-xl border border-neutral-200/60 bg-white/60 text-sm outline-none focus:border-neutral-300 focus:ring-1 focus:ring-neutral-200 transition-all"
                />
                <button
                  onClick={handleRedeem}
                  disabled={redeeming || !redeemCode.trim()}
                  className="px-5 py-2.5 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors shadow-md"
                >
                  {redeeming ? "兑换中..." : "立即兑换"}
                </button>
              </div>
            </motion.div>
          </div>
      </PageContent>

      {/* Checkout modal: select payment method */}
      {selectedPkg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="relative w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <h3 className="text-lg font-semibold text-neutral-900">确认订单</h3>
              <button onClick={() => setSelectedPkg(null)} className="p-1 rounded-lg hover:bg-neutral-100 transition-colors">
                <X size={18} className="text-neutral-400" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Package info */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-neutral-900">{selectedPkg.name}</p>
                  <p className="text-sm text-neutral-500">{selectedPkg.credits} 积分</p>
                </div>
                <p className="text-2xl font-bold text-neutral-900">¥{selectedPkg.price}</p>
              </div>

              {/* Payment method */}
              <div>
                <p className="text-sm font-medium text-neutral-700 mb-3">选择支付方式</p>
                <div className="flex gap-3">
                  {(["wechat", "alipay"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => setPaymentMethod(m)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-medium border-2 transition-all",
                        paymentMethod === m
                          ? "border-neutral-900 bg-neutral-900 text-white shadow-md"
                          : "border-neutral-200 text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                      )}
                    >
                      <Wallet size={16} />
                      {m === "wechat" ? "微信支付" : "支付宝"}
                    </button>
                  ))}
                </div>
              </div>

              {/* Confirm button */}
              <button
                disabled={ordering}
                onClick={handleConfirmPay}
                className="w-full py-3 rounded-xl bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2 shadow-md"
              >
                {ordering ? (
                  <><Loader2 size={14} className="animate-spin" /> 创建订单...</>
                ) : (
                  <><CreditCard size={14} /> 确认支付 ¥{selectedPkg.price}</>
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <PaymentModal
        open={paymentModal.open}
        onClose={() => setPaymentModal((p) => ({ ...p, open: false }))}
        onSuccess={() => {
          setPaymentModal((p) => ({ ...p, open: false }));
          fetchProfile();
        }}
        orderNo={paymentModal.orderNo}
        payUrl={paymentModal.payUrl}
        amount={paymentModal.amount}
        expireAt={paymentModal.expireAt}
      />
    </PageContainer>
  );
}
