"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Loader2, Smartphone, Mail, Lock, Shield, Palette, Clock, Sparkles, Wrench, Check, Eye, EyeOff, Send } from "lucide-react";
import { authAPI, appAPI } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useLoginModalStore } from "@/store/login-modal";
import { useSiteConfigStore } from "@/store/site-config";
import { cn } from "@/lib/utils";
import { featureFlags } from "@/lib/features";

type LoginTab = "phone" | "email" | "email_code";
type LoginView = "login" | "register" | "forgot";

interface LoginMethods {
  email_password: boolean;
  phone_sms: boolean;
  email_code: boolean;
  github: boolean;
  google: boolean;
  wechat: boolean;
  weibo: boolean;
  qq: boolean;
}

const FEATURES = [
  { icon: Palette, text: "海量模板 每日更新", color: "bg-pink-500/20" },
  { icon: Clock, text: "作图记录 永不丢失", color: "bg-blue-500/20" },
  { icon: Shield, text: "商用授权 安心使用", color: "bg-emerald-500/20" },
  { icon: Sparkles, text: "AI商拍 抢先体验", color: "bg-amber-500/20" },
  { icon: Wrench, text: "智能工具 轻松创作", color: "bg-violet-500/20" },
];

const OAUTH_CLIENT_IDS: Record<string, string | undefined> = {
  github: process.env.NEXT_PUBLIC_OAUTH_GITHUB_CLIENT_ID,
  google: process.env.NEXT_PUBLIC_OAUTH_GOOGLE_CLIENT_ID,
  wechat: process.env.NEXT_PUBLIC_OAUTH_WECHAT_APP_ID,
  weibo: process.env.NEXT_PUBLIC_OAUTH_WEIBO_CLIENT_ID,
  qq: process.env.NEXT_PUBLIC_OAUTH_QQ_APP_ID,
};

