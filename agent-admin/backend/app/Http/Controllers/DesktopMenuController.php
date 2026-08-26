<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * 桌面端左侧菜单配置（显隐 + 自定义名称 + 自定义菜单项）。
 *
 * - MENU_ITEMS 是桌面端左侧菜单清单，必须与 agent-desktop 的 MainLayout.vue `allNavItems` 保持一致
 *   （桌面端新增/调整菜单时，这里需同步增删对应条目）。
 * - 配置只存「覆盖值」（visible / title）到 system_settings.desktop_menu_config（JSON）。
 * - permission_controlled=true 的项（模型服务 / AI 抠图 / AI 视频 / 店铺商品图）由用户功能权限控制，不纳入本配置：
 *   既不下发给桌面端，也不接受后台保存。
 * - 自定义菜单项（custom_items）：后台自行维护的额外菜单（内部路由 / 外部链接），
 *   整体存 system_settings.desktop_menu_custom_items（JSON，无 migration）；
 *   与 overrides 同一下发端点（clientConfig）返回给桌面端合并渲染。
 */
class DesktopMenuController extends Controller
{
    /**
     * key：叶子菜单用路由 path，分组用 group:xxx。label 为桌面端默认名称。
     */
    public const MENU_ITEMS = [
        ['key' => '/chat', 'label' => '对话', 'group' => ''],
        ['key' => '/browser', 'label' => '浏览器', 'group' => ''],
        ['key' => 'group:skills', 'label' => '智能体管理', 'group' => ''],
        ['key' => '/bots', 'label' => '数字员工', 'group' => '智能体管理'],
        ['key' => '/knowledge', 'label' => '知识库', 'group' => '智能体管理'],
        ['key' => '/skills', 'label' => '技能库', 'group' => '智能体管理'],
        ['key' => '/mcps', 'label' => 'MCP', 'group' => '智能体管理'],
        ['key' => '/daily-review', 'label' => '每日回顾', 'group' => ''],
        ['key' => '/inspiration', 'label' => '灵感广场', 'group' => ''],
        ['key' => 'group:image-creation', 'label' => '图片创作', 'group' => ''],
        ['key' => '/image-gen', 'label' => 'AI 生图', 'group' => '图片创作'],
        ['key' => '/batch-gen', 'label' => '批量生图', 'group' => '图片创作'],
        ['key' => '/image-to-prompt', 'label' => '图片反推', 'group' => '图片创作'],
        ['key' => '/image-toolkit', 'label' => '图像处理', 'group' => '图片创作'],
        ['key' => '/canvas', 'label' => '图片工作流', 'group' => '图片创作'],
        ['key' => '/canvas-square', 'label' => '工作流模板', 'group' => '图片创作'],
        ['key' => '/ewei', 'label' => '店铺商品图', 'group' => '图片创作', 'permission_controlled' => true],
        ['key' => '/my-creations', 'label' => '图片作品', 'group' => '图片创作'],
        ['key' => 'group:video-creation', 'label' => '视频创作', 'group' => ''],
        ['key' => '/ai-video', 'label' => 'AI 视频', 'group' => '视频创作'],
        ['key' => '/viral-clone', 'label' => '爆款复刻', 'group' => '视频创作'],
        ['key' => '/video-creations', 'label' => '视频作品', 'group' => '视频创作'],
        ['key' => 'group:more', 'label' => '更多', 'group' => ''],
        ['key' => '/gallery', 'label' => '本地图库', 'group' => '更多'],
        ['key' => '/prompts', 'label' => '提示词库', 'group' => '更多'],
    ];

    private function readConfig(): array
    {
        $raw = (string) SystemSetting::getValue('desktop_menu_config', '');
        if ($raw === '') {
            return [];
        }
        $parsed = json_decode($raw, true);
        return is_array($parsed) ? $parsed : [];
    }

    // ===== 自定义菜单项 =====

    /** 可挂载的菜单组（'' = 顶级）；与桌面端 MainLayout.vue 的分组 key 对齐，新增分组需两端同步 */
    public const CUSTOM_GROUP_KEYS = ['', 'group:skills', 'group:image-creation', 'group:video-creation', 'group:more'];

    /** 预置图标 key（桌面端渲染层映射到内置 SVG 组件，禁止外链图标） */
    public const CUSTOM_ICONS = ['link', 'page', 'app', 'star'];

    /** 外部链接打开方式：browser=系统浏览器；window=应用内独立窗口（桌面端新建隔离 BrowserWindow） */
    public const CUSTOM_OPEN_MODES = ['browser', 'window'];

    private function readCustomItems(): array
    {
        $raw = (string) SystemSetting::getValue('desktop_menu_custom_items', '');
        if ($raw === '') {
            return [];
        }
        $parsed = json_decode($raw, true);
        if (!is_array($parsed)) {
            return [];
        }
        // 脏数据防御，并在读取时兼容旧客户端菜单分组，不修改原始数据。
        $items = array_filter($parsed, 'is_array');
        return array_map(function (array $item): array {
            $legacy = [
                'group:ai-creation' => 'group:image-creation',
                'group:my-creations' => 'group:more',
                'group:extensions' => 'group:more',
            ];
            $groupKey = (string) ($item['group_key'] ?? '');
            if (isset($legacy[$groupKey])) {
                $item['group_key'] = $legacy[$groupKey];
            }
            return $item;
        }, $items);
    }

