"use client";

import { useSiteConfigStore } from "@/store/site-config";

export default function TermsPage() {
  const { config } = useSiteConfigStore();
  const name = config.site_name || "Zihui AI";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 mb-8">用户协议</h1>
      <div className="prose prose-neutral prose-sm max-w-none text-neutral-600 space-y-6">
        <p>欢迎使用 {name}（以下简称"本平台"）。在使用本平台前，请您仔细阅读以下条款。</p>

        <h2 className="text-lg font-semibold text-neutral-800">一、服务说明</h2>
        <p>{name} 提供基于人工智能技术的图片生成、编辑、对话等在线服务。本平台保留随时修改、中断或终止部分或全部服务的权利。</p>

        <h2 className="text-lg font-semibold text-neutral-800">二、用户注册与账号安全</h2>
        <p>用户应提供真实、准确的注册信息。用户有义务妥善保管账号及密码，因账号泄露导致的损失由用户自行承担。</p>

        <h2 className="text-lg font-semibold text-neutral-800">三、使用规范</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>不得利用本平台从事违法违规活动；</li>
          <li>不得生成、传播违反法律法规或公序良俗的内容；</li>
          <li>不得利用技术手段干扰平台正常运行；</li>
          <li>不得未经授权抓取平台数据或进行逆向工程。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">四、知识产权</h2>
        <p>本平台及其所有内容（包括但不限于软件、界面、商标、文本）的知识产权归本平台所有。用户通过本平台生成的内容，用户享有合理使用权。</p>

        <h2 className="text-lg font-semibold text-neutral-800">五、积分与付费</h2>
        <p>本平台提供积分系统，部分功能需消耗积分。已充值的积分不支持退款，特殊情况可联系客服处理。</p>

        <h2 className="text-lg font-semibold text-neutral-800">六、免责声明</h2>
        <p>AI 生成内容仅供参考，本平台不对其准确性、完整性作任何保证。因不可抗力或第三方原因导致的服务中断，本平台不承担责任。</p>

        <h2 className="text-lg font-semibold text-neutral-800">七、协议修改</h2>
        <p>本平台有权根据需要修改本协议，修改后的协议将在平台公告或推送通知。继续使用本平台即视为接受修改后的协议。</p>

        <p className="text-xs text-neutral-400 mt-8">最后更新日期：2025年1月1日</p>
      </div>
    </div>
  );
}
