import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";

export const metadata: Metadata = {
  title: {
    default: "Zihui AI - 智能创作平台",
    template: "%s | Zihui AI",
  },
  description: "AI 聊天、生图、修图、视频、音乐，一站式智能创作平台",
  keywords: ["AI", "人工智能", "AI绘画", "AI聊天", "智能创作", "AI生图", "AI修图", "AI视频", "AI音乐"],
  robots: { index: true, follow: true },
  icons: {
    icon: "/logo-icon.svg",
    apple: "/logo-icon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Zihui AI",
    title: "Zihui AI - 智能创作平台",
    description: "AI 聊天、生图、修图、视频、音乐，一站式智能创作平台",
    locale: "zh_CN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Zihui AI - 智能创作平台",
    description: "AI 聊天、生图、修图、视频、音乐，一站式智能创作平台",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