    /** 新菜单 key 读取不到覆盖时，回退到旧版分组覆盖。 */
    private function menuOverride(array $cfg, string $key): array
    {
        $legacyKey = match ($key) {
            'group:image-creation', 'group:video-creation' => 'group:ai-creation',
            'group:more' => 'group:extensions',
            default => '',
        };
        $raw = $cfg[$key] ?? ($legacyKey !== '' ? ($cfg[$legacyKey] ?? null) : null);
        return is_array($raw) ? $raw : [];
    }

    /** 组 key → 组显示名（管理页下拉用；顶级为空串） */
    private function customGroupOptions(): array
    {
        $labels = ['' => '顶级（无分组）'];
        foreach (self::MENU_ITEMS as $item) {
            if (str_starts_with($item['key'], 'group:')) {
                $labels[$item['key']] = $item['label'];
            }
        }
        $options = [];
        foreach (self::CUSTOM_GROUP_KEYS as $key) {
            $options[] = ['key' => $key, 'label' => $labels[$key] ?? $key];
        }
        return $options;
    }

    /**
     * 校验并规范化一条自定义菜单；不合法时抛 ValidationException（整体保存即整体拒绝，避免静默丢项）。
     */
    private function validateCustomItem(array $row, int $index): array
    {
        $title = trim((string) ($row['title'] ?? ''));
        $groupKey = (string) ($row['group_key'] ?? '');
        $targetType = (string) ($row['target_type'] ?? '');
        $target = trim((string) ($row['target'] ?? ''));
        $openMode = (string) ($row['open_mode'] ?? 'browser');
        $icon = (string) ($row['icon'] ?? 'link');
        $label = '第 ' . ($index + 1) . ' 条' . ($title !== '' ? "「{$title}」" : '');

        if ($title === '' || mb_strlen($title) > 30) {
            throw ValidationException::withMessages(['items' => "{$label}：菜单名称必填且不超过 30 字"]);
        }
        if (!in_array($groupKey, self::CUSTOM_GROUP_KEYS, true)) {
            throw ValidationException::withMessages(['items' => "{$label}：所属菜单组不合法"]);
        }
        if (!in_array($targetType, ['internal', 'external'], true)) {
            throw ValidationException::withMessages(['items' => "{$label}：跳转类型不合法"]);
        }
        if ($targetType === 'internal') {
            // 内部路由：允许 query 与锚点（桌面端存在 /models?tab=video 这类用法）；
            // 字符集白名单（字母数字与常见 URL 符号），不含空格/引号/尖括号等注入面；
            // (?!\/) 禁 // 开头——protocol-relative 形态（//host）会被浏览器按跨域解析
            if (!preg_match('/^\/(?!\/)[a-zA-Z0-9\-_\/\?=\&\%\.#~]{0,499}$/', $target)) {
                throw ValidationException::withMessages(['items' => "{$label}：内部页面路径必须以 / 开头、不超过 500 字符（可含字母数字、-、_、/ 与 ?=& 查询参数）"]);
            }
            // 外部打开方式对内部页面无意义，统一归位
            $openMode = 'browser';
        } else {
            if (!preg_match('/^https?:\/\/\S+$/i', $target) || mb_strlen($target) > 500) {
                throw ValidationException::withMessages(['items' => "{$label}：外部链接必须是 http(s):// 开头的完整 URL（≤500 字符）"]);
            }
            if (!in_array($openMode, self::CUSTOM_OPEN_MODES, true)) {
                throw ValidationException::withMessages(['items' => "{$label}：打开方式不合法"]);
            }
        }
        if (!in_array($icon, self::CUSTOM_ICONS, true)) {
            throw ValidationException::withMessages(['items' => "{$label}：图标不合法"]);
        }
        return [
            'key' => (string) ($row['key'] ?? ''),
            'title' => $title,
            'group_key' => $groupKey,
            'target_type' => $targetType,
            'target' => $target,
            'open_mode' => $openMode,
            'icon' => $icon,
            'sort' => max(0, min(9999, (int) ($row['sort'] ?? 0))),
            'visible' => array_key_exists('visible', $row) ? (bool) $row['visible'] : true,
        ];
    }

    /** 按 sort 升序（同 sort 保持提交顺序），返回索引后的数组 */
    private function sortCustomItems(array $items): array
    {
        $keys = array_keys($items);
        usort($keys, fn ($a, $b) => (($items[$a]['sort'] ?? 0) <=> ($items[$b]['sort'] ?? 0)));
        $sorted = [];
        foreach ($keys as $k) {
            $sorted[$k] = $items[$k];
        }
        return $sorted;
    }

    /** 可配置（非权限控制）菜单 key 集合 */
    private function configurableKeys(): array
    {
        $keys = [];
        foreach (self::MENU_ITEMS as $item) {
            if (!empty($item['permission_controlled'])) {
                continue;
            }
            $keys[$item['key']] = true;
        }
        return $keys;
    }