const tabContentVariants = {
  enter: (direction: number) => ({ x: direction > 0 ? 24 : -24, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({ x: direction > 0 ? -24 : 24, opacity: 0 }),
};

const shakeVariants = {
  shake: { x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.5 } },
};

export default function LoginModal() {
  const { isOpen, openLoginModal, closeLoginModal } = useLoginModalStore();
  const { setToken, fetchProfile } = useAuthStore();
  const { config: siteConfig } = useSiteConfigStore();

  const [loginMethods, setLoginMethods] = useState<LoginMethods>({
    email_password: true,
    phone_sms: true,
    email_code: true,
    github: false,
    google: false,
    wechat: false,
    weibo: false,
    qq: false,
  });

  const [view, setView] = useState<LoginView>("login");
  const [tab, setTab] = useState<LoginTab>("phone");
  const [tabDirection, setTabDirection] = useState(0);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailCode, setEmailCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [forgotStep, setForgotStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [codeSending, setCodeSending] = useState(false);
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [success, setSuccess] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Listen for 401 events from API interceptor
  useEffect(() => {
    const handler = () => openLoginModal();
    window.addEventListener("auth:unauthorized", handler);
    return () => window.removeEventListener("auth:unauthorized", handler);
  }, [openLoginModal]);

  // Fetch available login methods
  useEffect(() => {
    if (isOpen) {
      appAPI.loginMethods().then((res) => {
        const data = res.data?.data;
        if (data) {
          setLoginMethods({
            ...data,
            github: Boolean(featureFlags.oauth && data.github && OAUTH_CLIENT_IDS.github),
            google: Boolean(featureFlags.oauth && data.google && OAUTH_CLIENT_IDS.google),
            wechat: Boolean(featureFlags.oauth && data.wechat && OAUTH_CLIENT_IDS.wechat),
            weibo: Boolean(featureFlags.oauth && data.weibo && OAUTH_CLIENT_IDS.weibo),
            qq: Boolean(featureFlags.oauth && data.qq && OAUTH_CLIENT_IDS.qq),
          });
        }
        if (data?.phone_sms) setTab("phone");
        else if (data?.email_code) setTab("email_code");
        else if (data?.email_password) setTab("email");
      }).catch(() => {});
    }
  }, [isOpen]);

  // Auto focus first input when modal opens or tab changes
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (tab === "phone") phoneRef.current?.focus();
      else emailRef.current?.focus();
    }, 350);
    return () => clearTimeout(timer);
  }, [isOpen, tab]);

  // Keyboard: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen]);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Clear error on input change
  useEffect(() => { if (error) setError(""); }, [phone, code, email, password]);

  const resetForm = useCallback(() => {
    setPhone("");
    setCode("");
    setEmail("");
    setPassword("");
    setEmailCode("");
    setNickname("");
    setNewPassword("");
    setError("");
    setCodeSent(false);
    setCountdown(0);
    setLoading(false);
    setSuccess(false);
    setShowPassword(false);
    setView("login");
    setForgotStep(1);
  }, []);

  const handleClose = useCallback(() => {
    closeLoginModal();
    setTimeout(resetForm, 300);
  }, [closeLoginModal, resetForm]);

  const triggerError = (msg: string) => {
    setError(msg);
    setErrorKey((k) => k + 1);
  };

  // Send SMS code
  const handleSendCode = async () => {
    if (!phone || !/^1\d{10}$/.test(phone)) {
      triggerError("请输入有效的手机号");
      return;
    }
    setError("");
    setCodeSending(true);
    try {
      await authAPI.sendCode({ phone });
      setCodeSent(true);
      setCountdown(60);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "发送失败，请稍后重试");
    } finally {
      setCodeSending(false);
    }
  };

  // Phone login
  const handlePhoneLogin = async () => {
    if (!phone || !code) {
      triggerError("请输入手机号和验证码");
      return;
    }
    if (!agreed) {
      triggerError("请先同意用户协议");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const invite_code = localStorage.getItem("ref_code") || undefined;
      const res = await authAPI.phoneLogin({ phone, code, invite_code });
      setToken(res.data.token);
      await fetchProfile();
      localStorage.removeItem("ref_code");
      setSuccess(true);
      setTimeout(handleClose, 800);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  // Email login
  const handleEmailLogin = async () => {
    if (!email || !password) {
      triggerError("请输入邮箱和密码");
      return;
    }
    if (!agreed) {
      triggerError("请先同意用户协议");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await authAPI.login({ email, password });
      setToken(res.data.token);
      await fetchProfile();
      setSuccess(true);
      setTimeout(handleClose, 800);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  // Email code login
  const handleSendEmailCode = async (purpose?: string) => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      triggerError("请输入有效的邮箱地址");
      return;
    }
    setError("");
    setCodeSending(true);
    try {
      await authAPI.sendEmailCode({ email, purpose: purpose || "login" });
      setCodeSent(true);
      setCountdown(60);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "发送失败，请稍后重试");
    } finally {
      setCodeSending(false);
    }
  };

  const handleEmailCodeLogin = async () => {
    if (!email || !emailCode) {
      triggerError("请输入邮箱和验证码");
      return;
    }
    if (!agreed) {
      triggerError("请先同意用户协议");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const invite_code = localStorage.getItem("ref_code") || undefined;
      const res = await authAPI.emailLogin({ email, code: emailCode, invite_code });
      setToken(res.data.token);
      await fetchProfile();
      localStorage.removeItem("ref_code");
      setSuccess(true);
      setTimeout(handleClose, 800);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  // Register
  const handleRegister = async () => {
    if (!email || !password || !nickname) {
      triggerError("请填写完整信息");
      return;
    }
    if (!agreed) {
      triggerError("请先同意用户协议");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const res = await authAPI.register({ email, password, nickname });
      setToken(res.data.token);
      await fetchProfile();
      setSuccess(true);
      setTimeout(handleClose, 800);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "注册失败");
    } finally {
      setLoading(false);
    }
  };

  // Forgot / Reset password
  const handleForgotSendCode = async () => {
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      triggerError("请输入有效的邮箱地址");
      return;
    }
    setError("");
    try {
      await authAPI.sendEmailCode({ email, purpose: "reset" });
      setCodeSent(true);
      setCountdown(60);
      setForgotStep(2);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "发送失败");
    }
  };

  const handleResetPassword = async () => {
    if (!email || !emailCode || !newPassword) {
      triggerError("请填写完整信息");
      return;
    }
    if (newPassword.length < 6) {
      triggerError("密码至少6位");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await authAPI.resetPassword({ email, code: emailCode, new_password: newPassword });
      setSuccess(true);
      triggerError("");
      setTimeout(() => { setView("login"); setSuccess(false); resetForm(); }, 1500);
    } catch (err: any) {
      triggerError(err.response?.data?.error || "重置失败");
    } finally {
      setLoading(false);
    }
  };

  // OAuth login
  const handleOAuth = (provider: string) => {
    if (!featureFlags.oauth) return;
    const clientId = OAUTH_CLIENT_IDS[provider];
    if (!clientId) {
      triggerError("该登录方式尚未配置");
      return;
    }
    const redirectUri = encodeURIComponent(`${window.location.origin}/auth/callback/${provider}`);
    const encodedClientId = encodeURIComponent(clientId);
    const oauthUrls: Record<string, string> = {
      github: `https://github.com/login/oauth/authorize?client_id=${encodedClientId}&redirect_uri=${redirectUri}&scope=user:email`,
      google: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodedClientId}&redirect_uri=${redirectUri}&response_type=code&scope=openid%20email%20profile`,
      wechat: `https://open.weixin.qq.com/connect/qrconnect?appid=${encodedClientId}&redirect_uri=${redirectUri}&response_type=code&scope=snsapi_login`,
      weibo: `https://api.weibo.com/oauth2/authorize?client_id=${encodedClientId}&redirect_uri=${redirectUri}&response_type=code`,
      qq: `https://graph.qq.com/oauth2.0/authorize?client_id=${encodedClientId}&redirect_uri=${redirectUri}&response_type=code&scope=get_user_info`,
    };
    if (oauthUrls[provider]) {
      window.location.href = oauthUrls[provider];
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (view === "register") { handleRegister(); return; }
    if (view === "forgot") { forgotStep === 1 ? handleForgotSendCode() : handleResetPassword(); return; }
    if (tab === "phone") handlePhoneLogin();
    else if (tab === "email_code") handleEmailCodeLogin();
    else handleEmailLogin();
  };

  const switchTab = (newTab: LoginTab) => {
    setTabDirection(newTab === "email" ? 1 : -1);
    setTab(newTab);
    setError("");
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[100] flex items-end md:items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={handleClose}
        >
          {/* Desktop: centered card / Mobile: bottom sheet */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 30 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full md:w-[90vw] md:max-w-[820px] md:rounded-2xl rounded-t-[20px] bg-white dark:bg-neutral-900 shadow-2xl overflow-hidden flex flex-col md:flex-row max-h-[92vh] md:max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Mobile drag indicator */}
            <div className="md:hidden flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-neutral-300" />
            </div>

            {/* Left: Brand panel */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="hidden md:flex w-[280px] flex-col justify-between bg-neutral-900 p-8 text-white shrink-0 relative overflow-hidden"
            >
              {/* Decorative glow */}
              <div className="absolute -top-20 -right-20 w-40 h-40 bg-purple-500/15 rounded-full blur-3xl" />
              <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-emerald-500/10 rounded-full blur-3xl" />

              <div className="relative z-10">
                {siteConfig.site_logo ? (
                  <img
                    src={siteConfig.site_logo}
                    alt={siteConfig.site_name}
                    className="h-9 mb-3 object-contain"
                  />
                ) : (
                  <div className="mb-3 flex items-center gap-3">
                    <img src={siteConfig.site_favicon || "/logo-icon.svg"} alt="" className="h-9 w-9" />
                    <span className="text-xl font-semibold">{siteConfig.site_name}</span>
                  </div>
                )}
                <p className="text-xs text-white/50 mb-8">
                  {siteConfig.site_description || "一站式智能创作平台"}
                </p>
                <div className="space-y-4">
                  {FEATURES.map((f, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.15 + i * 0.07, ease: "easeOut" }}
                      className="flex items-center gap-3"
                    >
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", f.color)}>
                        <f.icon size={15} className="text-white/90" />
                      </div>
                      <span className="text-[13px] text-white/80 font-light">{f.text}</span>
                    </motion.div>
                  ))}
                </div>
              </div>

              <p className="text-[10px] text-white/25 mt-6 relative z-10">
                {siteConfig.site_copyright}
              </p>
            </motion.div>

            {/* Right: Login form */}
            <div className="flex-1 p-6 md:p-10 relative overflow-y-auto">
              {/* Close button */}
              <motion.button
                onClick={handleClose}
                whileHover={{ scale: 1.1, rotate: 90 }}
                whileTap={{ scale: 0.9 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
                className="absolute top-3 right-3 md:top-4 md:right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-neutral-100 transition-colors z-10"
              >
                <X size={16} className="text-neutral-400" />
              </motion.button>

              {/* Success state */}
              <AnimatePresence mode="wait">
                {success ? (
                  <motion.div
                    key="success"
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="flex flex-col items-center justify-center py-16"
                  >
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.1 }}
                      className="w-16 h-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4"
                    >
                      <motion.div
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: 0.4, delay: 0.3 }}
                      >
                        <Check size={32} className="text-emerald-500" strokeWidth={2.5} />
                      </motion.div>
                    </motion.div>
                    <motion.p
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="text-lg font-medium text-neutral-900"
                    >
                      登录成功
                    </motion.p>
                  </motion.div>
                ) : (
                  <motion.div key="form" className="max-w-[320px] mx-auto">
                    <motion.h2
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.15 }}
                      className="text-xl font-bold text-neutral-900 text-center mb-1"
                    >
                      {view === "register" ? "创建账号" : view === "forgot" ? "重置密码" : "欢迎登录"}
                    </motion.h2>
                    <motion.p
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="text-sm text-neutral-400 text-center mb-7"
                    >
                      {view === "register" ? "注册后即可体验全部 AI 功能" : view === "forgot" ? "通过邮箱验证码重置密码" : "登录后即可体验全部 AI 功能"}
                    </motion.p>

                    {/* Tab bar — only show in login view */}
                    {view === "login" && (() => {
                      const allTabs: { key: LoginTab; label: string; icon: typeof Smartphone; enabled: boolean }[] = [
                        { key: "phone", label: "手机验证码", icon: Smartphone, enabled: loginMethods.phone_sms },
                        { key: "email_code", label: "邮箱验证码", icon: Mail, enabled: loginMethods.email_code },
                        { key: "email", label: "密码登录", icon: Lock, enabled: loginMethods.email_password },
                      ];
                      const tabs = allTabs.filter((t) => t.enabled);
                      if (tabs.length <= 1) return null;
                      const activeIdx = tabs.findIndex((t) => t.key === tab);
                      return (
                        <motion.div
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.25 }}
                          className="relative flex items-center bg-neutral-100 rounded-xl p-1 mb-5"
                        >
                          <motion.div
                            className="absolute top-1 bottom-1 rounded-lg bg-white shadow-sm"
                            initial={false}
                            animate={{
                              left: `calc(${(activeIdx / tabs.length) * 100}% + 4px)`,
                              width: `calc(${100 / tabs.length}% - 8px)`,
                            }}
                            transition={{ type: "spring", stiffness: 350, damping: 30 }}
                          />
                          {tabs.map((t) => (
                            <button
                              key={t.key}
                              type="button"
                              onClick={() => switchTab(t.key)}
                              className={cn(
                                "relative z-10 flex-1 py-2 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1",
                                tab === t.key ? "text-neutral-900" : "text-neutral-400 hover:text-neutral-600"
                              )}
                            >
                              <t.icon size={13} /> {t.label}
                            </button>
                          ))}
                        </motion.div>
                      );
                    })()}

                    {/* Error */}
                    <AnimatePresence mode="wait">
                      {error && (
                        <motion.div
                          key={errorKey}
                          variants={shakeVariants}
                          animate="shake"
                          exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                          className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2 mb-4"
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <form onSubmit={handleSubmit}>
                      <AnimatePresence mode="wait" custom={tabDirection}>
                        {/* Tab: Phone login */}
                        {view === "login" && tab === "phone" && loginMethods.phone_sms && (
                          <motion.div
                            key="phone"
                            custom={tabDirection}
                            variants={tabContentVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="space-y-3"
                          >
                            <div className={cn(
                              "flex items-center border rounded-xl overflow-hidden transition-all duration-200",
                              "border-neutral-200"
                            )}>
                              <span className="pl-4 pr-3 text-sm text-neutral-500 py-2.5 shrink-0">
                                +86
                              </span>
                              <input
                                ref={phoneRef}
                                type="tel"
                                value={phone}
                                onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                                onFocus={() => setPhoneFocused(true)}
                                onBlur={() => setPhoneFocused(false)}
                                placeholder="请输入手机号码"
                                maxLength={11}
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                            </div>

                            <div className={cn(
                              "flex items-center border rounded-xl overflow-hidden transition-all duration-200",
                              "border-neutral-200"
                            )}>
                              <input
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                                onFocus={() => setCodeFocused(true)}
                                onBlur={() => setCodeFocused(false)}
                                placeholder="请输入验证码"
                                maxLength={6}
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                              <motion.button
                                type="button"
                                onClick={handleSendCode}
                                disabled={countdown > 0 || codeSending}
                                whileTap={{ scale: 0.95 }}
                                whileHover={countdown > 0 || codeSending ? {} : { backgroundColor: "#f5f5f5" }}
                                className={cn(
                                  "px-4 py-2.5 text-sm font-medium shrink-0 transition-all border-l border-neutral-200 flex items-center gap-1.5",
                                  countdown > 0 || codeSending
                                    ? "text-neutral-300 cursor-not-allowed"
                                    : "text-neutral-900 hover:text-neutral-700"
                                )}
                              >
                                {codeSending ? (
                                  <><Loader2 size={13} className="animate-spin" /> 发送中</>
                                ) : countdown > 0 ? (
                                  <><motion.span key={countdown} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="tabular-nums inline-block">{countdown}s</motion.span></>
                                ) : (
                                  <><Send size={13} /> 获取验证码</>
                                )}
                              </motion.button>
                            </div>
                          </motion.div>
                        )}

                        {/* Tab: Email login */}
                        {view === "login" && tab === "email" && loginMethods.email_password && (
                          <motion.div
                            key="email"
                            custom={tabDirection}
                            variants={tabContentVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="space-y-3"
                          >
                            <div className={cn(
                              "flex items-center border rounded-xl overflow-hidden transition-all duration-200",
                              "border-neutral-200"
                            )}>
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Mail size={16} className={cn("transition-colors", emailFocused ? "text-neutral-700" : "text-neutral-400")} />
                              </span>
                              <input
                                ref={emailRef}
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onFocus={() => setEmailFocused(true)}
                                onBlur={() => setEmailFocused(false)}
                                placeholder="请输入邮箱"
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                            </div>
                            <div className={cn(
                              "flex items-center border rounded-xl overflow-hidden transition-all duration-200",
                              "border-neutral-200"
                            )}>
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Lock size={16} className={cn("transition-colors", passwordFocused ? "text-neutral-700" : "text-neutral-400")} />
                              </span>
                              <input
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onFocus={() => setPasswordFocused(true)}
                                onBlur={() => setPasswordFocused(false)}
                                placeholder="请输入密码"
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="px-3 py-2.5 text-neutral-400 hover:text-neutral-600 transition-colors"
                                tabIndex={-1}
                              >
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                          </motion.div>
                        )}

                        {/* Tab: Email code login */}
                        {view === "login" && tab === "email_code" && loginMethods.email_code && (
                          <motion.div
                            key="email_code"
                            custom={tabDirection}
                            variants={tabContentVariants}
                            initial="enter"
                            animate="center"
                            exit="exit"
                            transition={{ duration: 0.25, ease: "easeInOut" }}
                            className="space-y-3"
                          >
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Mail size={16} className="text-neutral-400" />
                              </span>
                              <input
                                ref={emailRef}
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="请输入邮箱"
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                            </div>
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <input
                                type="text"
                                value={emailCode}
                                onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))}
                                placeholder="请输入验证码"
                                maxLength={6}
                                className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent"
                              />
                              <motion.button
                                type="button"
                                onClick={() => handleSendEmailCode("login")}
                                disabled={countdown > 0 || codeSending}
                                whileTap={{ scale: 0.95 }}
                                whileHover={countdown > 0 || codeSending ? {} : { backgroundColor: "#f5f5f5" }}
                                className={cn(
                                  "px-4 py-2.5 text-sm font-medium shrink-0 transition-all border-l border-neutral-200 flex items-center gap-1.5",
                                  countdown > 0 || codeSending ? "text-neutral-300 cursor-not-allowed" : "text-neutral-900 hover:text-neutral-700"
                                )}
                              >
                                {codeSending ? (
                                  <><Loader2 size={13} className="animate-spin" /> 发送中</>
                                ) : countdown > 0 ? (
                                  <><motion.span key={countdown} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="tabular-nums inline-block">{countdown}s</motion.span></>
                                ) : (
                                  <><Send size={13} /> 获取验证码</>
                                )}
                              </motion.button>
                            </div>
                          </motion.div>
                        )}

                        {/* View: Register */}
                        {view === "register" && (
                          <motion.div
                            key="register"
                            initial={{ opacity: 0, x: 24 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -24 }}
                            transition={{ duration: 0.25 }}
                            className="space-y-3"
                          >
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Mail size={16} className="text-neutral-400" />
                              </span>
                              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                            </div>
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Shield size={16} className="text-neutral-400" />
                              </span>
                              <input type="text" value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="昵称（至少2个字符）" className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                            </div>
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Lock size={16} className="text-neutral-400" />
                              </span>
                              <input type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="密码（至少6位）" className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                              <button type="button" onClick={() => setShowPassword(!showPassword)} className="px-3 py-2.5 text-neutral-400 hover:text-neutral-600 transition-colors" tabIndex={-1}>
                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                              </button>
                            </div>
                          </motion.div>
                        )}

                        {/* View: Forgot password */}
                        {view === "forgot" && (
                          <motion.div
                            key="forgot"
                            initial={{ opacity: 0, x: 24 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: -24 }}
                            transition={{ duration: 0.25 }}
                            className="space-y-3"
                          >
                            <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                              <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                <Mail size={16} className="text-neutral-400" />
                              </span>
                              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="注册邮箱" className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                            </div>
                            {forgotStep === 2 && (
                              <>
                                <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                                  <input type="text" value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ""))} placeholder="邮箱验证码" maxLength={6} className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                                  <motion.button type="button" onClick={() => handleSendEmailCode("reset")} disabled={countdown > 0 || codeSending} whileTap={{ scale: 0.95 }}
                                    whileHover={countdown > 0 || codeSending ? {} : { backgroundColor: "#f5f5f5" }}
                                    className={cn("px-4 py-2.5 text-sm font-medium shrink-0 border-l border-neutral-200 flex items-center gap-1.5", countdown > 0 || codeSending ? "text-neutral-300 cursor-not-allowed" : "text-neutral-900 hover:text-neutral-700")}>
                                    {codeSending ? (
                                      <><Loader2 size={13} className="animate-spin" /> 发送中</>
                                    ) : countdown > 0 ? (
                                      <><motion.span key={countdown} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="tabular-nums inline-block">{countdown}s</motion.span></>
                                    ) : (
                                      <><Send size={13} /> 重新发送</>
                                    )}
                                  </motion.button>
                                </div>
                                <div className="flex items-center border rounded-xl overflow-hidden border-neutral-200">
                                  <span className="px-3 py-2.5 bg-neutral-50 border-r border-neutral-200 shrink-0">
                                    <Lock size={16} className="text-neutral-400" />
                                  </span>
                                  <input type={showPassword ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="新密码（至少6位）" className="flex-1 px-3 py-2.5 text-sm outline-none bg-transparent" />
                                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="px-3 py-2.5 text-neutral-400 hover:text-neutral-600 transition-colors" tabIndex={-1}>
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                  </button>
                                </div>
                              </>
                            )}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Forgot password link — only in email password tab */}
                      {view === "login" && tab === "email" && (
                        <div className="text-right mt-2">
                          <button type="button" onClick={() => { setView("forgot"); setError(""); setCodeSent(false); setForgotStep(1); }} className="text-xs text-neutral-400 hover:text-neutral-600 transition-colors">
                            忘记密码？
                          </button>
                        </div>
                      )}

                      {/* Submit */}
                      <motion.button
                        type="submit"
                        disabled={loading || success}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.98 }}
                        className={cn(
                          "w-full mt-5 py-2.5 rounded-xl text-white text-sm font-medium transition-all flex items-center justify-center gap-2 relative overflow-hidden",
                          loading
                            ? "bg-neutral-700"
                            : "bg-neutral-900 hover:bg-neutral-800 hover:shadow-lg hover:shadow-neutral-900/10"
                        )}
                      >
                        {loading ? (
                          <><Loader2 size={15} className="animate-spin" /> {view === "register" ? "注册中..." : view === "forgot" ? "处理中..." : "登录中..."}</>
                        ) : (
                          view === "register" ? "注册" : view === "forgot" ? (forgotStep === 1 ? "发送验证码" : "重置密码") : "登录"
                        )}
                      </motion.button>
                    </form>

                    {/* Switch between login/register/forgot */}
                    <div className="text-center mt-4 text-xs text-neutral-400">
                      {view === "login" ? (
                        <span>
                          没有账号？{" "}
                          <button type="button" onClick={() => { setView("register"); setError(""); }} className="text-neutral-700 hover:text-neutral-900 font-medium transition-colors">
                            立即注册
                          </button>
                        </span>
                      ) : (
                        <span>
                          已有账号？{" "}
                          <button type="button" onClick={() => { setView("login"); setError(""); setForgotStep(1); }} className="text-neutral-700 hover:text-neutral-900 font-medium transition-colors">
                            返回登录
                          </button>
                        </span>
                      )}
                    </div>

                    {/* Social login */}
                    {(loginMethods.github || loginMethods.google || loginMethods.wechat || loginMethods.weibo || loginMethods.qq) && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.35 }}
                        className="mt-6"
                      >
                        <div className="flex items-center gap-3 mb-4">
                          <div className="flex-1 h-px bg-neutral-200" />
                          <span className="text-xs text-neutral-400">更多登录方式</span>
                          <div className="flex-1 h-px bg-neutral-200" />
                        </div>
                        <div className="flex items-center justify-center gap-6">
                          {loginMethods.github && (
                            <motion.button
                              type="button"
                              onClick={() => handleOAuth("github")}
                              whileHover={{ scale: 1.12, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex flex-col items-center gap-1.5"
                              title="GitHub 登录"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#24292f] flex items-center justify-center shadow-sm shadow-neutral-400/30">
                                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="white">
                                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
                                </svg>
                              </span>
                              <span className="text-[10px] text-neutral-400">GitHub</span>
                            </motion.button>
                          )}
                          {loginMethods.google && (
                            <motion.button
                              type="button"
                              onClick={() => handleOAuth("google")}
                              whileHover={{ scale: 1.12, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex flex-col items-center gap-1.5"
                              title="Google 登录"
                            >
                              <span className="w-9 h-9 rounded-full bg-white border border-neutral-200 flex items-center justify-center shadow-sm">
                                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]">
                                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                                </svg>
                              </span>
                              <span className="text-[10px] text-neutral-400">Google</span>
                            </motion.button>
                          )}
                          {loginMethods.weibo && (
                            <motion.button
                              type="button"
                              onClick={() => handleOAuth("weibo")}
                              whileHover={{ scale: 1.12, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex flex-col items-center gap-1.5"
                              title="微博登录"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#E8594D] flex items-center justify-center shadow-sm shadow-red-200/50">
                                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="white">
                                  <path d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM9.05 17.219c-.384.616-1.208.884-1.829.602-.612-.279-.793-.991-.406-1.593.379-.595 1.176-.861 1.793-.601.622.263.82.972.442 1.592zm1.27-1.627c-.141.237-.449.353-.689.253-.236-.09-.313-.361-.177-.586.138-.227.436-.346.672-.24.239.09.315.36.18.601l.014-.028zm.176-2.719c-1.893-.493-4.033.45-4.857 2.118-.836 1.704-.026 3.591 1.886 4.21 1.983.64 4.318-.341 5.132-2.179.8-1.793-.201-3.642-2.161-4.149zm7.563-1.224c-.346-.105-.57-.18-.405-.615.375-.977.42-1.804 0-2.404-.781-1.112-2.915-1.053-5.364-.03 0 0-.766.331-.571-.271.376-1.217.315-2.224-.27-2.809-1.338-1.337-4.869.045-7.888 3.08C1.309 10.87 0 13.273 0 15.348c0 3.981 5.099 6.395 10.086 6.395 6.536 0 10.888-3.801 10.888-6.82 0-1.822-1.547-2.854-2.915-3.284v.01zm1.908-5.092c-.766-.856-1.908-1.187-2.96-.962-.436.09-.706.511-.616.932.09.42.511.691.932.602.511-.105 1.067.044 1.442.465.376.421.466.977.316 1.473-.136.406.089.856.51.992.405.119.857-.105.992-.512.33-1.021.12-2.178-.646-3.035l.03.045zm2.418-2.195c-1.576-1.757-3.905-2.419-6.054-1.968-.496.104-.812.587-.706 1.081.104.496.586.813 1.082.707 1.532-.331 3.185.15 4.296 1.383 1.112 1.246 1.429 2.943.947 4.416-.165.48.106 1.007.586 1.157.479.165.991-.104 1.157-.586.675-2.088.241-4.478-1.338-6.235l.03.045z"/>
                                </svg>
                              </span>
                              <span className="text-[10px] text-neutral-400">微博</span>
                            </motion.button>
                          )}
                          {loginMethods.wechat && (
                            <motion.button
                              type="button"
                              onClick={() => handleOAuth("wechat")}
                              whileHover={{ scale: 1.12, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex flex-col items-center gap-1.5"
                              title="微信登录"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#07C160] flex items-center justify-center shadow-sm shadow-green-200/50">
                                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="white">
                                  <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 0 1 .213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 0 0 .167-.054l1.903-1.114a.864.864 0 0 1 .717-.098 10.16 10.16 0 0 0 2.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178A1.17 1.17 0 0 1 4.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 0 1-1.162 1.178 1.17 1.17 0 0 1-1.162-1.178c0-.651.52-1.18 1.162-1.18zm5.34 2.867c-1.797-.052-3.746.512-5.28 1.786-1.72 1.428-2.687 3.72-1.78 6.22.942 2.453 3.666 4.229 6.884 4.229.826 0 1.622-.12 2.361-.336a.722.722 0 0 1 .598.082l1.584.926a.272.272 0 0 0 .14.047c.134 0 .24-.111.24-.247 0-.06-.023-.12-.038-.177l-.327-1.233a.582.582 0 0 1-.023-.156.49.49 0 0 1 .201-.398C23.024 18.48 24 16.82 24 14.98c0-3.21-2.931-5.837-6.656-6.088V8.89c-.135-.01-.27-.027-.407-.03zm-2.53 3.274c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.97-.982zm4.844 0c.535 0 .969.44.969.982a.976.976 0 0 1-.969.983.976.976 0 0 1-.969-.983c0-.542.434-.982.969-.982z"/>
                                </svg>
                              </span>
                              <span className="text-[10px] text-neutral-400">微信</span>
                            </motion.button>
                          )}
                          {loginMethods.qq && (
                            <motion.button
                              type="button"
                              onClick={() => handleOAuth("qq")}
                              whileHover={{ scale: 1.12, y: -2 }}
                              whileTap={{ scale: 0.95 }}
                              className="flex flex-col items-center gap-1.5"
                              title="QQ登录"
                            >
                              <span className="w-9 h-9 rounded-full bg-[#4FACFE] flex items-center justify-center shadow-sm shadow-blue-200/50">
                                <svg viewBox="0 0 24 24" className="w-[16px] h-[16px]" fill="white">
                                  <path d="M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673"/>
                                </svg>
                              </span>
                              <span className="text-[10px] text-neutral-400">QQ</span>
                            </motion.button>
                          )}
                        </div>
                      </motion.div>
                    )}

                    {/* Agreement */}
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4 }}
                      className="mt-6 flex items-start gap-2"
                    >
                      <motion.button
                        type="button"
                        onClick={() => setAgreed(!agreed)}
                        whileTap={{ scale: 0.85 }}
                        className={cn(
                          "mt-0.5 w-4 h-4 rounded border-[1.5px] flex items-center justify-center shrink-0 transition-all",
                          agreed
                            ? "bg-neutral-900 border-neutral-900"
                            : "border-neutral-300 hover:border-neutral-400"
                        )}
                      >
                        {agreed && (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: "spring", stiffness: 500, damping: 20 }}
                          >
                            <Check size={10} className="text-white" strokeWidth={3} />
                          </motion.div>
                        )}
                      </motion.button>
                      <p className="text-xs text-neutral-400 leading-relaxed">
                        我已阅读并同意{" "}
                        <a href="/terms" className="text-neutral-600 hover:text-neutral-900 hover:underline transition-colors">
                          用户协议
                        </a>
                        、
                        <a href="/privacy" className="text-neutral-600 hover:text-neutral-900 hover:underline transition-colors">
                          个人信息保护政策
                        </a>
                        {" "}和{" "}
                        <a href="/account-rules" className="text-neutral-600 hover:text-neutral-900 hover:underline transition-colors">
                          账号规则
                        </a>
                      </p>
                    </motion.div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
