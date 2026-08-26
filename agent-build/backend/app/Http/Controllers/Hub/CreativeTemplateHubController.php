<?php

namespace App\Http\Controllers\Hub;

use App\Http\Controllers\Controller;
use App\Services\Hub\HubReviewerSubmitPolicy;
use App\Services\SystemSetting\SettingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;

class CreativeTemplateHubController extends Controller
{
    private const SETTING_GROUP = 'creative_template_hub';
    private const REASON_CODES = ['invalid_image', 'inappropriate', 'duplicate', 'copyright', 'other'];
    private const SOURCE_TYPES = ['manual', 'image', 'inspiration'];
    private const VARIABLE_TYPES = ['text', 'textarea', 'select', 'multi_select'];

    public function __construct(private SettingService $settings)
    {
    }

    public function me(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $todayUsed = DB::table('shared_creative_templates')
            ->where('source_client_id', $client->client_id)
            ->whereDate('created_at', now()->toDateString())
            ->count();

        return response()->json([
            'client_id' => $client->client_id,
            'is_reviewer' => (bool) ($client->is_hub_reviewer ?? false),
            'approve_threshold' => $this->approveThreshold(),
            'reject_threshold' => $this->rejectThreshold(),
            'report_threshold' => $this->reportThreshold(),
            'submit_daily_limit' => $this->submitDailyLimit(),
            'submit_daily_used' => $todayUsed,
        ]);
    }

