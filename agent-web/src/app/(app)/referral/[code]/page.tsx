"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLoginModalStore } from "@/store/login-modal";

export default function ReferralRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const code = params.code as string;

  useEffect(() => {
    if (code) {
      localStorage.setItem("ref_code", code);
    }
    router.replace("/");
    setTimeout(() => {
      useLoginModalStore.getState().openLoginModal();
    }, 300);
  }, [code, router]);

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-[#fafafa]">
      <div className="text-center">
        <Loader2 size={24} className="text-neutral-300 animate-spin mx-auto mb-3" />
        <p className="text-sm text-neutral-400">正在跳转...</p>
      </div>
    </div>
  );
}
