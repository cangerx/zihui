<?php

namespace App\Http\Controllers;

use App\Models\SystemSetting;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;

/**
 * 真实素材图搜索代理(deck 配图三级中的第一级 Pixabay)。
 * key 留服务端: 在管理后台「系统设置」配置, 加密存 SystemSetting(pixabay_api_key), 绝不下发桌面端。
 * 选 Pixabay: 免费商用、无需署名。未启用或未配 key 时返回空结果(桌面端自动降级到生图/自绘 SVG)。
 */
class ImageSearchController extends Controller
{
    public function search(Request $request)
    {
        $query   = trim((string) $request->get('query', ''));
        $perPage = (int) $request->get('per_page', 8);
        $perPage = max(3, min($perPage, 30));

        if ($query === '') {
            return response()->json(['results' => []]);
        }

        // 后台「系统设置」配置: 未启用 → 直接空(桌面端降级生图)
        if (!SystemSetting::getValue('pixabay_enabled', false)) {
            return response()->json(['results' => [], 'note' => 'pixabay_disabled']);
        }

        $key = (string) SystemSetting::getValue('pixabay_api_key', '');
        if ($key === '') {
            return response()->json(['results' => [], 'note' => 'pixabay_key_not_configured']);
        }

        try {
            $resp = Http::timeout(12)->get('https://pixabay.com/api/', [
                'key'        => $key,
                'q'          => $query,
                'per_page'   => $perPage,
                'image_type' => 'photo',
                'safesearch' => 'true',
                'lang'       => 'en',
            ]);

            if (!$resp->ok()) {
                return response()->json(['results' => [], 'note' => 'pixabay_http_' . $resp->status()], 200);
            }

            $hits = (array) ($resp->json('hits') ?? []);
            $results = [];
            foreach ($hits as $h) {
                $url = $h['largeImageURL'] ?? $h['webformatURL'] ?? '';
                if ($url === '') {
                    continue;
                }
                $results[] = [
                    'url'    => $url,
                    'thumb'  => $h['previewURL'] ?? $h['webformatURL'] ?? $url,
                    'width'  => (int) ($h['imageWidth'] ?? 0),
                    'height' => (int) ($h['imageHeight'] ?? 0),
                ];
            }

            return response()->json(['results' => $results]);
        } catch (\Throwable $e) {
            return response()->json(['results' => [], 'note' => 'image_search_failed'], 200);
        }
    }
}
