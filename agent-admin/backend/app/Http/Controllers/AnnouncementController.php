<?php

namespace App\Http\Controllers;

use App\Models\Announcement;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class AnnouncementController extends Controller
{
    /** 公告插图目录（StorageService 子目录） */
    private const IMG_SUBDIR = 'announcements/images';

    /** 公告插图大小上限 5MB（与文档插图同口径） */
    private const MAX_IMG_BYTES = 5 * 1024 * 1024;
    // ============ Admin（后台 CRUD） ============

    /**
     * GET /api/admin/announcements
     * 列表（按 sort_order desc, id desc 排）。支持 ?enabled=1 过滤。
     */
    public function index(Request $request)
    {
        $query = Announcement::query();

        if ($request->filled('enabled')) {
            $query->where('enabled', filter_var($request->input('enabled'), FILTER_VALIDATE_BOOLEAN));
        }
        if ($request->filled('keyword')) {
            $kw = trim((string) $request->input('keyword'));
            if ($kw !== '') {
                $query->where('title', 'like', '%' . $kw . '%');
            }
        }

        $items = $query
            ->orderByDesc('sort_order')
            ->orderByDesc('id')
            ->get();

        return response()->json(['items' => $items]);
    }

    /**
     * GET /api/admin/announcements/{id}
     */
    public function show(int $id)
    {
        $ann = Announcement::findOrFail($id);
        return response()->json($ann);
    }

    /**
     * POST /api/admin/announcements
     */
    public function store(Request $request)
    {
        // store 场景：enabled/sort_order 没传时填默认值（创建公告时这是合理兜底）
        $data = $this->validatePayload($request, true);
        $ann = Announcement::create($data);
        return response()->json($ann, 201);
    }

    /**
     * PUT /api/admin/announcements/{id}
     */
    public function update(Request $request, int $id)
    {
        $ann = Announcement::findOrFail($id);
        // update 场景：用户没传 enabled/sort_order 表示"保持原值"，禁用兜底
        // 避免「只想改标题」却把启用状态/排序意外重置成默认值
        $data = $this->validatePayload($request, false);
        $ann->update($data);
        return response()->json($ann);
    }

    /**
     * DELETE /api/admin/announcements/{id}
     */
    public function destroy(int $id)
    {
        $ann = Announcement::findOrFail($id);
        $ann->delete();
        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/admin/announcements/{id}/toggle
     * 快捷切换 enabled，不需要走完整 update。
     */
    public function toggle(int $id)
    {
        $ann = Announcement::findOrFail($id);
        $ann->enabled = !$ann->enabled;
        $ann->save();
        return response()->json($ann);
    }

    /**
     * POST /api/admin/announcements/upload-image
     * 公告插图上传：与文档插图同范式（mimetypes 白名单 + 大小限制 + UUID 文件名），
     * 返回可直接写进 content 的 <img src> URL。图片是「内容素材」，与公告记录解耦：
     * 编辑器先传图拿 URL 再保存正文，公告删除时图片文件不回收（与文档插图一致）。
     */
    public function uploadImage(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'image' => [
                'required', 'file',
                'mimetypes:image/png,image/jpeg,image/webp,image/gif',
                'max:' . (int)(self::MAX_IMG_BYTES / 1024),
            ],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $file = $request->file('image');
        $ext  = strtolower($file->getClientOriginalExtension() ?: $file->extension() ?: 'png');
        if (!in_array($ext, ['png', 'jpg', 'jpeg', 'webp', 'gif'], true)) {
            $ext = 'png';
        }

        $filename = (string) Str::uuid() . '.' . $ext;
        // uploadAbsolute：local 存储模式下补全为绝对 URL（桌面端生产是 file:// 加载，
        // 根相对路径会解析成 file:///announcements/... 裂图；cos/oss 本就返回完整 URL）
        $url = StorageService::uploadAbsolute($file, self::IMG_SUBDIR, $filename);
        if (!$url) {
            return response()->json(['error' => 'upload_failed'], 500);
        }
        return response()->json(['url' => $url]);
    }

    // ============ Client（桌面端拉取） ============

    /**
     * GET /api/client/announcement/current
     * 桌面端登录后拉取当前启用的最新公告，没有则返回 null。
     * 单一返回字段「announcement」便于上层 null check：{ announcement: {…} | null }
     */
    public function current()
    {
        $ann = Announcement::currentActive();
        if (!$ann) {
            return response()->json(['announcement' => null]);
        }
        return response()->json([
            'announcement' => [
                'id'         => $ann->id,
                'title'      => $ann->title,
                'content'    => $ann->content,
                'updated_at' => optional($ann->updated_at)->toIso8601String(),
            ],
        ]);
    }

    // ============ Helpers ============

    private function validatePayload(Request $request, bool $applyDefaults = false): array
    {
        $data = $request->validate([
            'title'      => ['required', 'string', 'max:200'],
            'content'    => ['required', 'string'],
            'enabled'    => ['sometimes', 'boolean'],
            'sort_order' => ['nullable', 'integer', 'between:-9999,9999'],
        ]);

        if (array_key_exists('sort_order', $data) && $data['sort_order'] === null) {
            $data['sort_order'] = 0;
        }

        // 仅 store 时填默认值；update 时由调用方决定不补默认，避免覆盖原值
        if ($applyDefaults) {
            if (!array_key_exists('enabled', $data)) {
                $data['enabled'] = true;
            }
            if (!array_key_exists('sort_order', $data)) {
                $data['sort_order'] = 0;
            }
        }

        return $data;
    }
}
