<?php

namespace App\Http\Controllers;

use App\Models\Inspiration;
use App\Models\InspirationCategory;
use App\Models\SystemSetting;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class InspirationController extends Controller
{
    private const SUBDIR = 'inspirations';
    private const MAX_BYTES = 5 * 1024 * 1024;

    // ===== Config =====

    public function getConfig(): JsonResponse
    {
        return response()->json([
            // 免审开关：true = 桌面端上传直接 approved；false 默认 pending
            'skip_audit' => (bool) SystemSetting::getValue('inspiration_skip_audit', false),
        ]);
    }

    public function updateConfig(Request $request): JsonResponse
    {
        // 当前只剩 skip_audit 一个开关；接受可选字段增量更新。
        $validator = Validator::make($request->all(), [
            'skip_audit' => ['nullable', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        if ($request->has('skip_audit')) {
            SystemSetting::setValue('inspiration_skip_audit', $request->boolean('skip_audit'));
        }

        return $this->getConfig();
    }

    // ===== Categories =====

    public function categoryIndex(): JsonResponse
    {
        $categories = InspirationCategory::orderBy('sort_order')
            ->orderBy('id')
            ->get();

        return response()->json(['data' => $categories]);
    }

    public function categoryStore(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category = InspirationCategory::create([
            'name' => $request->input('name'),
            'sort_order' => $request->input('sort_order', 0),
        ]);

        return response()->json($category, 201);
    }

    public function categoryUpdate(Request $request, int $id): JsonResponse
    {
        $category = InspirationCategory::find($id);
        if (!$category) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'name' => ['required', 'string', 'max:50'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $category->update([
            'name' => $request->input('name'),
            'sort_order' => $request->input('sort_order', $category->sort_order),
        ]);

        return response()->json($category);
    }

    public function categoryDestroy(int $id): JsonResponse
    {
        $category = InspirationCategory::find($id);
        if (!$category) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $category->delete();

        return response()->json(['ok' => true]);
    }

    // ===== Inspirations =====

    public function index(Request $request): JsonResponse
    {
        $query = Inspiration::with('category')
            ->orderBy('sort_order')
            ->orderByDesc('id');

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }

        if ($request->filled('search')) {
            $s = $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('title', 'like', "%{$s}%")
                  ->orWhere('prompt_cn', 'like', "%{$s}%")
                  ->orWhere('prompt_en', 'like', "%{$s}%");
            });
        }

        // 按上传者搜索（匹配 uploader_nickname 快照 + 关联 users 表的 username / nickname）。
        // 同时匹配 uploader_nickname 的原因：若上传后用户改了昵称，快照仍保留原值；
        // 同时关联 users 表是为了按当前最新的用户名 / 昵称也能搜到。
        if ($request->filled('uploader_keyword')) {
            $k = (string) $request->input('uploader_keyword');
            $query->where(function ($q) use ($k) {
                $q->where('uploader_nickname', 'like', "%{$k}%")
                    ->orWhereIn('uploader_user_id', function ($sub) use ($k) {
                        $sub->select('id')->from('users')
                            ->where('username', 'like', "%{$k}%")
                            ->orWhere('nickname', 'like', "%{$k}%");
                    });
            });
        }

        // 审核状态筛选：pending / approved / rejected
        if ($request->filled('status')) {
            $query->where('status', $request->input('status'));
        }
        // 可见性筛选
        if ($request->filled('is_visible') && $request->input('is_visible') !== '') {
            $query->where('is_visible', $request->boolean('is_visible'));
        }

        $perPage = min((int) $request->input('per_page', 20), 100);
        $paginated = $query->paginate($perPage);

        return response()->json($paginated);
    }

    public function store(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'category_id' => ['required', 'integer', 'exists:inspiration_categories,id'],
            'title' => ['required', 'string', 'max:100'],
            'prompt_cn' => ['nullable', 'string', 'max:5000'],
            'prompt_en' => ['nullable', 'string', 'max:5000'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'generation_size' => ['nullable', 'string', 'max:50'],
            'cover_image' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
            'cover_thumb' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:2048'],
            'ref_images' => ['nullable', 'array', 'max:8'],
            'ref_images.*' => ['file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        // 中英文提示词至少填写一个
        $promptCn = trim((string) $request->input('prompt_cn', ''));
        $promptEn = trim((string) $request->input('prompt_en', ''));
        if ($promptCn === '' && $promptEn === '') {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['prompt_cn' => ['中英文提示词至少填写一个']],
            ], 422);
        }

        $coverUrl = '';
        if ($request->hasFile('cover_image')) {
            $coverUrl = $this->uploadFile($request->file('cover_image'));
            if (!$coverUrl) {
                return response()->json(['error' => 'upload_failed'], 500);
            }
        }
        $coverThumb = $request->hasFile('cover_thumb') ? (string) $this->uploadFile($request->file('cover_thumb')) : '';

        $refImages = $this->uploadRefImages($request);
        if ($refImages === null) {
            if ($coverUrl) {
                StorageService::delete($coverUrl);
            }
            if ($coverThumb) {
                StorageService::delete($coverThumb);
            }
            return response()->json(['error' => 'upload_failed'], 500);
        }

        $item = Inspiration::create([
            'category_id' => $request->input('category_id'),
            'title' => $request->input('title'),
            'cover_image' => $coverUrl,
            'cover_thumb' => $coverThumb,
            'ref_images' => $refImages,
            'generation_size' => $this->normalizeGenerationSize($request->input('generation_size')),
            'prompt_cn' => $request->input('prompt_cn', ''),
            'prompt_en' => $request->input('prompt_en', ''),
            'sort_order' => $request->input('sort_order', 0),
            // 管理员后台手工录入：直接通过审核 + 可见
            'status' => Inspiration::STATUS_APPROVED,
            'is_visible' => true,
        ]);

        $item->load('category');

        return response()->json($item, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $item = Inspiration::find($id);
        if (!$item) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $validator = Validator::make($request->all(), [
            'category_id' => ['required', 'integer', 'exists:inspiration_categories,id'],
            'title' => ['required', 'string', 'max:100'],
            'prompt_cn' => ['nullable', 'string', 'max:5000'],
            'prompt_en' => ['nullable', 'string', 'max:5000'],
            'sort_order' => ['nullable', 'integer', 'min:0'],
            'generation_size' => ['nullable', 'string', 'max:50'],
            'cover_image' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
            'cover_thumb' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:2048'],
            'existing_ref_images' => ['nullable', 'string'],
            'ref_images' => ['nullable', 'array', 'max:8'],
            'ref_images.*' => ['file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        // 中英文提示词至少填写一个
        $promptCn = trim((string) $request->input('prompt_cn', ''));
        $promptEn = trim((string) $request->input('prompt_en', ''));
        if ($promptCn === '' && $promptEn === '') {
            return response()->json([
                'error' => 'validation_failed',
                'details' => ['prompt_cn' => ['中英文提示词至少填写一个']],
            ], 422);
        }

        $data = [
            'category_id' => $request->input('category_id'),
            'title' => $request->input('title'),
            'prompt_cn' => $request->input('prompt_cn', ''),
            'prompt_en' => $request->input('prompt_en', ''),
            'sort_order' => $request->input('sort_order', $item->sort_order),
            'generation_size' => $this->normalizeGenerationSize($request->input('generation_size')),
        ];

        if ($request->hasFile('cover_image')) {
            $coverUrl = $this->uploadFile($request->file('cover_image'));
            if (!$coverUrl) {
                return response()->json(['error' => 'upload_failed'], 500);
            }
            // 替换封面：同步删旧文件（best-effort）
            if ($item->cover_image && $item->cover_image !== $coverUrl) {
                StorageService::delete($item->cover_image);
            }
            $data['cover_image'] = $coverUrl;
            // 缩略图随封面一起替换：有新缩略图则换入，旧缩略图删除（无新图则清空，前端回退原图）
            $newThumb = $request->hasFile('cover_thumb') ? (string) $this->uploadFile($request->file('cover_thumb')) : '';
            if ($item->cover_thumb && $item->cover_thumb !== $newThumb) {
                StorageService::delete($item->cover_thumb);
            }
            $data['cover_thumb'] = $newThumb;
        } elseif ($request->input('remove_cover') === '1') {
            // 移除封面：同步删旧文件
            if ($item->cover_image) {
                StorageService::delete($item->cover_image);
            }
            $data['cover_image'] = '';
            if ($item->cover_thumb) {
                StorageService::delete($item->cover_thumb);
            }
            $data['cover_thumb'] = '';
        }

        if ($request->has('existing_ref_images') || $request->hasFile('ref_images')) {
            $keptRefImages = $this->parseExistingRefImages($request->input('existing_ref_images'), $item->ref_images ?? []);
            $newRefImages = $this->uploadRefImages($request);
            if ($newRefImages === null) {
                return response()->json(['error' => 'upload_failed'], 500);
            }
            $oldRefImages = $this->normalizeRefImages($item->ref_images ?? []);
            foreach (array_diff($oldRefImages, $keptRefImages) as $removedRefImage) {
                StorageService::delete($removedRefImage);
            }
            $data['ref_images'] = array_values(array_slice(array_merge($keptRefImages, $newRefImages), 0, 8));
        }

        $item->update($data);
        $item->load('category');

        return response()->json($item);
    }

    public function destroy(int $id): JsonResponse
    {
        $item = Inspiration::find($id);
        if (!$item) {
            return response()->json(['error' => 'not_found'], 404);
        }

        // 先删存储里的封面文件（best-effort，失败仅记 warning 不阻断主流程）
        if ($item->cover_image) {
            StorageService::delete($item->cover_image);
        }
        if ($item->cover_thumb) {
            StorageService::delete($item->cover_thumb);
        }
        $this->deleteRefImages($item->ref_images ?? []);
        $item->delete();

        return response()->json(['ok' => true]);
    }

    public function batchDestroy(Request $request): JsonResponse
    {
        $ids = $request->input('ids', []);
        if (empty($ids)) {
            return response()->json(['error' => 'no_ids'], 422);
        }

        // 先取出各行的 cover_image 逐个清存储，再批删数据库
        $items = Inspiration::whereIn('id', $ids)->get(['id', 'cover_image', 'cover_thumb', 'ref_images']);
        foreach ($items as $row) {
            if ($row->cover_image) {
                StorageService::delete($row->cover_image);
            }
            if ($row->cover_thumb) {
                StorageService::delete($row->cover_thumb);
            }
            $this->deleteRefImages($row->ref_images ?? []);
        }
        Inspiration::whereIn('id', $ids)->delete();

        return response()->json(['ok' => true]);
    }

    // ===== Audit (管理员审核 + 显示开关) =====

    /**
     * 通过审核：status -> approved
     * 桌面端 publicList 立即可见（前提 is_visible=true）
     */
    public function approve(int $id): JsonResponse
    {
        $item = Inspiration::find($id);
        if (!$item) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $item->update(['status' => Inspiration::STATUS_APPROVED]);
        $item->load('category');
        return response()->json($item);
    }

    /**
     * 拒绝审核：status -> rejected
     * 桌面端不可见（无论 is_visible 如何），后续可单条删除（会同步清存储文件）
     */
    public function reject(int $id): JsonResponse
    {
        $item = Inspiration::find($id);
        if (!$item) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $item->update(['status' => Inspiration::STATUS_REJECTED]);
        $item->load('category');
        return response()->json($item);
    }

    /**
     * 切换显示开关：is_visible
     * 即使 status=approved，is_visible=false 时桌面端也不显示（临时下架）
     * body: { is_visible: bool }
     */
    public function setVisibility(Request $request, int $id): JsonResponse
    {
        $item = Inspiration::find($id);
        if (!$item) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $validator = Validator::make($request->all(), [
            'is_visible' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $item->update(['is_visible' => $request->boolean('is_visible')]);
        $item->load('category');
        return response()->json($item);
    }

    // ===== Client API (登录用户上传) =====

    /**
     * 桌面端用户上传创作到灵感广场。
     * 鉴权：auth:api + user.inspiration_uploader = true（「灵感大王」权限）
     */
    public function clientUpload(Request $request): JsonResponse
    {
        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }
        if (!$user->inspiration_uploader) {
            return response()->json(['error' => 'forbidden', 'message' => '当前账号未开启灵感大王权限'], 403);
        }

        $validator = Validator::make($request->all(), [
            'category_id' => ['required', 'integer', 'exists:inspiration_categories,id'],
            'title' => ['required', 'string', 'max:100'],
            'prompt_lang' => ['required', 'in:cn,en'],
            'prompt_text' => ['required', 'string', 'max:5000'],
            'generation_size' => ['nullable', 'string', 'max:50'],
            'cover_image' => ['required', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
            'cover_thumb' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:2048'],
            'ref_images' => ['nullable', 'array', 'max:8'],
            'ref_images.*' => ['file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int)(self::MAX_BYTES / 1024)],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $coverUrl = $this->uploadFile($request->file('cover_image'));
        if (!$coverUrl) {
            return response()->json(['error' => 'upload_failed'], 500);
        }
        $coverThumb = $request->hasFile('cover_thumb') ? (string) $this->uploadFile($request->file('cover_thumb')) : '';

        $refImages = $this->uploadRefImages($request);
        if ($refImages === null) {
            StorageService::delete($coverUrl);
            if ($coverThumb) {
                StorageService::delete($coverThumb);
            }
            return response()->json(['error' => 'upload_failed'], 500);
        }

        $lang = $request->input('prompt_lang');
        $text = (string) $request->input('prompt_text', '');

        // 免审开关（系统设置 → 灵感数据 → 免审）决定上传后的初始状态：
        //   true  → 直接 approved（带桌面端立即可见）
        //   false → pending 走审核流
        $skipAudit = (bool) SystemSetting::getValue('inspiration_skip_audit', false);

        $item = Inspiration::create([
            'category_id' => (int) $request->input('category_id'),
            'title' => $request->input('title'),
            'cover_image' => $coverUrl,
            'cover_thumb' => $coverThumb,
            'ref_images' => $refImages,
            'generation_size' => $this->normalizeGenerationSize($request->input('generation_size')),
            'prompt_cn' => $lang === 'cn' ? $text : '',
            'prompt_en' => $lang === 'en' ? $text : '',
            'sort_order' => 0,
            'uploader_user_id' => $user->id,
            'uploader_nickname' => $user->nickname ?: $user->username,
            'status' => $skipAudit ? Inspiration::STATUS_APPROVED : Inspiration::STATUS_PENDING,
            'is_visible' => true,
        ]);
        $item->load('category');

        return response()->json($item, 201);
    }

    // ===== Public API (for desktop app) =====

    public function publicConfig(): JsonResponse
    {
        // 数据源开关已下线，桌面端统一走云控端自定义灵感。
        // 接口保留以兼容旧桌面端：返回 source=custom 让 1.5.13 及以下版本直接走云端分页。
        return response()->json([
            'source' => 'custom',
        ]);
    }

    public function publicList(Request $request): JsonResponse
    {
        // 桌面端只看到「审核通过 + 显示开关 ON」的灵感
        $query = Inspiration::with('category')
            ->where('status', Inspiration::STATUS_APPROVED)
            ->where('is_visible', true)
            ->orderBy('sort_order')
            ->orderByDesc('id');

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }

        if ($request->filled('search')) {
            $s = (string) $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('title', 'like', "%{$s}%")
                  ->orWhere('prompt_cn', 'like', "%{$s}%")
                  ->orWhere('prompt_en', 'like', "%{$s}%");
            });
        }

        $perPage = min((int) $request->input('per_page', 40), 100);
        $page = (int) $request->input('page', 1);
        $paginated = $query->paginate($perPage, ['*'], 'page', $page);

        // 公开接口不暴露内部上传者 user_id，仅保留展示用昵称快照
        $items = collect($paginated->items())->map(function ($item) {
            $arr = $item->toArray();
            unset($arr['uploader_user_id']);
            $arr['ref_images'] = $this->normalizeRefImages($item->ref_images ?? []);
            $arr['generation_size'] = $this->normalizeGenerationSize($item->generation_size ?? null);
            return $arr;
        })->all();

        return response()->json([
            'items' => $items,
            'total' => $paginated->total(),
        ]);
    }

    public function publicCategories(): JsonResponse
    {
        $categories = InspirationCategory::orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name']);

        return response()->json(['data' => $categories]);
    }

    // ===== Helpers =====

    private function uploadFile(UploadedFile $file): ?string
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp'], true)) {
            $ext = 'png';
        }

        $filename = (string) Str::uuid() . '.' . $ext;
        return StorageService::upload($file, self::SUBDIR, $filename);
    }

    private function uploadRefImages(Request $request): ?array
    {
        if (!$request->hasFile('ref_images')) {
            return [];
        }

        $files = $request->file('ref_images');
        if ($files instanceof UploadedFile) {
            $files = [$files];
        }
        if (!is_array($files)) {
            return [];
        }

        $urls = [];
        foreach (array_slice($files, 0, 8) as $file) {
            if (!$file instanceof UploadedFile) {
                continue;
            }
            $url = $this->uploadFile($file);
            if (!$url) {
                $this->deleteRefImages($urls);
                return null;
            }
            $urls[] = $url;
        }

        return $urls;
    }

    private function parseExistingRefImages(?string $raw, array $current): array
    {
        if ($raw === null || trim($raw) === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [];
        }

        $currentSet = array_flip($this->normalizeRefImages($current));
        $kept = [];
        foreach ($this->normalizeRefImages($decoded) as $url) {
            if (isset($currentSet[$url])) {
                $kept[] = $url;
            }
        }

        return array_values(array_unique($kept));
    }

    private function normalizeRefImages($value): array
    {
        if (!is_array($value)) {
            return [];
        }

        $items = [];
        foreach ($value as $item) {
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

    private function deleteRefImages($value): void
    {
        foreach ($this->normalizeRefImages(is_array($value) ? $value : []) as $url) {
            StorageService::delete($url);
        }
    }

    private function normalizeGenerationSize($value): ?string
    {
        $size = trim((string) $value);
        return $size === '' ? null : mb_substr($size, 0, 50);
    }
}
