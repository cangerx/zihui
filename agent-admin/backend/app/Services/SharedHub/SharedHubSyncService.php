<?php

namespace App\Services\SharedHub;

use App\Models\Agent;
use App\Models\AgentCategory;
use App\Models\CreativeTemplate;
use App\Models\CreativeTemplateCategory;
use App\Models\Inspiration;
use App\Models\InspirationCategory;
use App\Models\SystemSetting;
use App\Services\AgentHub\AgentHubClient;
use App\Services\CreativeTemplateHub\CreativeTemplateHubClient;
use App\Services\InspirationHub\InspirationHubClient;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * 本站已上架内容推到授权端 Hub，Hub 已通过内容拉回本站。
 * 从 Hub 拉来的记录不再回推，避免环。
 */
class SharedHubSyncService
{
    public function __construct(
        private SharedHubTransport $inspirations,
        private SharedHubTransport $templates,
        private SharedHubTransport $agents
    ) {
    }

    public static function fromClients(
        InspirationHubClient $inspirations,
        CreativeTemplateHubClient $templates,
        AgentHubClient $agents
    ): self {
        return new self(
            new ClientHubTransport($inspirations),
            new ClientHubTransport($templates),
            new ClientHubTransport($agents)
        );
    }

    /**
     * @return array<string, array{pushed:int,pulled:int,skipped:int,errors:string[]}>
     */
    public function syncAll(int $limit = 200): array
    {
        return [
            'inspirations' => $this->syncInspirations($limit),
            'templates' => $this->syncTemplates($limit),
            'agents' => $this->syncAgents($limit),
        ];
    }

