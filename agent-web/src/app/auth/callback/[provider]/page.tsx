"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { authAPI } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Loader2, AlertCircle } from "lucide-react";

export default function OAuthCallbackPage() {
  return (
    <Suspense>
      <OAuthCallbackInner />
    </Suspense>
  );
}

function OAuthCallbackInner() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { setToken, fetchProfile } = useAuthStore();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const provider = params.provider as string;
  const code = searchParams.get("code");

  useEffect(() => {
    if (!code || !provider) {
      setError("授权参数缺失");
      setLoading(false);
      return;
    }

    authAPI
      .oauthLogin({ provider, code })
      .then(async (res) => {
        setToken(res.data.token);
        await fetchProfile();
        router.replace("/");
      })
      .catch((err) => {
        setError(err.response?.data?.error || "授权登录失败，请重试");
        setLoading(false);
      });
  }, [code, provider, setToken, fetchProfile, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-50">
      <div className="text-center max-w-sm mx-auto px-6">
        {loading ? (
          <>
            <Loader2 size={32} className="animate-spin text-neutral-400 mx-auto mb-4" />
            <p className="text-neutral-600 text-sm">正在完成授权登录...</p>
          </>
        ) : error ? (
          <>
            <AlertCircle size={32} className="text-red-400 mx-auto mb-4" />
            <p className="text-red-600 text-sm mb-6">{error}</p>
            <button
              onClick={() => router.replace("/")}
              className="px-6 py-2 rounded-xl bg-neutral-900 text-white text-sm hover:bg-neutral-800 transition-colors"
            >
              返回首页
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
