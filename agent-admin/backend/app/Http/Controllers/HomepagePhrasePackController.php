<?php

namespace App\Http\Controllers;

use App\Models\HomepagePhrasePack;
use App\Models\SystemSetting;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rule;

/**
 * 行业话术包管理（HomepagePhrasePack）。
 *
 * 职责：
 *  - 按模板维度维护多套行业文案预设（如 minimal/general、minimal/advertising）
 *  - 提供 apply 操作：把 payload 批量写入 SystemSetting，让前台官网立即换文案
 *
 * 与 HomepageController 的关系：
 *  - 文本字段白名单由 HomepageController::TEXT_KEYS 定义
 *  - apply 时仅写入白名单内 key，多余字段忽略并在响应中以 skipped 提示
 *  - 切换话术包前会先清空当前模板的"专属字段"（避免上一个话术包残留），
 *    通用字段（homepage_*）由用户自己在 HomepageSettings 编辑，不被 apply 覆盖
 */
class HomepagePhrasePackController extends Controller
{
    /**
     * GET /admin/homepage/phrase-packs?template=minimal
     * 列表，按 template 过滤；不传 template 返回所有模板的话术包。
     */
    public function index(Request $request): JsonResponse
    {
        $query = HomepagePhrasePack::query()->orderBy('template')->orderBy('sort_order')->orderBy('id');
        if ($request->filled('template')) {
            $template = (string) $request->input('template');
            if (!in_array($template, HomepageController::TEMPLATES, true)) {
                return response()->json(['error' => 'invalid_template'], 422);
            }
            $query->where('template', $template);
        }

        $items = $query->get()->map(fn ($p) => $this->toArray($p));

        // 同时返回当前激活情况，前端列表能直接打"使用中"标识
        return response()->json([
            'items' => $items,
            'active' => [
                'default' => (string) SystemSetting::getValue('homepage_active_phrase_pack_default', ''),
                'minimal' => (string) SystemSetting::getValue('homepage_active_phrase_pack_minimal', ''),
            ],
        ]);
    }

    /**
     * GET /admin/homepage/phrase-packs/{id}
     */
    public function show(int $id): JsonResponse
    {
        $pack = HomepagePhrasePack::find($id);
        if (!$pack) {
            return response()->json(['error' => 'not_found'], 404);
        }
        return response()->json($this->toArray($pack));
    }

    /**
     * POST /admin/homepage/phrase-packs
     */
    public function store(Request $request): JsonResponse
    {
        $data = $this->validated($request, false);
        if ($data instanceof JsonResponse) {
            return $data;
        }

        // 同 (template, slug) 唯一
        $exists = HomepagePhrasePack::where('template', $data['template'])->where('slug', $data['slug'])->exists();
        if ($exists) {
            return response()->json(['error' => 'slug_already_exists'], 422);
        }

        $data['payload'] = $this->filterPayload($data['payload'] ?? [], $data['template']);
        // 用户自建一律 is_builtin = false（防止前端伪造）
        $data['is_builtin'] = false;

        $pack = HomepagePhrasePack::create($data);
        return response()->json($this->toArray($pack), 201);
    }

    /**
     * PUT /admin/homepage/phrase-packs/{id}
     * 系统预置话术包仍可编辑（文案 / payload / 排序），但不能改 template / slug / is_builtin
     */
    public function update(Request $request, int $id): JsonResponse
    {
        $pack = HomepagePhrasePack::find($id);
        if (!$pack) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $data = $this->validated($request, true);
        if ($data instanceof JsonResponse) {
            return $data;
        }

        // 系统预置不允许改 template / slug
        if ($pack->is_builtin) {
            unset($data['template'], $data['slug']);
        } else {
            // 用户自建若改 (template, slug) 需校验唯一
            $newTpl = $data['template'] ?? $pack->template;
            $newSlug = $data['slug'] ?? $pack->slug;
            if ($newTpl !== $pack->template || $newSlug !== $pack->slug) {
                $exists = HomepagePhrasePack::where('template', $newTpl)
                    ->where('slug', $newSlug)
                    ->where('id', '!=', $pack->id)
                    ->exists();
                if ($exists) {
                    return response()->json(['error' => 'slug_already_exists'], 422);
                }
            }
        }

        if (isset($data['payload'])) {
            $data['payload'] = $this->filterPayload($data['payload'], $data['template'] ?? $pack->template);
        }
        // is_builtin 永远不能从前端改（即便系统预置也不能被降级为非内置，反之亦然）
        unset($data['is_builtin']);

        $pack->update($data);
        return response()->json($this->toArray($pack->fresh()));
    }

