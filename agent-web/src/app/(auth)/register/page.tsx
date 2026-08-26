"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useLoginModalStore } from "@/store/login-modal";

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterInner />
    </Suspense>
  );
}

function RegisterInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");

  useEffect(() => {
    if (ref) {
      localStorage.setItem("ref_code", ref);
    }
    router.replace("/");
    setTimeout(() => {
      useLoginModalStore.getState().openLoginModal();
    }, 300);
  }, [ref, router]);

  return (
    <div className="flex-1 flex items-center justify-center h-screen bg-[#fafafa]">
      <div className="text-center">
        <Loader2 size={24} className="text-neutral-300 animate-spin mx-auto mb-3" />
        <p className="text-sm text-neutral-400">正在跳转...</p>
      </div>
    </div>
  );
}
