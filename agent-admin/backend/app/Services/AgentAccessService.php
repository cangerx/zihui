<?php

namespace App\Services;

use App\Models\Agent;
use App\Models\AgentPurchase;
use App\Models\AgentVisibility;

/**
 * 智能体访问鉴权（桌面端接口复用）。
 *
 * 把 AgentController/AgentPublicController 里分散的「可见 + 已拥有」判定抽成单一入口，
 * 供「桌面端知识库检索」等需要校验"用户是否有权使用该智能体"的接口复用。
 *
 * 检索权随智能体授权传递：用户 acquire 了智能体（agent_purchases 有记录）
 * 即可检索该智能体绑定的知识库，无需对知识库单独授权。
 */
class AgentAccessService
{
    /**
     * 加载一个「上架 + 审核通过」的智能体（否则 null）。
     */
    public function findApprovedVisibleAgent(int $agentId, array $with = []): ?Agent
    {
        return Agent::with($with)
            ->where('id', $agentId)
            ->where('is_visible', true)
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->first();
    }

    /**
     * 智能体是否对用户可见：public 恒可见；restricted 命中白名单（user / 所属 group）。
     */
    public function isAgentVisibleTo(Agent $agent, $user): bool
    {
        if ($agent->visibility_scope !== Agent::VISIBILITY_RESTRICTED) {
            return true;
        }
        if (!$user) {
            return false;
        }
        $groupIds = $user->groups()->pluck('user_groups.id')->all();
        return AgentVisibility::where('agent_id', $agent->id)
            ->where(function ($w) use ($user, $groupIds) {
                $w->where(function ($x) use ($user) {
                    $x->where('assignee_type', AgentVisibility::ASSIGNEE_USER)
                        ->where('assignee_id', $user->id);
                });
                if (!empty($groupIds)) {
                    $w->orWhere(function ($x) use ($groupIds) {
                        $x->where('assignee_type', AgentVisibility::ASSIGNEE_GROUP)
                            ->whereIn('assignee_id', $groupIds);
                    });
                }
            })
            ->exists();
    }

    /**
     * 用户是否已 acquire（拥有）该智能体。
     */
    public function userOwnsAgent(int $agentId, int $userId): bool
    {
        return AgentPurchase::where('agent_id', $agentId)
            ->where('user_id', $userId)
            ->exists();
    }
}