    // ===== Client（桌面端拉取）=====

    /**
     * 返回所有「可配置」菜单项的生效显隐/名称（权限控制项不下发）。
     */
    public function clientConfig()
    {
        $cfg = $this->readConfig();
        $overrides = [];
        foreach (self::MENU_ITEMS as $item) {
            if (!empty($item['permission_controlled'])) {
                continue;
            }
            $key = $item['key'];
            $o = $this->menuOverride($cfg, $key);
            $overrides[$key] = [
                'visible' => array_key_exists('visible', $o) ? (bool) $o['visible'] : true,
                'title' => isset($o['title']) ? (string) $o['title'] : '',
            ];
        }
        // 自定义菜单：仅下发可见项（按 sort 排序）；sort/visible 属管理态字段，无需下发
        $customItems = [];
        foreach ($this->sortCustomItems($this->readCustomItems()) as $item) {
            if (empty($item['visible'])) {
                continue;
            }
            $customItems[] = [
                'key' => $item['key'],
                'title' => $item['title'],
                'group_key' => $item['group_key'],
                'target_type' => $item['target_type'],
                'target' => $item['target'],
                'open_mode' => $item['open_mode'],
                'icon' => $item['icon'],
            ];
        }
        return response()->json(['overrides' => $overrides, 'custom_items' => $customItems]);
    }

    // ===== Admin =====

    /**
     * 返回菜单清单（含分组、是否权限控制）merge 当前配置，供后台渲染配置表。
     */
    public function adminIndex()
    {
        $cfg = $this->readConfig();
        $items = [];
        foreach (self::MENU_ITEMS as $item) {
            $key = $item['key'];
            $o = $this->menuOverride($cfg, $key);
            $items[] = [
                'key' => $key,
                'label' => $item['label'],
                'group' => $item['group'] ?? '',
                'is_group' => str_starts_with($key, 'group:'),
                'permission_controlled' => !empty($item['permission_controlled']),
                'visible' => array_key_exists('visible', $o) ? (bool) $o['visible'] : true,
                'title' => isset($o['title']) ? (string) $o['title'] : '',
            ];
        }
        return response()->json(['items' => $items]);
    }

    public function adminUpdate(Request $request)
    {
        $payload = $request->validate([
            'items' => 'required|array',
            'items.*.key' => 'required|string|max:100',
            'items.*.visible' => 'nullable|boolean',
            'items.*.title' => 'nullable|string|max:50',
        ]);

        $allowed = $this->configurableKeys();
        $cfg = [];
        foreach ($payload['items'] as $row) {
            $key = (string) $row['key'];
            // 跳过未知 key 与权限控制项，确保「模型服务 / AI 抠图」永不被写入配置
            if (!isset($allowed[$key])) {
                continue;
            }
            $cfg[$key] = [
                'visible' => array_key_exists('visible', $row) ? (bool) $row['visible'] : true,
                'title' => isset($row['title']) ? trim((string) $row['title']) : '',
            ];
        }
        SystemSetting::setValue('desktop_menu_config', json_encode($cfg, JSON_UNESCAPED_UNICODE));
        return response()->json(['ok' => true]);
    }

    // ===== Admin：自定义菜单项 =====

    /**
     * 返回自定义菜单列表（按 sort 排序）+ 可挂载组清单 + 预置图标清单，供管理页渲染。
     */
    public function adminCustomIndex()
    {
        return response()->json([
            'items' => array_values($this->sortCustomItems($this->readCustomItems())),
            'group_options' => $this->customGroupOptions(),
            'icon_options' => self::CUSTOM_ICONS,
        ]);
    }

    /**
     * 整体保存自定义菜单（新增/编辑/删除/排序均为整体提交，与 overrides 保存范式一致）。
     * key 由前端生成（新增时生成，编辑保持稳定）；后端校验格式与唯一性。
     */
    public function adminCustomUpdate(Request $request)
    {
        $payload = $request->validate([
            'items' => 'present|array|max:50',
            'items.*.key' => ['required', 'string', 'regex:/^[a-zA-Z0-9_-]{1,40}$/'],
            'items.*.title' => 'nullable|string',
            'items.*.group_key' => 'nullable|string',
            'items.*.target_type' => 'nullable|string',
            'items.*.target' => 'nullable|string|max:500',
            'items.*.open_mode' => 'nullable|string',
            'items.*.icon' => 'nullable|string',
            'items.*.sort' => 'nullable|integer|min:0|max:9999',
            'items.*.visible' => 'nullable|boolean',
        ]);

        $cfg = [];
        foreach ($payload['items'] as $i => $row) {
            $item = $this->validateCustomItem($row, $i);
            $key = $item['key'];
            if (isset($cfg[$key])) {
                throw ValidationException::withMessages(['items' => "菜单 key「{$key}」重复，请刷新后重试"]);
            }
            $cfg[$key] = $item;
        }
        SystemSetting::setValue('desktop_menu_custom_items', json_encode($cfg, JSON_UNESCAPED_UNICODE));
        return response()->json(['ok' => true]);
    }
}