    /**
     * DELETE /admin/homepage/phrase-packs/{id}
     * 系统预置不允许删除。
     * 删除当前激活的话术包：清空 active 标记，但不重置文案（用户已编辑的内容保留）
     */
    public function destroy(int $id): JsonResponse
    {
        $pack = HomepagePhrasePack::find($id);
        if (!$pack) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($pack->is_builtin) {
            return response()->json(['error' => 'builtin_cannot_be_deleted'], 422);
        }

        // 如果删的是当前激活话术包，清空 active 标记
        $activeKey = 'homepage_active_phrase_pack_' . $pack->template;
        if ((string) SystemSetting::getValue($activeKey, '') === $pack->slug) {
            SystemSetting::setValue($activeKey, '');
        }

        $pack->delete();
        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/homepage/phrase-packs/{id}/apply
     *
     * 应用话术包：
     *  1. 清空当前模板的"专属字段"（避免残留上一个话术包的字段）
     *  2. 把 payload 中位于 TEXT_KEYS 白名单内的 K/V 写入 SystemSetting
     *  3. 标记当前模板的 active 话术包 slug
     *
     * 不影响通用字段（homepage_*）：用户在 HomepageSettings 里手动编辑的标题、Logo 文字、
     * 下载链接、Footer 信息等不会被话术包覆盖。
     */
    public function apply(int $id): JsonResponse
    {
        $pack = HomepagePhrasePack::find($id);
        if (!$pack) {
            return response()->json(['error' => 'not_found'], 404);
        }

        $payload = is_array($pack->payload) ? $pack->payload : [];
        $allowed = array_flip(HomepageController::getTemplateOwnedKeys($pack->template));

        // Step 1: reset 模板专属字段（default 模板返回 [] 不做任何 reset）
        foreach (HomepageController::getTemplateOwnedKeys($pack->template) as $key) {
            SystemSetting::setValue($key, '');
        }

        // Step 2: 写入 payload
        $applied = [];
        $skipped = [];
        foreach ($payload as $key => $value) {
            if (!is_string($key)) {
                continue;
            }
            if (isset($allowed[$key])) {
                // 强制转字符串，避免布尔/数值意外
                SystemSetting::setValue($key, (string) $value);
                $applied[] = $key;
            } else {
                $skipped[] = $key;
            }
        }

        // Step 3: 标记激活
        SystemSetting::setValue('homepage_active_phrase_pack_' . $pack->template, $pack->slug);

        return response()->json([
            'ok'       => true,
            'template' => $pack->template,
            'slug'     => $pack->slug,
            'applied'  => count($applied),
            'skipped'  => $skipped,
        ]);
    }

    /**
     * 校验入参（store 与 update 共用）。
     * @return array<string,mixed>|JsonResponse 校验通过返回归一化后的 data 数组；失败返回 422 JSON
     */
    private function validated(Request $request, bool $isUpdate)
    {
        $rules = [
            'template'    => [$isUpdate ? 'sometimes' : 'required', 'string', Rule::in(HomepageController::TEMPLATES)],
            'slug'        => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:80', 'regex:' . HomepagePhrasePack::SLUG_REGEX],
            'name'        => [$isUpdate ? 'sometimes' : 'required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'payload'     => [$isUpdate ? 'sometimes' : 'required', 'array'],
            'sort_order'  => ['nullable', 'integer', 'min:0'],
        ];
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            return response()->json([
                'error'   => 'validation_failed',
                'details' => $validator->errors(),
            ], 422);
        }
        return $validator->validated();
    }

    /**
     * 过滤 payload：只保留白名单内 key + 强制 value 转字符串
     */
    private function filterPayload(array $payload, string $template): array
    {
        $allowed = array_flip(HomepageController::getTemplateOwnedKeys($template));
        $clean = [];
        foreach ($payload as $key => $value) {
            if (is_string($key) && isset($allowed[$key])) {
                $clean[$key] = (string) $value;
            }
        }
        return $clean;
    }

    /**
     * 格式化输出
     */
    private function toArray(HomepagePhrasePack $p): array
    {
        return [
            'id'          => $p->id,
            'template'    => $p->template,
            'slug'        => $p->slug,
            'name'        => $p->name,
            'description' => $p->description,
            'payload'     => $p->payload ?? [],
            'is_builtin'  => (bool) $p->is_builtin,
            'sort_order'  => (int) $p->sort_order,
            'created_at'  => optional($p->created_at)->toIso8601String(),
            'updated_at'  => optional($p->updated_at)->toIso8601String(),
        ];
    }
}
