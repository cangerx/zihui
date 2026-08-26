<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Agent extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_WITHDRAWN = 'withdrawn';

    public const SOURCE_ADMIN = 'admin';
    public const SOURCE_USER = 'user';

    public const TOOL_APPROVAL_OFF = 'off';
    public const TOOL_APPROVAL_DESTRUCTIVE = 'destructive';
    public const TOOL_APPROVAL_ALL = 'all';

    // 可见范围
    public const VISIBILITY_PUBLIC = 'public';
    public const VISIBILITY_RESTRICTED = 'restricted';

    // 计价币种（复用 user_balances.balance_type）
    public const BALANCE_TOKEN = 'token';
    public const BALANCE_CREDIT = 'credit';

    /**
     * 桌面端预设的 6 个内置小工具 ID（builtin_*）。
     * 这些 ID 全平台固定（开机 INSERT OR IGNORE 种入），云端只存 ID，桌面端导入直接套用。
     */
    public const BUILTIN_TOOL_SKILL_IDS = [
        'builtin_current_time',
        'builtin_calculator',
        'builtin_fetch_webpage',
        'builtin_json_tool',
        'builtin_text_tool',
        'builtin_random_generator',
    ];

    protected $fillable = [
        'category_id',
        'name',
        'description',
        'avatar',
        'avatar_thumb',
        'system_prompt',
        'template_schema_version',
        'template_version',
        'role_profile',
        'workflow_templates',
        'acceptance_templates',
        'recommended_skill_dirs',
        'connector_requirements',
        'tool_skill_ids',
        'tool_approval',
        'enable_image_gen',
        'kb_only',
        'kb_top_k',
        'tags',
        'price',
        'price_balance_type',
        'download_count',
        'rating_avg',
        'rating_count',
        'sort_order',
        'is_visible',
        'visibility_scope',
        'hub_shared_id',
        'hub_status',
        'hub_status_synced_at',
        'from_hub_agent_id',
        'from_hub_source_site_name',
        'source_metadata',
        'submission_status',
        'source_type',
        'submitted_by_user_id',
        'submitted_by_nickname',
        'reviewed_by_user_id',
        'reviewed_at',
        'reject_reason',
        'source_local_agent_id',
        'submitted_at',
        'published_at',
        'created_by_user_id',
    ];

    protected $casts = [
        'category_id' => 'integer',
        'tool_skill_ids' => 'array',
        'template_schema_version' => 'integer',
        'template_version' => 'integer',
        'role_profile' => 'array',
        'workflow_templates' => 'array',
        'acceptance_templates' => 'array',
        'recommended_skill_dirs' => 'array',
        'connector_requirements' => 'array',
        'tags' => 'array',
        'enable_image_gen' => 'boolean',
        'kb_only' => 'boolean',
        'kb_top_k' => 'integer',
        'is_visible' => 'boolean',
        'price' => 'decimal:2',
        'download_count' => 'integer',
        'rating_avg' => 'decimal:2',
        'rating_count' => 'integer',
        'sort_order' => 'integer',
        'hub_shared_id' => 'integer',
        'hub_status_synced_at' => 'datetime',
        'from_hub_agent_id' => 'integer',
        'source_metadata' => 'array',
        'submitted_by_user_id' => 'integer',
        'reviewed_by_user_id' => 'integer',
        'created_by_user_id' => 'integer',
        'reviewed_at' => 'datetime',
        'submitted_at' => 'datetime',
        'published_at' => 'datetime',
    ];

    public function category(): BelongsTo
    {
        return $this->belongsTo(AgentCategory::class, 'category_id');
    }

    public function submittedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by_user_id');
    }

    public function ratings(): HasMany
    {
        return $this->hasMany(AgentRating::class);
    }

    public function visibilities(): HasMany
    {
        return $this->hasMany(AgentVisibility::class);
    }

    public function purchases(): HasMany
    {
        return $this->hasMany(AgentPurchase::class);
    }

    public function knowledgeBases(): BelongsToMany
    {
        return $this->belongsToMany(
            KnowledgeBase::class,
            'agent_knowledge_bases',
            'agent_id',
            'knowledge_base_id'
        )->withTimestamps()->orderBy('agent_knowledge_bases.sort_order');
    }
}
