"use client";

import { useSiteConfigStore } from "@/store/site-config";

export default function AccountRulesPage() {
  const { config } = useSiteConfigStore();
  const name = config.site_name || "Zihui AI";

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="text-2xl font-bold text-neutral-900 mb-8">账号规则</h1>
      <div className="prose prose-neutral prose-sm max-w-none text-neutral-600 space-y-6">
        <p>为维护 {name} 平台的健康生态，特制定以下账号规则。所有用户在使用本平台服务时，均需遵守以下规定。</p>

        <h2 className="text-lg font-semibold text-neutral-800">一、账号注册</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>每个手机号/邮箱仅可注册一个账号；</li>
          <li>注册信息必须真实有效；</li>
          <li>禁止批量注册、使用虚拟号码注册；</li>
          <li>新注册用户将获得平台赠送的体验积分。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">二、账号使用</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>账号仅供注册人本人使用，禁止转让、出借、共享；</li>
          <li>禁止利用账号从事任何违法违规行为；</li>
          <li>禁止使用自动化工具批量操作平台功能；</li>
          <li>禁止生成涉及色情、暴力、政治敏感等违规内容。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">三、积分规则</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>积分可通过充值、邀请好友、参与活动获得；</li>
          <li>使用 AI 功能将消耗对应积分；</li>
          <li>积分不可转让、不可提现；</li>
          <li>恶意刷积分行为将导致账号封禁。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">四、违规处理</h2>
        <p>对于违反以上规则的账号，平台将视情节严重程度采取以下措施：</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>警告通知；</li>
          <li>限制部分功能使用；</li>
          <li>冻结账号积分；</li>
          <li>永久封禁账号。</li>
        </ul>

        <h2 className="text-lg font-semibold text-neutral-800">五、账号注销</h2>
        <p>用户可在「设置 → 安全设置」中申请注销账号。注销后账号数据将被清除且不可恢复，剩余积分将被清零。</p>

        <p className="text-xs text-neutral-400 mt-8">最后更新日期：2025年1月1日</p>
      </div>
    </div>
  );
}
