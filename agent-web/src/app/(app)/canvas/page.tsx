"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function CanvasRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/cutout"); }, [router]);
  return null;
}
