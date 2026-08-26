"use client";

import { useSiteConfigStore } from "@/store/site-config";

export default function PrivacyPage() {
  const { config } = useSiteConfigStore();
  const name = config.site_name || "Zihui AI";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 mb-8">隐私政策</h1>
      <div className="prose prose-neutral prose-sm max-w-none text-neutral-600 space-y-6">
        <p>{name}（以下简称"我们"）非常重视您的隐私保护。本政策说明我们如何收集、使用和保护您的个人信息。</p>

        <h2 className="text-lg font-semibold text-neutral-800">一、信息收集</h2>
        <p>我们可能收集以下信息：</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>注册信息：邮箱、手机号、昵称；</li>
          <li>使用数据：功能使用记录、生成内容记录；</li>
          <li>设备信息：浏览器类型、IP 地址、操作系统；</li>
          <li>支付信息：订单记录（不存储银行卡号等敏感信息）。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">二、信息使用</h2>
        <p>收集的信息用于：</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>提供和改善我们的服务；</li>
          <li>账号安全验证和风控；</li>
          <li>发送服务通知和更新；</li>
          <li>数据分析以优化用户体验。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">三、信息共享</h2>
        <p>我们不会向第三方出售您的个人信息。仅在以下情况下可能共享：</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>获得您的明确同意；</li>
          <li>法律法规要求或司法机关要求；</li>
          <li>为提供服务所必需的第三方服务商（如短信、支付）。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">四、信息安全</h2>
        <p>我们采用行业标准的安全技术措施保护您的个人信息，包括数据加密、访问控制和安全审计。但请理解互联网环境下不存在绝对的安全措施。</p>

        <h2 className="text-lg font-semibold text-neutral-800">五、Cookie 使用</h2>
        <p>我们使用 Cookie 和类似技术来维持登录状态、记住偏好设置、进行流量统计。您可以通过浏览器设置管理 Cookie。</p>

        <h2 className="text-lg font-semibold text-neutral-800">六、您的权利</h2>
        <p>您有权访问、修正、删除您的个人信息，也有权注销账号。如需行使以上权利，请通过设置页面操作或联系客服。</p>

        <h2 className="text-lg font-semibold text-neutral-800">七、政策更新</h2>
        <p>我们可能适时更新本政策，更新后将在平台公告。继续使用本平台即视为接受更新后的政策。</p>

        <p className="text-xs text-neutral-400 mt-8">最后更新日期：2025年1月1日</p>
      </div>
    </div>
  );
}
