"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { X, Loader2, CheckCircle, AlertCircle, Smartphone } from "lucide-react";
import { orderAPI } from "@/lib/api";
import { motion, AnimatePresence } from "framer-motion";
import { QRCodeSVG } from "qrcode.react";
import { featureFlags } from "@/lib/features";

interface PaymentModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  orderNo: string;
  payUrl: string;
  amount: number;
  expireAt: string;
}

export default function PaymentModal({
  open,
  onClose,
  onSuccess,
  orderNo,
  payUrl,
  amount,
  expireAt,
}: PaymentModalProps) {
  const [status, setStatus] = useState<"pending" | "paid" | "expired" | "error">("pending");
  const [countdown, setCountdown] = useState(0);
  const isMockMode = featureFlags.mockPayment && Boolean(payUrl?.includes("mock-pay"));
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!open || !orderNo) return;

    setStatus("pending");

    // Countdown
    const expMs = new Date(expireAt).getTime() - Date.now();
    setCountdown(Math.max(0, Math.floor(expMs / 1000)));
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          setStatus("expired");
          stopPolling();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Poll payment status every 3s
    pollRef.current = setInterval(async () => {
      try {
        const res = await orderAPI.payStatus(orderNo);
        if (res.data?.data?.status === "paid") {
          setStatus("paid");
          stopPolling();
          setTimeout(() => onSuccess(), 1500);
        }
      } catch {
        // ignore
      }
    }, 3000);

    return () => stopPolling();
  }, [open, orderNo, expireAt, stopPolling, onSuccess]);

  const handleMockPay = async () => {
    if (!featureFlags.mockPayment || !isMockMode) return;
    try {
      await orderAPI.mockPay(orderNo);
    } catch {
      setStatus("error");
    }
  };

  const formatCountdown = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-sm mx-4 bg-white dark:bg-neutral-900 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100 dark:border-neutral-800">
            <h3 className="text-lg font-semibold text-neutral-900">支付订单</h3>
            <button onClick={() => { stopPolling(); onClose(); }} className="p-1 rounded-lg hover:bg-neutral-100 transition-colors">
              <X size={18} className="text-neutral-400" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-6 flex flex-col items-center gap-4">
            {status === "pending" && (
              <>
                <div className="text-center">
                  <p className="text-sm text-neutral-500">订单号: {orderNo}</p>
                  <p className="text-3xl font-bold text-neutral-900 mt-1">¥{amount.toFixed(2)}</p>
                </div>

                {/* QR Code */}
                {payUrl && !isMockMode ? (
                  <div className="p-4 bg-white rounded-xl border border-neutral-100 shadow-sm">
                    <QRCodeSVG
                      value={payUrl}
                      size={192}
                      level="M"
                      includeMargin={false}
                      bgColor="#ffffff"
                      fgColor="#171717"
                    />
                  </div>
                ) : (
                  <div className="w-48 h-48 bg-neutral-50 border-2 border-dashed border-neutral-200 rounded-xl flex flex-col items-center justify-center gap-2">
                    <Smartphone size={36} className="text-neutral-300" />
                    <p className="text-xs text-neutral-400 text-center px-4">
                      模拟支付模式
                    </p>
                  </div>
                )}

                <p className="text-xs text-neutral-400 text-center">
                  请使用微信或支付宝扫描二维码完成支付
                </p>

                {/* Countdown */}
                <div className="flex items-center gap-2 text-sm text-neutral-500">
                  <Loader2 size={14} className="animate-spin" />
                  <span>等待支付... {formatCountdown(countdown)}</span>
                </div>

                {/* Mock pay button — only in mock mode */}
                {isMockMode && (
                  <button
                    onClick={handleMockPay}
                    className="w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2"
                  >
                    <Smartphone size={16} />
                    模拟支付（测试）
                  </button>
                )}
              </>
            )}

            {status === "paid" && (
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="flex flex-col items-center gap-3 py-8"
              >
                <CheckCircle size={48} className="text-emerald-500" />
                <p className="text-lg font-semibold text-neutral-900">支付成功</p>
                <p className="text-sm text-neutral-500">积分已到账</p>
              </motion.div>
            )}

            {status === "expired" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <AlertCircle size={48} className="text-amber-500" />
                <p className="text-lg font-semibold text-neutral-900">订单已过期</p>
                <p className="text-sm text-neutral-500">请重新创建订单</p>
                <button
                  onClick={() => { stopPolling(); onClose(); }}
                  className="mt-2 px-6 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  关闭
                </button>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <AlertCircle size={48} className="text-red-500" />
                <p className="text-lg font-semibold text-neutral-900">支付异常</p>
                <p className="text-sm text-neutral-500">请稍后重试</p>
                <button
                  onClick={() => { stopPolling(); onClose(); }}
                  className="mt-2 px-6 py-2 rounded-xl border border-neutral-200 text-sm text-neutral-700 hover:bg-neutral-50 transition-colors"
                >
                  关闭
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