    public function categories(): JsonResponse
    {
        $rows = DB::table('shared_creative_template_categories')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'slug', 'sort_order']);

        return response()->json(['data' => $rows]);
    }

    public function list(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_creative_templates as t')
            ->leftJoin('shared_creative_template_categories as c', 't.category_id', '=', 'c.id')
            ->where('t.status', 'approved')
            ->where('t.is_visible', true);

        if ($request->filled('category_id')) {
            $q->where('t.category_id', (int) $request->input('category_id'));
        }
        if ($request->filled('search')) {
            $kw = '%' . trim((string) $request->input('search')) . '%';
            $q->where(function ($w) use ($kw) {
                $w->where('t.title', 'like', $kw)
                    ->orWhere('t.description', 'like', $kw)
                    ->orWhere('t.prompt_template', 'like', $kw);
            });
        }
        if ($request->boolean('exclude_self')) {
            $q->where('t.source_client_id', '!=', $client->client_id);
        }

        $total = (clone $q)->count();
        $sort = (string) $request->query('sort', 'recent');
        if ($sort === 'popular') {
            $q->orderByDesc('t.download_count')->orderByDesc('t.id');
        } else {
            $q->orderByDesc('t.id');
        }
        $rows = $q
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                't.id', 't.category_id', 'c.name as category_name', 'c.slug as category_slug',
                't.title', 't.description', 't.cover_image', 't.example_ref_images', 't.requires_ref_image',
                't.default_size', 't.prompt_template', 't.variables', 't.source_type', 't.source_image',
                't.source_inspiration_id', 't.source_metadata', 't.source_site_name', 't.download_count',
                't.report_count', 't.created_at',
            ]);

        $ids = $rows->pluck('id')->all();
        $myReports = empty($ids) ? [] : DB::table('shared_creative_template_reports')
            ->whereIn('shared_id', $ids)
            ->where('reporter_client_id', $client->client_id)
            ->pluck('shared_id')
            ->all();
        $myReportSet = array_flip($myReports);

        $items = $rows->map(function ($row) use ($myReportSet) {
            $this->decodeTemplateJsonFields($row);
            $row->reported_by_me = isset($myReportSet[$row->id]);
            return $row;
        });

        return response()->json([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ]);
    }

    public function show(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $row = DB::table('shared_creative_templates as t')
            ->leftJoin('shared_creative_template_categories as c', 't.category_id', '=', 'c.id')
            ->where('t.id', $id)
            ->first(['t.*', 'c.name as category_name', 'c.slug as category_slug']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $isOwner = $row->source_client_id === $client->client_id;
        $isReviewer = (bool) ($client->is_hub_reviewer ?? false);
        $publiclyVisible = $row->status === 'approved' && (int) $row->is_visible === 1;
        if (!$publiclyVisible && !$isOwner && !($isReviewer && $row->status === 'pending')) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $myReview = DB::table('shared_creative_template_reviews')
            ->where('shared_id', $id)
            ->where('reviewer_client_id', $client->client_id)
            ->first(['action', 'reason', 'created_at']);
        $reportedByMe = DB::table('shared_creative_template_reports')
            ->where('shared_id', $id)
            ->where('reporter_client_id', $client->client_id)
            ->exists();

        $this->decodeTemplateJsonFields($row);
        $row->my_review_action = $myReview ? $myReview->action : null;
        $row->my_review_reason = $myReview ? $myReview->reason : null;
        $row->reported_by_me = $reportedByMe;

        if ($row->status === 'rejected') {
            $latestReject = DB::table('shared_creative_template_reviews')
                ->where('shared_id', $id)
                ->where('action', 'reject')
                ->orderByDesc('created_at')
                ->first(['reason']);
            $row->latest_reject_reason = $latestReject ? $latestReject->reason : null;
        }

        return response()->json($row);
    }

    public function submit(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
            'title' => ['required', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'cover_image_url' => ['required', 'url', 'max:500'],
            'example_ref_images' => ['nullable', 'array', 'max:8'],
            'example_ref_images.*' => ['url', 'max:500'],
            'requires_ref_image' => ['nullable', 'boolean'],
            'default_size' => ['nullable', 'string', 'max:50'],
            'prompt_template' => ['required', 'string', 'max:20000'],
            'variables' => ['nullable', 'array', 'max:10'],
            'source_type' => ['nullable', 'string', 'in:' . implode(',', self::SOURCE_TYPES)],
            'source_image_url' => ['nullable', 'url', 'max:500'],
            'source_inspiration_id' => ['nullable', 'integer', 'min:1'],
            'source_metadata' => ['nullable', 'array'],
            'source_local_id' => ['required', 'integer', 'min:1'],
            'site_name' => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $categoryExists = DB::table('shared_creative_template_categories')
            ->where('id', $request->input('hub_category_id'))
            ->exists();
        if (!$categoryExists) {
            return response()->json(['error' => 'invalid_hub_category'], 422);
        }

        $sourceLocalId = (int) $request->input('source_local_id');
        $duplicate = DB::table('shared_creative_templates')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $sourceLocalId)
            ->first(['id', 'status']);
        if ($duplicate) {
            return response()->json([
                'error' => 'already_shared',
                'shared_id' => $duplicate->id,
                'status' => $duplicate->status,
            ], 409);
        }

        if (!HubReviewerSubmitPolicy::bypassDailyLimit($client)) {
            $dailyLimit = $this->submitDailyLimit();
            $todayUsed = DB::table('shared_creative_templates')
                ->where('source_client_id', $client->client_id)
                ->whereDate('created_at', now()->toDateString())
                ->count();
            if ($todayUsed >= $dailyLimit) {
                return response()->json([
                    'error' => 'submit_quota_exceeded',
                    'daily_used' => $todayUsed,
                    'daily_limit' => $dailyLimit,
                ], 429);
            }
        }

        $now = now();
        $status = HubReviewerSubmitPolicy::initialStatus($client);
        $exampleRefs = $this->normalizeUrlArray($request->input('example_ref_images', []));
        $variables = $this->normalizeVariables($request->input('variables', []));
        $sourceMetadata = $this->normalizeMetadata($request->input('source_metadata', []));
        $sharedId = DB::table('shared_creative_templates')->insertGetId([
            'category_id' => (int) $request->input('hub_category_id'),
            'title' => trim((string) $request->input('title')),
            'description' => trim((string) $request->input('description', '')),
            'cover_image' => (string) $request->input('cover_image_url'),
            'example_ref_images' => empty($exampleRefs) ? null : json_encode($exampleRefs, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'requires_ref_image' => $request->boolean('requires_ref_image'),
            'default_size' => trim((string) $request->input('default_size', '')),
            'prompt_template' => (string) $request->input('prompt_template'),
            'variables' => empty($variables) ? null : json_encode($variables, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'source_type' => (string) $request->input('source_type', 'manual'),
            'source_image' => (string) $request->input('source_image_url', ''),
            'source_inspiration_id' => $request->input('source_inspiration_id') ?: null,
            'source_metadata' => empty($sourceMetadata) ? null : json_encode($sourceMetadata, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'source_client_id' => $client->client_id,
            'source_local_id' => $sourceLocalId,
            'source_site_name' => trim((string) $request->input('site_name')),
            'status' => $status,
            'reviewed_at' => $status === 'approved' ? $now : null,
            'is_visible' => true,
            'approve_count' => 0,
            'reject_count' => 0,
            'report_count' => 0,
            'download_count' => 0,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        Log::info('[CreativeTemplateHub] submitted', [
            'shared_id' => $sharedId,
            'source_client_id' => $client->client_id,
            'source_local_id' => $sourceLocalId,
        ]);

        return response()->json(['shared_id' => $sharedId, 'status' => $status], 201);
    }

    public function download(Request $request, int $id): JsonResponse
    {
        $row = DB::table('shared_creative_templates')->where('id', $id)->first(['id', 'status', 'is_visible']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($row->status !== 'approved' || (int) $row->is_visible !== 1) {
            return response()->json(['error' => 'not_available'], 409);
        }
        DB::table('shared_creative_templates')->where('id', $id)->increment('download_count');
        return response()->json(['ok' => true]);
    }

    public function report(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'reason_code' => ['required', 'string', 'in:' . implode(',', self::REASON_CODES)],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $threshold = $this->reportThreshold();
        try {
            DB::transaction(function () use ($id, $client, $request, $threshold) {
                $locked = DB::table('shared_creative_templates')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }
                DB::table('shared_creative_template_reports')->insert([
                    'shared_id' => $id,
                    'reporter_client_id' => $client->client_id,
                    'reason_code' => $request->input('reason_code'),
                    'reason_note' => $request->input('reason_note'),
                    'created_at' => now(),
                ]);
                DB::table('shared_creative_templates')->where('id', $id)->increment('report_count');
                $latest = DB::table('shared_creative_templates')->where('id', $id)->first(['report_count', 'is_visible']);
                if ($latest && $latest->report_count >= $threshold && (int) $latest->is_visible === 1) {
                    DB::table('shared_creative_templates')->where('id', $id)->update([
                        'is_visible' => false,
                        'auto_hidden_at' => now(),
                        'updated_at' => now(),
                    ]);
                }
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'already_reported'], 409);
            }
            throw $e;
        }

        $latest = DB::table('shared_creative_templates')->where('id', $id)->first(['report_count', 'is_visible', 'auto_hidden_at']);
        return response()->json([
            'ok' => true,
            'report_count' => (int) $latest->report_count,
            'is_visible' => (bool) $latest->is_visible,
            'auto_hidden' => $latest->auto_hidden_at !== null,
            'threshold' => $threshold,
        ]);
    }

    public function statusBatch(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'shared_ids' => ['required', 'array', 'min:1', 'max:100'],
            'shared_ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique($request->input('shared_ids')));
        $rows = DB::table('shared_creative_templates')
            ->whereIn('id', $ids)
            ->where('source_client_id', $client->client_id)
            ->get([
                'id', 'source_local_id', 'status', 'is_visible', 'approve_count', 'reject_count',
                'report_count', 'auto_hidden_at', 'updated_at',
            ]);

        $rejectedIds = $rows->where('status', 'rejected')->pluck('id')->all();
        $rejectReasonMap = [];
        if (!empty($rejectedIds)) {
            $latestRejects = DB::table('shared_creative_template_reviews as r1')
                ->whereIn('r1.shared_id', $rejectedIds)
                ->where('r1.action', 'reject')
                ->whereNotExists(function ($q) {
                    $q->select(DB::raw(1))
                        ->from('shared_creative_template_reviews as r2')
                        ->whereColumn('r2.shared_id', 'r1.shared_id')
                        ->where('r2.action', 'reject')
                        ->whereColumn('r2.created_at', '>', 'r1.created_at');
                })
                ->get(['r1.shared_id', 'r1.reason']);
            foreach ($latestRejects as $item) {
                $rejectReasonMap[$item->shared_id] = $item->reason;
            }
        }

        return response()->json([
            'items' => $rows->map(function ($row) use ($rejectReasonMap) {
                $row->latest_reject_reason = $rejectReasonMap[$row->id] ?? null;
                return $row;
            }),
        ]);
    }

    public function withdrawBySource(Request $request, int $localId): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $row = DB::table('shared_creative_templates')
            ->where('source_client_id', $client->client_id)
            ->where('source_local_id', $localId)
            ->first(['id']);
        if (!$row) {
            return response()->json(['error' => 'not_found'], 404);
        }
        DB::table('shared_creative_templates')->where('id', $row->id)->delete();
        Log::info('[CreativeTemplateHub] withdrew', [
            'shared_id' => $row->id,
            'source_client_id' => $client->client_id,
            'source_local_id' => $localId,
        ]);
        return response()->json(['ok' => true, 'withdrawn_id' => $row->id]);
    }

    public function pendingList(Request $request): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $perPage = min(60, max(1, (int) $request->query('per_page', 20)));
        $page = max(1, (int) $request->query('page', 1));

        $q = DB::table('shared_creative_templates as t')
            ->leftJoin('shared_creative_template_categories as c', 't.category_id', '=', 'c.id')
            ->where('t.status', 'pending');
        if ($request->filled('category_id')) {
            $q->where('t.category_id', (int) $request->input('category_id'));
        }

        $total = (clone $q)->count();
        $rows = $q->orderBy('t.created_at')
            ->skip(($page - 1) * $perPage)
            ->take($perPage)
            ->get([
                't.id', 't.category_id', 'c.name as category_name', 'c.slug as category_slug',
                't.title', 't.description', 't.cover_image', 't.example_ref_images', 't.requires_ref_image',
                't.default_size', 't.prompt_template', 't.variables', 't.source_type', 't.source_image',
                't.source_metadata', 't.source_site_name', 't.approve_count', 't.reject_count', 't.created_at',
            ]);

        $ids = $rows->pluck('id')->all();
        $myVotes = empty($ids) ? [] : DB::table('shared_creative_template_reviews')
            ->whereIn('shared_id', $ids)
            ->where('reviewer_client_id', $client->client_id)
            ->get(['shared_id', 'action'])
            ->keyBy('shared_id')
            ->map->action
            ->all();

        $items = $rows->map(function ($row) use ($myVotes) {
            $this->decodeTemplateJsonFields($row);
            $row->my_review_action = $myVotes[$row->id] ?? null;
            return $row;
        });

        return response()->json([
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
            'approve_threshold' => $this->approveThreshold(),
            'reject_threshold' => $this->rejectThreshold(),
        ]);
    }

    public function review(Request $request, int $id): JsonResponse
    {
        $client = $request->attributes->get('authorized_client');
        $validator = Validator::make($request->all(), [
            'action' => ['required', 'in:approve,reject'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $action = (string) $request->input('action');
        $reason = trim((string) $request->input('reason', ''));
        if ($action === 'reject' && mb_strlen($reason) < 2) {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['reason' => ['驳回必须填写理由（≥ 2 字）']],
            ], 422);
        }

        $approveThreshold = $this->approveThreshold();
        $rejectThreshold = $this->rejectThreshold();
        try {
            $finalStatus = DB::transaction(function () use ($id, $client, $action, $reason, $approveThreshold, $rejectThreshold) {
                $locked = DB::table('shared_creative_templates')->where('id', $id)->lockForUpdate()->first();
                if (!$locked) {
                    abort(404);
                }
                if ($locked->status !== 'pending') {
                    return ['error' => 'already_settled', 'status' => $locked->status];
                }
                DB::table('shared_creative_template_reviews')->insert([
                    'shared_id' => $id,
                    'reviewer_client_id' => $client->client_id,
                    'action' => $action,
                    'reason' => $reason !== '' ? $reason : null,
                    'created_at' => now(),
                ]);
                DB::table('shared_creative_templates')
                    ->where('id', $id)
                    ->increment($action === 'approve' ? 'approve_count' : 'reject_count');
                $latest = DB::table('shared_creative_templates')->where('id', $id)->first(['approve_count', 'reject_count']);
                if ($latest->reject_count >= $rejectThreshold) {
                    DB::table('shared_creative_templates')->where('id', $id)->update([
                        'status' => 'rejected',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);
                    return ['settled' => 'rejected'];
                }
                if ($latest->approve_count >= $approveThreshold) {
                    DB::table('shared_creative_templates')->where('id', $id)->update([
                        'status' => 'approved',
                        'reviewed_at' => now(),
                        'updated_at' => now(),
                    ]);
                    return ['settled' => 'approved'];
                }
                return ['settled' => null];
            });
        } catch (\Illuminate\Database\QueryException $e) {
            if (($e->errorInfo[1] ?? null) === 1062) {
                return response()->json(['error' => 'already_voted'], 409);
            }
            throw $e;
        }

        if (isset($finalStatus['error'])) {
            return response()->json($finalStatus, 409);
        }

        $latest = DB::table('shared_creative_templates')->where('id', $id)->first(['status', 'approve_count', 'reject_count']);
        return response()->json([
            'ok' => true,
            'my_action' => $action,
            'shared_status' => $latest->status,
            'approve_count' => (int) $latest->approve_count,
            'reject_count' => (int) $latest->reject_count,
            'approve_threshold' => $approveThreshold,
            'reject_threshold' => $rejectThreshold,
            'settled' => $finalStatus['settled'] ?? null,
        ]);
    }

    private function approveThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'approve_threshold', 3));
    }

    private function rejectThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'reject_threshold', 2));
    }

    private function reportThreshold(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'report_threshold', 5));
    }

    private function submitDailyLimit(): int
    {
        return max(1, (int) $this->settings->get(self::SETTING_GROUP, 'submit_daily_limit', 20));
    }

    private function decodeTemplateJsonFields(object $row): void
    {
        $row->example_ref_images = $this->decodeUrlArray($row->example_ref_images ?? null);
        $row->variables = $this->decodeVariables($row->variables ?? null);
        $row->source_metadata = $this->decodeMetadata($row->source_metadata ?? null);
    }

    private function decodeUrlArray($value): array
    {
        if (is_array($value)) {
            return $this->normalizeUrlArray($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return $this->normalizeUrlArray(is_array($decoded) ? $decoded : []);
    }

    private function normalizeUrlArray(array $value): array
    {
        $items = [];
        foreach (array_slice($value, 0, 8) as $item) {
            if (is_array($item)) {
                $item = $item['url'] ?? '';
            }
            $url = trim((string) $item);
            if ($url !== '') {
                $items[] = $url;
            }
        }
        return array_values(array_unique($items));
    }

    private function decodeVariables($value): array
    {
        if (is_array($value)) {
            return $this->normalizeVariables($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return $this->normalizeVariables(is_array($decoded) ? $decoded : []);
    }

    private function normalizeVariables($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        $result = [];
        foreach ($value as $item) {
            if (!is_array($item)) {
                continue;
            }
            $key = trim((string) ($item['key'] ?? ''));
            $type = (string) ($item['type'] ?? 'text');
            if ($key === '' || !in_array($type, self::VARIABLE_TYPES, true)) {
                continue;
            }
            $options = [];
            if (isset($item['options']) && is_array($item['options'])) {
                foreach (array_slice($item['options'], 0, 20) as $option) {
                    $valueText = trim((string) (is_array($option) ? ($option['label'] ?? $option['value'] ?? '') : $option));
                    if ($valueText !== '') {
                        $options[] = mb_substr($valueText, 0, 50);
                    }
                }
            }
            $result[] = [
                'key' => mb_substr($key, 0, 50),
                'label' => mb_substr(trim((string) ($item['label'] ?? $key)), 0, 50),
                'type' => $type,
                'required' => (bool) ($item['required'] ?? true),
                'placeholder' => mb_substr(trim((string) ($item['placeholder'] ?? '')), 0, 120),
                'default' => mb_substr(trim((string) ($item['default'] ?? '')), 0, 500),
                'options' => array_values(array_unique($options)),
            ];
            if (count($result) >= 10) {
                break;
            }
        }
        return $result;
    }

    private function decodeMetadata($value): array
    {
        if (is_array($value)) {
            return $this->normalizeMetadata($value);
        }
        if (!is_string($value) || trim($value) === '') {
            return [];
        }
        $decoded = json_decode($value, true);
        return $this->normalizeMetadata(is_array($decoded) ? $decoded : []);
    }

    private function normalizeMetadata($value): array
    {
        if (!is_array($value)) {
            return [];
        }
        return array_slice($value, 0, 30, true);
    }
}
