<?php

namespace App\Http\Controllers;

use App\Models\CreativeTemplate;
use App\Models\CreativeTemplateCategory;
use App\Models\Inspiration;
use App\Models\SystemSetting;
use App\Services\CreativeTemplateAiService;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CreativeTemplateController extends Controller
{
    private const SUBDIR = 'creative-templates';
    private const MAX_BYTES = 8 * 1024 * 1024;

    public function __construct(private CreativeTemplateAiService $aiService)
    {
    }

    public function aiModels(): JsonResponse
    {
        return response()->json(['data' => $this->aiService->availableModels()]);
    }

    public function categoryIndex(): JsonResponse
    {
        $categories = CreativeTemplateCategory::withCount('templates')
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json(['data' => $categories]);
    }

    public function categoryStore(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category = CreativeTemplateCategory::create([
            'name' => (string) $request->input('name', ''),
            // description 列是 NOT NULL DEFAULT ''；前端可能传 null，必须 cast，否则触发 SQL 1048
            'description' => (string) ($request->input('description') ?? ''),
            'sort_order' => (int) ($request->input('sort_order') ?? 0),
            'is_visible' => $request->has('is_visible') ? $request->boolean('is_visible') : true,
        ]);

        return response()->json($category, 201);
    }

    public function categoryUpdate(Request $request, int $id): JsonResponse
    {
        $category = CreativeTemplateCategory::find($id);
        if (!$category) return response()->json(['error' => 'not_found'], 404);

        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category->update([
            'name' => (string) $request->input('name', $category->name),
            // 同 categoryStore：description NOT NULL，强制 cast 兜底
            'description' => (string) ($request->input('description') ?? ''),
            'sort_order' => (int) ($request->input('sort_order') ?? $category->sort_order),
            'is_visible' => $request->has('is_visible') ? $request->boolean('is_visible') : $category->is_visible,
        ]);

        return response()->json($category);
    }

    public function categoryDestroy(int $id): JsonResponse
    {
        $category = CreativeTemplateCategory::find($id);
        if (!$category) return response()->json(['error' => 'not_found'], 404);
        foreach ($category->templates as $template) {
            $this->deleteTemplateFiles($template);
        }
        $category->delete();
        return response()->json(['ok' => true]);
    }

    public function index(Request $request): JsonResponse
    {
        $query = CreativeTemplate::with(['category', 'submittedBy'])
            ->orderBy('sort_order')
            ->orderByDesc('id');

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }
        if ($request->filled('is_visible') && $request->input('is_visible') !== '') {
            $query->where('is_visible', $request->boolean('is_visible'));
        }
        if ($request->filled('source_type')) {
            $query->where('source_type', $request->input('source_type'));
        }
        if ($request->filled('submission_status')) {
            $query->where('submission_status', $request->input('submission_status'));
        }
        if ($request->filled('uploader_keyword')) {
            $k = (string) $request->input('uploader_keyword');
            $query->where(function ($q) use ($k) {
                $q->where('submitted_by_nickname', 'like', "%{$k}%")
                    ->orWhereIn('submitted_by_user_id', function ($sub) use ($k) {
                        $sub->select('id')->from('users')
                            ->where('username', 'like', "%{$k}%")
                            ->orWhere('nickname', 'like', "%{$k}%");
                    });
            });
        }
        if ($request->filled('search')) {
            $s = (string) $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('title', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%")
                    ->orWhere('prompt_template', 'like', "%{$s}%");
            });
        }

        $perPage = min((int) $request->input('per_page', 20), 100);
        return response()->json($query->paginate($perPage));
    }

    public function show(int $id): JsonResponse
    {
        $template = CreativeTemplate::with(['category', 'sourceInspiration', 'submittedBy'])->find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        return response()->json($template);
    }

    public function store(Request $request): JsonResponse
    {
        return response()->json([
            'error' => 'deprecated',
            'message' => '创意模板创建已迁移到桌面端，请通过桌面端投稿。',
        ], 410);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        return response()->json([
            'error' => 'deprecated',
            'message' => '创意模板编辑已迁移到桌面端，请在桌面端修改后重新投稿。',
        ], 410);
    }

    public function destroy(int $id): JsonResponse
    {
        $template = CreativeTemplate::find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        $this->deleteTemplateFiles($template);
        $template->delete();
        return response()->json(['ok' => true]);
    }

    public function batchDestroy(Request $request): JsonResponse
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $request->input('ids', [])))));
        if (!$ids) return response()->json(['error' => 'ids 不能为空'], 400);
        if (count($ids) > 200) return response()->json(['error' => '单次批量操作不超过 200 条'], 400);

        $deleted = 0;
        foreach (CreativeTemplate::whereIn('id', $ids)->get() as $template) {
            $this->deleteTemplateFiles($template);
            $template->delete();
            $deleted++;
        }
        return response()->json(['deleted' => $deleted, 'total' => count($ids)]);
    }

    public function clientSubmit(Request $request): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);
        if (!$user->inspiration_uploader) {
            return response()->json(['error' => 'forbidden', 'message' => '当前账号未开启灵感大王权限'], 403);
        }

        $validator = $this->templateValidator($request, true);
        $validator->addRules([
            'local_template_id' => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $localId = (string) $request->input('local_template_id');
        $existing = CreativeTemplate::where('submitted_by_user_id', $user->id)
            ->where('source_local_template_id', $localId)
            ->whereIn('submission_status', [CreativeTemplate::STATUS_PENDING, CreativeTemplate::STATUS_APPROVED])
            ->first();
        if ($existing) {
            return response()->json([
                'error' => 'already_submitted',
                'cloud_template_id' => $existing->id,
                'submission_status' => $existing->submission_status,
            ], 409);
        }

        $coverUrl = $request->hasFile('cover_image') ? $this->uploadFile($request->file('cover_image')) : (string) $request->input('cover_image_url', '');
        $sourceImage = $request->hasFile('source_image') ? $this->uploadFile($request->file('source_image')) : (string) $request->input('source_image_url', '');
        $coverThumb = $request->hasFile('cover_thumb') ? (string) $this->uploadFile($request->file('cover_thumb')) : '';
        $exampleRefs = $this->mergeExampleRefs([], $request);
        if ($coverUrl === null || $sourceImage === null || $exampleRefs === null) {
            return response()->json(['error' => 'upload_failed'], 500);
        }

        $skipAudit = (bool) SystemSetting::getValue('inspiration_skip_audit', false);
        $status = $skipAudit ? CreativeTemplate::STATUS_APPROVED : CreativeTemplate::STATUS_PENDING;
        $now = now();
        $variables = $this->parseJsonArray($request->input('variables', []));

        $template = CreativeTemplate::create([
            'category_id' => $request->input('category_id'),
            'title' => $request->input('title'),
            'description' => $request->input('description', ''),
            'cover_image' => $coverUrl ?: ($exampleRefs[0] ?? ''),
            'cover_thumb' => $coverThumb,
            'example_ref_images' => $exampleRefs,
            'requires_ref_image' => $request->boolean('requires_ref_image'),
            'default_size' => (string) $request->input('default_size', ''),
            'prompt_template' => (string) $request->input('prompt_template'),
            'variables' => $variables,
            'source_type' => $request->input('source_type', CreativeTemplate::SOURCE_MANUAL),
            'source_image' => $sourceImage ?: '',
            'source_inspiration_id' => $request->input('source_inspiration_id') ?: null,
            'sort_order' => 0,
            'is_visible' => $skipAudit,
            'created_by_user_id' => $user->id,
            'submission_status' => $status,
            'submitted_by_user_id' => $user->id,
            'submitted_by_nickname' => $user->nickname ?: $user->username,
            'reviewed_by_user_id' => $skipAudit ? $user->id : null,
            'reviewed_at' => $skipAudit ? $now : null,
            'source_local_template_id' => $localId,
            'submitted_at' => $now,
            'published_at' => $skipAudit ? $now : null,
        ]);

        return response()->json([
            'ok' => true,
            'local_template_id' => $localId,
            'cloud_template_id' => (int) $template->id,
            'submission_status' => $template->submission_status,
        ], 201);
    }

    public function clientStatusBatch(Request $request): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'string', 'max:100'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $ids = array_values(array_unique(array_map('strval', $request->input('ids', []))));
        $rows = CreativeTemplate::where('submitted_by_user_id', $user->id)
            ->whereIn('source_local_template_id', $ids)
            ->orderByDesc('id')
            ->get();

        $seen = [];
        $items = [];
        foreach ($rows as $row) {
            $localId = (string) $row->source_local_template_id;
            if ($localId === '' || isset($seen[$localId])) continue;
            $seen[$localId] = true;
            $items[] = [
                'local_template_id' => $localId,
                'cloud_template_id' => (int) $row->id,
                'submission_status' => (string) $row->submission_status,
                'reject_reason' => (string) $row->reject_reason,
                'reviewed_at' => optional($row->reviewed_at)->toIso8601String(),
                'published_at' => optional($row->published_at)->toIso8601String(),
            ];
        }

        return response()->json(['items' => $items]);
    }

    public function clientWithdraw(string $localId): JsonResponse
    {
        $user = auth()->user();
        if (!$user) return response()->json(['error' => 'unauthenticated'], 401);

        $template = CreativeTemplate::where('submitted_by_user_id', $user->id)
            ->where('source_local_template_id', $localId)
            ->whereIn('submission_status', [CreativeTemplate::STATUS_PENDING, CreativeTemplate::STATUS_REJECTED])
            ->orderByDesc('id')
            ->first();
        if (!$template) return response()->json(['error' => 'not_found'], 404);

        $template->update([
            'submission_status' => CreativeTemplate::STATUS_WITHDRAWN,
            'is_visible' => false,
        ]);

        return response()->json(['ok' => true, 'local_template_id' => $localId]);
    }

    public function approve(int $id): JsonResponse
    {
        $template = CreativeTemplate::find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        if ($template->submission_status === CreativeTemplate::STATUS_WITHDRAWN) {
            return response()->json(['error' => 'withdrawn', 'message' => '已撤回的模板不能通过审核'], 409);
        }

        $template->update([
            'submission_status' => CreativeTemplate::STATUS_APPROVED,
            'is_visible' => true,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'reject_reason' => '',
            'published_at' => now(),
        ]);

        return response()->json($template->load(['category', 'submittedBy']));
    }

    public function reject(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $template = CreativeTemplate::find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);

        $template->update([
            'submission_status' => CreativeTemplate::STATUS_REJECTED,
            'is_visible' => false,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'reject_reason' => (string) $request->input('reason', ''),
        ]);

        return response()->json($template->load(['category', 'submittedBy']));
    }

    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $template = CreativeTemplate::find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        if ($request->boolean('is_visible') && $template->submission_status !== CreativeTemplate::STATUS_APPROVED) {
            return response()->json(['error' => 'not_approved', 'message' => '仅审核通过的模板可以上架'], 409);
        }
        $template->update(['is_visible' => $request->boolean('is_visible')]);
        return response()->json($template->load(['category', 'submittedBy']));
    }

    public function setSortOrder(Request $request, int $id): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'sort_order' => ['required', 'integer', 'min:0', 'max:999999'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $template = CreativeTemplate::find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        $template->update(['sort_order' => (int) $request->input('sort_order', 0)]);
        return response()->json($template->load(['category', 'submittedBy']));
    }

    public function analyzePrompt(Request $request): JsonResponse
    {
        return response()->json([
            'error' => 'deprecated',
            'message' => '创意模板草稿生成已迁移到桌面端。',
        ], 410);
    }

    public function reverseImage(Request $request): JsonResponse
    {
        return response()->json([
            'error' => 'deprecated',
            'message' => '创意模板图片反推已迁移到桌面端。',
        ], 410);
    }

    public function draftFromInspiration(Request $request): JsonResponse
    {
        return response()->json([
            'error' => 'deprecated',
            'message' => '创意模板灵感转草稿已迁移到桌面端。',
        ], 410);
    }

    private function templateValidator(Request $request, bool $creating)
    {
        return Validator::make($request->all(), [
            'category_id' => [$creating ? 'required' : 'nullable', 'integer', 'exists:creative_template_categories,id'],
            'title' => [$creating ? 'required' : 'nullable', 'string', 'max:100'],
            'description' => ['nullable', 'string', 'max:500'],
            'prompt_template' => [$creating ? 'required' : 'nullable', 'string', 'max:20000'],
            'variables' => ['nullable'],
            'requires_ref_image' => ['nullable', 'boolean'],
            'default_size' => ['nullable', 'string', 'max:50'],
            'source_type' => ['nullable', 'in:manual,image,inspiration'],
            'source_inspiration_id' => ['nullable', 'integer', 'exists:inspirations,id'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'is_visible' => ['nullable', 'boolean'],
            'cover_image' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int) (self::MAX_BYTES / 1024)],
            'cover_thumb' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:2048'],
            'source_image' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int) (self::MAX_BYTES / 1024)],
            'example_ref_images' => ['nullable', 'array', 'max:8'],
            'example_ref_images.*' => ['file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int) (self::MAX_BYTES / 1024)],
            'example_ref_image_urls' => ['nullable'],
            'existing_example_ref_images' => ['nullable'],
            'cover_image_url' => ['nullable', 'string', 'max:500'],
            'source_image_url' => ['nullable', 'string', 'max:500'],
        ]);
    }

    private function uploadFile(UploadedFile $file): ?string
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) $ext = 'png';
        return StorageService::upload($file, self::SUBDIR, (string) Str::uuid() . '.' . $ext);
    }

    private function uploadRefImages(Request $request): ?array
    {
        if (!$request->hasFile('example_ref_images')) return [];
        $files = $request->file('example_ref_images');
        if ($files instanceof UploadedFile) $files = [$files];
        if (!is_array($files)) return [];

        $urls = [];
        foreach (array_slice($files, 0, 8) as $file) {
            if (!$file instanceof UploadedFile) continue;
            $url = $this->uploadFile($file);
            if (!$url) {
                foreach ($urls as $saved) StorageService::delete($saved);
                return null;
            }
            $urls[] = $url;
        }
        return $urls;
    }

    private function mergeExampleRefs(array $current, Request $request): ?array
    {
        $kept = $request->has('existing_example_ref_images')
            ? $this->parseUrlArray($request->input('existing_example_ref_images'))
            : $this->normalizeUrlArray($current);
        $addedUrls = $this->parseUrlArray($request->input('example_ref_image_urls', []));
        $uploaded = $this->uploadRefImages($request);
        if ($uploaded === null) return null;
        return array_values(array_slice(array_unique(array_merge($kept, $addedUrls, $uploaded)), 0, 8));
    }

    private function parseJsonArray($value): array
    {
        if (is_array($value)) return $value;
        if (!is_string($value) || trim($value) === '') return [];
        $decoded = json_decode($value, true);
        return is_array($decoded) ? $decoded : [];
    }

    private function parseUrlArray($value): array
    {
        return $this->normalizeUrlArray($this->parseJsonArray($value));
    }

    private function normalizeUrlArray(array $value): array
    {
        $items = [];
        foreach ($value as $item) {
            if (is_array($item)) $item = $item['url'] ?? '';
            $url = trim((string) $item);
            if ($url !== '') $items[] = $url;
        }
        return array_values(array_unique($items));
    }

    private function deleteRemovedRefs(array $oldRefs, array $newRefs): void
    {
        $newSet = array_flip($this->normalizeUrlArray($newRefs));
        foreach ($this->normalizeUrlArray($oldRefs) as $url) {
            if (!isset($newSet[$url])) $this->deleteTemplateStorageFile($url);
        }
    }

    private function deleteTemplateFiles(CreativeTemplate $template): void
    {
        if ($template->cover_image) $this->deleteTemplateStorageFile((string) $template->cover_image);
        if ($template->cover_thumb) $this->deleteTemplateStorageFile((string) $template->cover_thumb);
        if ($template->source_image) $this->deleteTemplateStorageFile((string) $template->source_image);
        foreach ($this->normalizeUrlArray(is_array($template->example_ref_images) ? $template->example_ref_images : []) as $url) {
            $this->deleteTemplateStorageFile($url);
        }
    }

    private function deleteTemplateStorageFile(string $url): void
    {
        $path = $url;
        if (str_starts_with($url, 'http://') || str_starts_with($url, 'https://')) {
            $path = (string) (parse_url($url, PHP_URL_PATH) ?: '');
        }
        if (str_starts_with(ltrim($path, '/'), self::SUBDIR . '/')) {
            StorageService::delete($url);
        }
    }
}
