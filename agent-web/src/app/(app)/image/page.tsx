"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ImageRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/product-photo"); }, [router]);
  return null;
}