    /**
     * @return array{pushed:int,pulled:int,skipped:int,errors:string[]}
     */
    public function syncInspirations(int $limit = 200): array
    {
        $stats = $this->emptyStats();
        if (!$this->inspirations->isReady()) {
            $stats['errors'][] = 'inspiration_hub_not_ready';
            return $stats;
        }

        $hubCats = $this->hubCategories($this->inspirations);
        $locals = Inspiration::query()
            ->with('category')
            ->where('status', Inspiration::STATUS_APPROVED)
            ->where('is_visible', true)
            ->whereNull('hub_shared_id')
            ->whereNull('from_hub_inspiration_id')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        foreach ($locals as $row) {
            $cover = $this->publicUrl((string) $row->cover_image);
            if ($cover === null) {
                $stats['skipped']++;
                $stats['errors'][] = "inspiration#{$row->id}:cover_unreachable";
                continue;
            }
            $hubCatId = $this->matchHubCategory($hubCats, (string) ($row->category->name ?? ''));
            if ($hubCatId === null) {
                $stats['skipped']++;
                $stats['errors'][] = "inspiration#{$row->id}:no_hub_category";
                continue;
            }
            try {
                $resp = $this->inspirations->post('/submit', [
                    'hub_category_id' => $hubCatId,
                    'title' => (string) $row->title,
                    'cover_image_url' => $cover,
                    'ref_images' => $this->publicUrls($row->ref_images ?? []),
                    'generation_size' => $row->generation_size,
                    'prompt_cn' => (string) $row->prompt_cn,
                    'prompt_en' => (string) $row->prompt_en,
                    'source_local_id' => (int) $row->id,
                    'site_name' => $this->siteName(),
                ]);
            } catch (RuntimeException $e) {
                $stats['errors'][] = "inspiration#{$row->id}:{$e->getMessage()}";
                continue;
            }
            if ($resp->ok || ($resp->status === 409 && !empty($resp->json['shared_id']))) {
                $row->update([
                    'hub_shared_id' => (int) $resp->json['shared_id'],
                    'hub_status' => (string) ($resp->json['status'] ?? 'pending'),
                    'hub_status_synced_at' => $this->now(),
                ]);
                $stats['pushed']++;
                continue;
            }
            $stats['errors'][] = "inspiration#{$row->id}:{$resp->error()}";
        }

        foreach ($this->listHubItems($this->inspirations, $limit) as $item) {
            $hubId = (int) ($item['id'] ?? 0);
            if ($hubId <= 0) {
                continue;
            }
            if (Inspiration::where('from_hub_inspiration_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            if (Inspiration::where('hub_shared_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            $localCat = $this->ensureInspirationCategory((string) ($item['category_name'] ?? '共享'));
            Inspiration::create([
                'category_id' => $localCat->id,
                'title' => (string) ($item['title'] ?? '未命名'),
                'cover_image' => (string) ($item['cover_image'] ?? ''),
                'ref_images' => $this->asStringList($item['ref_images'] ?? []),
                'generation_size' => $item['generation_size'] ?? null,
                'prompt_cn' => (string) ($item['prompt_cn'] ?? ''),
                'prompt_en' => (string) ($item['prompt_en'] ?? ''),
                'sort_order' => 0,
                'status' => Inspiration::STATUS_APPROVED,
                'is_visible' => true,
                'from_hub_inspiration_id' => $hubId,
                'from_hub_source_site_name' => (string) ($item['source_site_name'] ?? ''),
            ]);
            $stats['pulled']++;
        }

        return $stats;
    }

    /**
     * @return array{pushed:int,pulled:int,skipped:int,errors:string[]}
     */
    public function syncTemplates(int $limit = 200): array
    {
        $stats = $this->emptyStats();
        if (!$this->templates->isReady()) {
            $stats['errors'][] = 'template_hub_not_ready';
            return $stats;
        }

        $hubCats = $this->hubCategories($this->templates);
        $locals = CreativeTemplate::query()
            ->with('category')
            ->where('submission_status', CreativeTemplate::STATUS_APPROVED)
            ->where('is_visible', true)
            ->whereNull('hub_shared_id')
            ->whereNull('from_hub_template_id')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        foreach ($locals as $row) {
            $cover = $this->publicUrl((string) $row->cover_image);
            if ($cover === null) {
                $stats['skipped']++;
                $stats['errors'][] = "template#{$row->id}:cover_unreachable";
                continue;
            }
            $hubCatId = $this->matchHubCategory($hubCats, (string) ($row->category->name ?? ''));
            if ($hubCatId === null) {
                $stats['skipped']++;
                $stats['errors'][] = "template#{$row->id}:no_hub_category";
                continue;
            }
            $sourceImageUrl = '';
            if ((string) $row->source_image !== '') {
                $sourceImageUrl = $this->publicUrl((string) $row->source_image) ?: '';
            }
            try {
                $resp = $this->templates->post('/submit', [
                    'hub_category_id' => $hubCatId,
                    'title' => (string) $row->title,
                    'description' => (string) $row->description,
                    'cover_image_url' => $cover,
                    'example_ref_images' => $this->publicUrls($row->example_ref_images ?? []),
                    'requires_ref_image' => (bool) $row->requires_ref_image,
                    'default_size' => (string) $row->default_size,
                    'prompt_template' => (string) $row->prompt_template,
                    'variables' => is_array($row->variables) ? $row->variables : [],
                    'source_type' => (string) ($row->source_type ?: CreativeTemplate::SOURCE_MANUAL),
                    'source_image_url' => $sourceImageUrl,
                    'source_inspiration_id' => $row->source_inspiration_id,
                    'source_metadata' => is_array($row->source_metadata) ? $row->source_metadata : [],
                    'source_local_id' => (int) $row->id,
                    'site_name' => $this->siteName(),
                ]);
            } catch (RuntimeException $e) {
                $stats['errors'][] = "template#{$row->id}:{$e->getMessage()}";
                continue;
            }
            if ($resp->ok || ($resp->status === 409 && !empty($resp->json['shared_id']))) {
                $row->update([
                    'hub_shared_id' => (int) $resp->json['shared_id'],
                    'hub_status' => (string) ($resp->json['status'] ?? 'pending'),
                    'hub_status_synced_at' => $this->now(),
                ]);
                $stats['pushed']++;
                continue;
            }
            $stats['errors'][] = "template#{$row->id}:{$resp->error()}";
        }

        foreach ($this->listHubItems($this->templates, $limit) as $item) {
            $hubId = (int) ($item['id'] ?? 0);
            if ($hubId <= 0) {
                continue;
            }
            if (CreativeTemplate::where('from_hub_template_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            if (CreativeTemplate::where('hub_shared_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            $localCat = $this->ensureTemplateCategory((string) ($item['category_name'] ?? '共享'));
            CreativeTemplate::create([
                'category_id' => $localCat->id,
                'title' => (string) ($item['title'] ?? '未命名模板'),
                'description' => (string) ($item['description'] ?? ''),
                'cover_image' => (string) ($item['cover_image'] ?? ''),
                'example_ref_images' => $this->asStringList($item['example_ref_images'] ?? []),
                'requires_ref_image' => (bool) ($item['requires_ref_image'] ?? false),
                'default_size' => (string) ($item['default_size'] ?? ''),
                'prompt_template' => (string) ($item['prompt_template'] ?? ''),
                'variables' => is_array($item['variables'] ?? null) ? $item['variables'] : [],
                'source_type' => (string) ($item['source_type'] ?? CreativeTemplate::SOURCE_MANUAL),
                'source_image' => (string) ($item['source_image'] ?? ''),
                'source_inspiration_id' => null,
                'source_metadata' => is_array($item['source_metadata'] ?? null) ? $item['source_metadata'] : [],
                'sort_order' => 0,
                'is_visible' => true,
                'submission_status' => CreativeTemplate::STATUS_APPROVED,
                'published_at' => $this->now(),
                'from_hub_template_id' => $hubId,
                'from_hub_source_site_name' => (string) ($item['source_site_name'] ?? ''),
            ]);
            $stats['pulled']++;
        }

        return $stats;
    }

    /**
     * @return array{pushed:int,pulled:int,skipped:int,errors:string[]}
     */
    public function syncAgents(int $limit = 200): array
    {
        $stats = $this->emptyStats();
        if (!$this->agents->isReady()) {
            $stats['errors'][] = 'agent_hub_not_ready';
            return $stats;
        }

        $hubCats = $this->hubCategories($this->agents);
        $locals = Agent::query()
            ->with('category')
            ->where('submission_status', Agent::STATUS_APPROVED)
            ->where('is_visible', true)
            ->whereNull('hub_shared_id')
            ->whereNull('from_hub_agent_id')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        foreach ($locals as $row) {
            $avatar = (string) $row->avatar !== '' ? ($this->publicUrl((string) $row->avatar) ?: '') : '';
            $hubCatId = $this->matchHubCategory($hubCats, (string) ($row->category->name ?? ''));
            if ($hubCatId === null) {
                $stats['skipped']++;
                $stats['errors'][] = "agent#{$row->id}:no_hub_category";
                continue;
            }
            try {
                $resp = $this->agents->post('/submit', [
                    'hub_category_id' => $hubCatId,
                    'name' => (string) $row->name,
                    'description' => (string) $row->description,
                    'system_prompt' => (string) $row->system_prompt,
                    'tool_skill_ids' => json_encode(is_array($row->tool_skill_ids) ? $row->tool_skill_ids : [], JSON_UNESCAPED_UNICODE),
                    'tool_approval' => (string) $row->tool_approval,
                    'enable_image_gen' => $row->enable_image_gen ? 1 : 0,
                    'tags' => json_encode(is_array($row->tags) ? $row->tags : [], JSON_UNESCAPED_UNICODE),
                    'avatar_url' => $avatar,
                    'source_local_id' => (string) $row->id,
                    'source_site_name' => $this->siteName(),
                ]);
            } catch (RuntimeException $e) {
                $stats['errors'][] = "agent#{$row->id}:{$e->getMessage()}";
                continue;
            }
            if ($resp->ok || ($resp->status === 409 && !empty($resp->json['shared_id']))) {
                $row->update([
                    'hub_shared_id' => (int) $resp->json['shared_id'],
                    'hub_status' => (string) ($resp->json['status'] ?? 'pending'),
                    'hub_status_synced_at' => $this->now(),
                ]);
                $stats['pushed']++;
                continue;
            }
            $stats['errors'][] = "agent#{$row->id}:{$resp->error()}";
        }

        foreach ($this->listHubItems($this->agents, $limit) as $item) {
            $hubId = (int) ($item['id'] ?? 0);
            if ($hubId <= 0) {
                continue;
            }
            if (Agent::where('from_hub_agent_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            if (Agent::where('hub_shared_id', $hubId)->exists()) {
                $stats['skipped']++;
                continue;
            }
            $localCat = $this->ensureAgentCategory((string) ($item['category_name'] ?? '共享'));
            Agent::create([
                'category_id' => $localCat->id,
                'name' => (string) ($item['name'] ?? '未命名智能体'),
                'description' => (string) ($item['description'] ?? ''),
                'avatar' => (string) ($item['avatar'] ?? ''),
                'system_prompt' => (string) ($item['system_prompt'] ?? ''),
                'tool_skill_ids' => $this->asStringList($item['tool_skill_ids'] ?? []),
                'tool_approval' => (string) ($item['tool_approval'] ?? Agent::TOOL_APPROVAL_DESTRUCTIVE),
                'enable_image_gen' => (bool) ($item['enable_image_gen'] ?? false),
                'tags' => $this->asStringList($item['tags'] ?? []),
                'sort_order' => 0,
                'is_visible' => true,
                'submission_status' => Agent::STATUS_APPROVED,
                'source_type' => Agent::SOURCE_ADMIN,
                'published_at' => $this->now(),
                'from_hub_agent_id' => $hubId,
                'from_hub_source_site_name' => (string) ($item['source_site_name'] ?? ''),
            ]);
            $stats['pulled']++;
        }

        return $stats;
    }

    /**
     * @return array{pushed:int,pulled:int,skipped:int,errors:string[]}
     */
    private function emptyStats(): array
    {
        return ['pushed' => 0, 'pulled' => 0, 'skipped' => 0, 'errors' => []];
    }

    /**
     * @return list<array{id:int,name:string}>
     */
    private function hubCategories(SharedHubTransport $hub): array
    {
        $resp = $hub->get('/categories');
        if (!$resp->ok) {
            return [];
        }
        $rows = $resp->json['data'] ?? $resp->json['items'] ?? [];
        $out = [];
        foreach (is_array($rows) ? $rows : [] as $row) {
            if (!is_array($row) || empty($row['id'])) {
                continue;
            }
            $out[] = ['id' => (int) $row['id'], 'name' => (string) ($row['name'] ?? '')];
        }
        return $out;
    }

    /**
     * @param list<array{id:int,name:string}> $hubCats
     */
    private function matchHubCategory(array $hubCats, string $localName): ?int
    {
        $want = trim($localName);
        foreach ($hubCats as $cat) {
            if ($want !== '' && $cat['name'] === $want) {
                return $cat['id'];
            }
        }
        return $hubCats[0]['id'] ?? null;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function listHubItems(SharedHubTransport $hub, int $limit): array
    {
        $items = [];
        $page = 1;
        $perPage = min(60, max(1, $limit));
        while (count($items) < $limit && $page <= 50) {
            $resp = $hub->get('/list', ['page' => $page, 'per_page' => $perPage]);
            if (!$resp->ok) {
                Log::warning('[SharedHubSync] list failed', ['error' => $resp->error(), 'page' => $page]);
                break;
            }
            $chunk = $resp->json['items'] ?? [];
            if (!is_array($chunk) || $chunk === []) {
                break;
            }
            foreach ($chunk as $row) {
                if (is_array($row)) {
                    $items[] = $row;
                }
                if (count($items) >= $limit) {
                    break;
                }
            }
            if (count($chunk) < $perPage) {
                break;
            }
            $page++;
        }
        return $items;
    }

    private function ensureInspirationCategory(string $name): InspirationCategory
    {
        $name = trim($name) !== '' ? trim($name) : '共享';
        return InspirationCategory::firstOrCreate(['name' => $name], ['sort_order' => 0]);
    }

    private function ensureTemplateCategory(string $name): CreativeTemplateCategory
    {
        $name = trim($name) !== '' ? trim($name) : '共享';
        return CreativeTemplateCategory::firstOrCreate(
            ['name' => $name],
            ['description' => '', 'sort_order' => 0, 'is_visible' => true]
        );
    }

    private function ensureAgentCategory(string $name): AgentCategory
    {
        $name = trim($name) !== '' ? trim($name) : '共享';
        return AgentCategory::firstOrCreate(
            ['name' => $name],
            ['description' => '', 'sort_order' => 0, 'is_visible' => true]
        );
    }

    private function siteName(): string
    {
        try {
            return (string) SystemSetting::getValue('site_title', 'Agent Admin');
        } catch (\Throwable $e) {
            return 'Agent Admin';
        }
    }

    private function publicUrl(string $path): ?string
    {
        $path = trim($path);
        if ($path === '') {
            return null;
        }
        if (preg_match('#^https?://#i', $path)) {
            return $path;
        }
        $base = '';
        if (function_exists('config')) {
            $base = rtrim((string) config('app.url', ''), '/');
        }
        if ($base === '') {
            return null;
        }
        return $base . '/' . ltrim($path, '/');
    }

    private function now(): \Illuminate\Support\Carbon
    {
        return function_exists('now') ? now() : \Illuminate\Support\Carbon::now();
    }

    /**
     * @param mixed $items
     * @return list<string>
     */
    private function publicUrls($items): array
    {
        $out = [];
        foreach ($this->asStringList($items) as $item) {
            $url = $this->publicUrl($item);
            if ($url !== null) {
                $out[] = $url;
            }
        }
        return $out;
    }

    /**
     * @param mixed $value
     * @return list<string>
     */
    private function asStringList($value): array
    {
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);
            $value = is_array($decoded) ? $decoded : [$value];
        }
        if (!is_array($value)) {
            return [];
        }
        $out = [];
        foreach ($value as $item) {
            $text = trim((string) $item);
            if ($text !== '') {
                $out[] = $text;
            }
        }
        return $out;
    }
}
