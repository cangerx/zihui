<?php

namespace App\Http\Controllers;

use App\Models\StylePreset;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Str;

/**
 * 风格预设（后台管理）：生图风格提示词片段的 CRUD + 启停 + 排序。
 * 无投稿/审核流程；桌面端经 /api/public/style-presets/* 拉取启用项。
 */
class StylePresetController extends Controller
{
    private const SUBDIR = 'style-presets';
    private const MAX_BYTES = 2 * 1024 * 1024; // 示例图上限 2MB

    public function index(Request $request): JsonResponse
    {
        $query = StylePreset::query()->orderBy('sort_order')->orderBy('id');

        if ($request->filled('category')) {
            $query->where('category', (string) $request->input('category'));
        }
        if ($request->filled('keyword')) {
            $k = (string) $request->input('keyword');
            $query->where(function ($q) use ($k) {
                $q->where('name', 'like', "%{$k}%")
                    ->orWhere('prompt_fragment', 'like', "%{$k}%");
            });
        }
        if ($request->filled('is_enabled')) {
            $query->where('is_enabled', $request->boolean('is_enabled'));
        }

        $perPage = min((int) $request->input('per_page', 20), 100);
        $paginated = $query->paginate($perPage);

        return response()->json([
            'items' => $paginated->items(),
            'total' => $paginated->total(),
            'current_page' => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
        ]);
    }

    /** 已使用的分类名列表（去重），供后台筛选/表单联想 */
    public function categories(): JsonResponse
    {
        $categories = StylePreset::query()
            ->where('category', '!=', '')
            ->distinct()
            ->orderBy('category')
            ->pluck('category');

        return response()->json(['data' => $categories]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $this->validateData($request);

        $sampleImage = $this->resolveSampleImage($request);
        if ($sampleImage === null) {
            return response()->json(['error' => 'upload_failed'], 500);
        }

        $preset = StylePreset::create([
            'name' => $data['name'],
            'prompt_fragment' => $data['prompt_fragment'],
            'category' => $data['category'] ?? '',
            'sample_image' => $sampleImage,
            'sort_order' => $data['sort_order'] ?? 0,
            'is_enabled' => $data['is_enabled'] ?? true,
        ]);

        return response()->json($preset, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $preset = StylePreset::find($id);
        if (!$preset) return response()->json(['error' => 'not_found'], 404);

        $data = $this->validateData($request, true);

        // 示例图：传新文件则替换（旧的 best-effort 清掉）；传 *_url 则直接用；都不传保持原样
        if ($request->hasFile('sample_image') || $request->filled('sample_image_url')) {
            $sampleImage = $this->resolveSampleImage($request);
            if ($sampleImage === null) {
                return response()->json(['error' => 'upload_failed'], 500);
            }
            if ($preset->sample_image && $preset->sample_image !== $sampleImage) {
                StorageService::delete($preset->sample_image);
            }
            $preset->sample_image = $sampleImage;
        }

        foreach (['name', 'prompt_fragment', 'category', 'sort_order', 'is_enabled'] as $field) {
            if (array_key_exists($field, $data)) {
                $preset->{$field} = $data[$field];
            }
        }
        $preset->save();

        return response()->json($preset);
    }

    public function destroy(int $id): JsonResponse
    {
        $preset = StylePreset::find($id);
        if (!$preset) return response()->json(['error' => 'not_found'], 404);

        $sampleImage = (string) $preset->sample_image;
        $preset->delete();
        if ($sampleImage !== '') {
            StorageService::delete($sampleImage);
        }

        return response()->json(['ok' => true]);
    }

    public function toggle(int $id): JsonResponse
    {
        $preset = StylePreset::find($id);
        if (!$preset) return response()->json(['error' => 'not_found'], 404);

        $preset->is_enabled = !$preset->is_enabled;
        $preset->save();

        return response()->json($preset);
    }

    public function setSortOrder(Request $request, int $id): JsonResponse
    {
        $preset = StylePreset::find($id);
        if (!$preset) return response()->json(['error' => 'not_found'], 404);

        $validated = $request->validate([
            'sort_order' => ['required', 'integer', 'min:0', 'max:1000000'],
        ]);

        $preset->sort_order = (int) $validated['sort_order'];
        $preset->save();

        return response()->json($preset);
    }

    private function validateData(Request $request, bool $partial = false): array
    {
        $nameRule = $partial ? ['sometimes', 'required', 'string', 'max:50'] : ['required', 'string', 'max:50'];
        $fragmentRule = $partial ? ['sometimes', 'required', 'string', 'max:2000'] : ['required', 'string', 'max:2000'];

        return $request->validate([
            'name' => $nameRule,
            'prompt_fragment' => $fragmentRule,
            'category' => ['nullable', 'string', 'max:50'],
            'sort_order' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'is_enabled' => ['nullable', 'boolean'],
            'sample_image' => ['nullable', 'file', 'mimetypes:image/png,image/jpeg,image/webp', 'max:' . (int) (self::MAX_BYTES / 1024)],
            'sample_image_url' => ['nullable', 'string', 'max:500'],
        ]);
    }

    /**
     * 返回示例图 URL；上传失败返回 null（与创意模板 uploadFile 约定一致）。
     * 未传文件且未传 URL 时返回 ''（允许无示例图）。
     */
    private function resolveSampleImage(Request $request): ?string
    {
        if ($request->hasFile('sample_image')) {
            return $this->uploadFile($request->file('sample_image'));
        }
        return (string) $request->input('sample_image_url', '');
    }

    private function uploadFile(UploadedFile $file): ?string
    {
        $ext = strtolower($file->getClientOriginalExtension() ?: 'png');
        return StorageService::upload($file, self::SUBDIR, (string) Str::uuid() . '.' . $ext);
    }
}
