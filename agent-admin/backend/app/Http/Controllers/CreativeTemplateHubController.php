<?php

namespace App\Http\Controllers;

use App\Models\CreativeTemplate;
use App\Models\CreativeTemplateCategory;
use App\Models\SystemSetting;
use App\Services\CreativeTemplateHub\CreativeTemplateHubClient;
use App\Services\StorageService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use RuntimeException;

class CreativeTemplateHubController extends Controller
{
    private const IMAGE_SUBDIR = 'creative-templates';
    private const IMAGE_MIRROR_MAX_BYTES = 8 * 1024 * 1024;
    private const IMAGE_MIRROR_TIMEOUT = 15;

    public function __construct(private CreativeTemplateHubClient $hub)
    {
    }

    public function me(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['enabled' => true, 'ready' => false, 'reason' => $this->notReadyReason()], 503);
        }
        try {
            $resp = $this->hub->get('/me');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp, fn ($body) => ['enabled' => true, 'ready' => true, 'me' => $body]);
    }

    public function categories(): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/categories');
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function list(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }

        $hubQuery = $request->query();
        unset($hubQuery['exclude_pulled']);
        if (isset($hubQuery['page_size']) && !isset($hubQuery['per_page'])) {
            $hubQuery['per_page'] = $hubQuery['page_size'];
        }
        unset($hubQuery['page_size']);

        if ($request->boolean('exclude_pulled')) {
            return $this->listWithoutPulled($hubQuery, $request);
        }

        try {
            $resp = $this->hub->get('/list', $hubQuery);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function show(int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function statusBatch(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'ids' => ['required', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'integer', 'min:1'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $localIds = array_values(array_unique($request->input('ids')));
        $rows = CreativeTemplate::whereIn('id', $localIds)->whereNotNull('hub_shared_id')->get(['id', 'hub_shared_id']);
        if ($rows->isEmpty()) {
            return response()->json(['items' => []]);
        }

        $sharedIds = $rows->pluck('hub_shared_id')->all();
        $sharedToLocal = $rows->keyBy('hub_shared_id');
        try {
            $resp = $this->hub->post('/status-batch', ['shared_ids' => $sharedIds]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $items = $resp->json('items', []);
        $now = now();
        $output = [];
        DB::transaction(function () use ($items, $sharedToLocal, $now, &$output) {
            foreach ($items as $item) {
                $shared = $sharedToLocal->get($item['id'] ?? null);
                if (!$shared) continue;
                $localId = $shared->id;
                $hubStatus = $item['status'] ?? null;
                CreativeTemplate::where('id', $localId)->update([
                    'hub_status' => $hubStatus,
                    'hub_status_synced_at' => $now,
                ]);
                $output[] = [
                    'local_id' => $localId,
                    'hub_shared_id' => $item['id'] ?? null,
                    'hub_status' => $hubStatus,
                    'is_visible' => (bool) ($item['is_visible'] ?? true),
                    'approve_count' => (int) ($item['approve_count'] ?? 0),
                    'reject_count' => (int) ($item['reject_count'] ?? 0),
                    'report_count' => (int) ($item['report_count'] ?? 0),
                    'auto_hidden_at' => $item['auto_hidden_at'] ?? null,
                    'latest_reject_reason' => $item['latest_reject_reason'] ?? null,
                ];
            }
        });

        return response()->json(['items' => $output]);
    }

    public function shareToHub(Request $request, int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }

        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $validator = Validator::make($request->all(), [
            'hub_category_id' => ['required', 'integer'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $template = CreativeTemplate::find($localId);
        if (!$template) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && (int) $template->submitted_by_user_id !== (int) $user->id) {
            return response()->json(['error' => 'forbidden', 'message' => '只能分享自己投稿的创意模板'], 403);
        }
        if ($template->submission_status !== CreativeTemplate::STATUS_APPROVED || !$template->is_visible) {
            return response()->json(['error' => 'not_available', 'message' => '只有审核通过且已上架的创意模板才能分享'], 422);
        }
        if ($template->hub_shared_id) {
            return response()->json(['error' => 'already_shared', 'shared_id' => $template->hub_shared_id, 'hub_status' => $template->hub_status], 409);
        }
        if ($template->from_hub_template_id) {
            return response()->json(['error' => 'cannot_share_from_hub', 'message' => '从创意共享库拉取的模板不能再次分享回去'], 422);
        }

        $coverUrl = $this->resolveImageUrl((string) $template->cover_image);
        if (!$coverUrl) {
            return response()->json(['error' => 'cover_image_unreachable', 'message' => '封面图无公网 URL，请检查存储设置'], 422);
        }

        $rawRefs = $this->normalizeUrlArray($template->example_ref_images ?? []);
        $refUrls = $this->resolveImageUrls($rawRefs);
        if (count($rawRefs) !== count($refUrls)) {
            return response()->json(['error' => 'ref_image_unreachable', 'message' => '示例参考图无公网 URL，请检查存储设置'], 422);
        }

        $sourceImageUrl = '';
        if ((string) $template->source_image !== '') {
            $sourceImageUrl = $this->resolveImageUrl((string) $template->source_image) ?: '';
            if ($sourceImageUrl === '') {
                return response()->json(['error' => 'source_image_unreachable', 'message' => '来源图无公网 URL，请检查存储设置'], 422);
            }
        }

        $payload = [
            'hub_category_id' => (int) $request->input('hub_category_id'),
            'title' => (string) $template->title,
            'description' => (string) $template->description,
            'cover_image_url' => $coverUrl,
            'example_ref_images' => $refUrls,
            'requires_ref_image' => (bool) $template->requires_ref_image,
            'default_size' => (string) $template->default_size,
            'prompt_template' => (string) $template->prompt_template,
            'variables' => is_array($template->variables) ? $template->variables : [],
            'source_type' => (string) ($template->source_type ?: CreativeTemplate::SOURCE_MANUAL),
            'source_image_url' => $sourceImageUrl,
            'source_inspiration_id' => $template->source_inspiration_id,
            'source_metadata' => is_array($template->source_metadata) ? $template->source_metadata : [],
            'source_local_id' => (int) $template->id,
            'site_name' => (string) SystemSetting::getValue('site_title', 'Agent Admin'),
        ];

        try {
            $resp = $this->hub->post('/submit', $payload);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $body = $resp->json();
        $sharedId = (int) ($body['shared_id'] ?? 0);
        if ($sharedId > 0) {
            $template->update([
                'hub_shared_id' => $sharedId,
                'hub_status' => $body['status'] ?? 'pending',
                'hub_status_synced_at' => now(),
            ]);
        }

        Log::info('[CreativeTemplateHub] shared to hub', ['local_id' => $template->id, 'shared_id' => $sharedId, 'user_id' => $user->id]);

        return response()->json(['ok' => true, 'local_id' => $template->id, 'hub_shared_id' => $sharedId, 'hub_status' => $body['status'] ?? 'pending']);
    }

    public function withdrawFromHub(int $localId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        $user = auth()->user();
        if (!$user) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }
        $template = CreativeTemplate::find($localId);
        if (!$template) {
            return response()->json(['error' => 'not_found'], 404);
        }
        if ($user->role !== 'admin' && (int) $template->submitted_by_user_id !== (int) $user->id) {
            return response()->json(['error' => 'forbidden'], 403);
        }
        if (!$template->hub_shared_id) {
            return response()->json(['error' => 'not_shared'], 422);
        }

        try {
            $resp = $this->hub->delete('/by-source/' . $template->id);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful() && $resp->status() !== 404) {
            return $this->forwardError($resp);
        }

        $template->update(['hub_shared_id' => null, 'hub_status' => null, 'hub_status_synced_at' => now()]);
        Log::info('[CreativeTemplateHub] withdrew from hub', ['local_id' => $template->id, 'user_id' => $user->id]);
        return response()->json(['ok' => true, 'local_id' => $template->id]);
    }

    public function report(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        $validator = Validator::make($request->all(), [
            'reason_code' => ['required', 'string', 'max:30'],
            'reason_note' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        try {
            $resp = $this->hub->post('/' . $hubId . '/report', [
                'reason_code' => $request->input('reason_code'),
                'reason_note' => $request->input('reason_note'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminGetSettings(): JsonResponse
    {
        return response()->json(['enabled' => true, 'endpoint' => $this->hub->endpoint(), 'origin' => $this->hub->origin(), 'ready' => $this->hub->isReady()]);
    }

    public function adminHealthCheck(): JsonResponse
    {
        return response()->json($this->hub->healthCheck());
    }

    public function adminPendingList(Request $request): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        $hubQuery = $request->query();
        if (isset($hubQuery['page_size']) && !isset($hubQuery['per_page'])) {
            $hubQuery['per_page'] = $hubQuery['page_size'];
        }
        unset($hubQuery['page_size']);
        try {
            $resp = $this->hub->get('/pending-list', $hubQuery);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminReview(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }
        $validator = Validator::make($request->all(), [
            'action' => ['required', 'in:approve,reject'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        try {
            $resp = $this->hub->post('/' . $hubId . '/review', [
                'action' => $request->input('action'),
                'reason' => $request->input('reason'),
            ]);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        return $this->forward($resp);
    }

    public function adminPullToLocal(Request $request, int $hubId): JsonResponse
    {
        if (!$this->hub->isReady()) {
            return response()->json(['error' => 'creative_template_hub_not_configured'], 503);
        }

        $validator = Validator::make($request->all(), [
            'local_category_id' => ['required', 'integer', 'exists:creative_template_categories,id'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $existing = CreativeTemplate::where('from_hub_template_id', $hubId)->first(['id']);
        if ($existing) {
            return response()->json(['error' => 'already_pulled', 'local_id' => $existing->id], 409);
        }

        try {
            $resp = $this->hub->get('/' . $hubId);
        } catch (RuntimeException $e) {
            return response()->json(['error' => $e->getMessage()], 503);
        }
        if (!$resp->successful()) {
            return $this->forwardError($resp);
        }

        $hubItem = $resp->json();
        if (($hubItem['status'] ?? null) !== 'approved' || empty($hubItem['is_visible'])) {
            return response()->json(['error' => 'not_pullable', 'message' => '仅能拉取已通过审核且未下架的创意模板'], 422);
        }

        $localCategory = CreativeTemplateCategory::find((int) $request->input('local_category_id'));
        if (!$localCategory) {
            return response()->json(['error' => 'invalid_local_category'], 422);
        }

        $remoteCover = (string) ($hubItem['cover_image'] ?? '');
        $localCover = $this->mirrorRemoteImage($remoteCover);
        $remoteRefs = $this->normalizeUrlArray($hubItem['example_ref_images'] ?? []);
        $localRefs = $this->mirrorRemoteImages($remoteRefs);
        $remoteSourceImage = (string) ($hubItem['source_image'] ?? '');
        $localSourceImage = $remoteSourceImage !== '' ? $this->mirrorRemoteImage($remoteSourceImage) : null;

        $created = CreativeTemplate::create([
            'category_id' => $localCategory->id,
            'title' => (string) ($hubItem['title'] ?? '未命名模板'),
            'description' => (string) ($hubItem['description'] ?? ''),
            'cover_image' => $localCover ?? $remoteCover,
            'example_ref_images' => $localRefs,
            'requires_ref_image' => (bool) ($hubItem['requires_ref_image'] ?? false),
            'default_size' => (string) ($hubItem['default_size'] ?? ''),
            'prompt_template' => (string) ($hubItem['prompt_template'] ?? ''),
            'variables' => is_array($hubItem['variables'] ?? null) ? $hubItem['variables'] : [],
            'source_type' => (string) ($hubItem['source_type'] ?? CreativeTemplate::SOURCE_MANUAL),
            'source_image' => $localSourceImage ?? $remoteSourceImage,
            'source_inspiration_id' => null,
            'source_metadata' => $this->mergeSourceMetadata($hubItem),
            'sort_order' => 0,
            'is_visible' => true,
            'submission_status' => CreativeTemplate::STATUS_APPROVED,
            'reviewed_by_user_id' => optional(auth()->user())->id,
            'reviewed_at' => now(),
            'published_at' => now(),
            'from_hub_template_id' => $hubId,
            'from_hub_source_site_name' => (string) ($hubItem['source_site_name'] ?? ''),
        ]);

        Log::info('[CreativeTemplateHub] pulled to local', [
            'hub_id' => $hubId,
            'local_id' => $created->id,
            'admin_id' => optional(auth()->user())->id,
            'cover_localized' => $localCover !== null,
        ]);

        try {
            $bumpResp = $this->hub->post('/' . $hubId . '/download');
            if (!$bumpResp->successful()) {
                Log::warning('[CreativeTemplateHub] bump download_count non-2xx', ['hub_id' => $hubId, 'status' => $bumpResp->status(), 'body' => $bumpResp->json()]);
            }
        } catch (\Throwable $e) {
            Log::warning('[CreativeTemplateHub] bump download_count failed', ['hub_id' => $hubId, 'msg' => $e->getMessage()]);
        }

        return response()->json(['ok' => true, 'local_id' => $created->id, 'template' => $created->load('category')], 201);
    }

    private function listWithoutPulled(array $hubQuery, Request $request): JsonResponse
    {
        $page = max(1, (int) $request->input('page', 1));
        $pageSize = min(100, max(1, (int) ($request->input('page_size') ?: $request->input('per_page', 24))));
        $hubPerPage = min(60, $pageSize);
        $targetStart = ($page - 1) * $pageSize;
        $targetEnd = $targetStart + $pageSize;
        $targetScanEnd = $targetEnd + 1;
        $scanPage = 1;
        $keptCount = 0;
        $resultItems = [];
        $lastBody = null;
        $rawTotal = 0;
        $seenHubIds = [];

        while ($scanPage <= 200) {
            $query = array_merge($hubQuery, ['page' => $scanPage, 'per_page' => $hubPerPage]);
            try {
                $resp = $this->hub->get('/list', $query);
            } catch (RuntimeException $e) {
                return response()->json(['error' => $e->getMessage()], 503);
            }
            if (!$resp->successful()) {
                return $this->forward($resp);
            }
            $body = $resp->json();
            $lastBody = $body;
            $items = is_array($body['items'] ?? null) ? $body['items'] : [];
            $rawTotal = max($rawTotal, (int) ($body['total'] ?? 0));
            if (empty($items)) break;

            foreach ($this->filterPulledHubItems($items) as $item) {
                $id = (int) ($item['id'] ?? 0);
                if ($id > 0 && isset($seenHubIds[$id])) continue;
                if ($id > 0) $seenHubIds[$id] = true;
                if ($keptCount >= $targetStart && $keptCount < $targetEnd) {
                    $resultItems[] = $item;
                }
                $keptCount++;
                if ($keptCount >= $targetScanEnd) break 2;
            }

            $remotePage = (int) ($body['page'] ?? $scanPage);
            $remotePerPage = (int) ($body['per_page'] ?? $hubPerPage);
            $remoteTotal = (int) ($body['total'] ?? 0);
            if ($remoteTotal > 0 && $remotePage * $remotePerPage >= $remoteTotal) break;
            if (count($items) < $hubPerPage) break;
            $scanPage++;
        }

        return response()->json(['items' => $resultItems, 'total' => $keptCount, 'page' => $page, 'per_page' => $pageSize, 'raw_total' => $lastBody['total'] ?? $rawTotal]);
    }

    private function filterPulledHubItems(array $items): array
    {
        $hubIds = array_values(array_filter(array_map(fn ($item) => (int) ($item['id'] ?? 0), $items)));
        if (empty($hubIds)) return $items;
        $pulledHubIds = CreativeTemplate::whereIn('from_hub_template_id', $hubIds)
            ->pluck('from_hub_template_id')
            ->map(fn ($v) => (int) $v)
            ->all();
        $pulledSet = array_flip($pulledHubIds);
        return array_values(array_filter($items, fn ($item) => !isset($pulledSet[(int) ($item['id'] ?? 0)])));
    }

    private function resolveImageUrl(string $image): ?string
    {
        $image = trim($image);
        if ($image === '') return null;
        if (preg_match('#^https?://#i', $image)) return $image;
        $base = rtrim((string) config('app.url', ''), '/');
        if ($base === '') return null;
        return $base . '/' . ltrim($image, '/');
    }

    private function resolveImageUrls(array $images): array
    {
        $urls = [];
        foreach ($images as $image) {
            $url = $this->resolveImageUrl((string) $image);
            if ($url && preg_match('#^https?://#i', $url)) {
                $urls[] = $url;
            }
        }
        return array_values(array_unique($urls));
    }

    private function normalizeUrlArray($value): array
    {
        if (!is_array($value)) return [];
        $items = [];
        foreach ($value as $item) {
            if (is_array($item)) $item = $item['url'] ?? '';
            $url = trim((string) $item);
            if ($url !== '') $items[] = $url;
        }
        return array_values(array_unique($items));
    }

    private function mirrorRemoteImages(array $remoteUrls): array
    {
        $urls = [];
        foreach (array_slice($remoteUrls, 0, 8) as $remoteUrl) {
            $localUrl = $this->mirrorRemoteImage((string) $remoteUrl);
            $urls[] = $localUrl ?? $remoteUrl;
        }
        return array_values(array_filter($urls, fn ($url) => is_string($url) && trim($url) !== ''));
    }

    private function mirrorRemoteImage(string $remoteUrl): ?string
    {
        $remoteUrl = trim($remoteUrl);
        if ($remoteUrl === '' || !preg_match('#^https?://#i', $remoteUrl)) return null;
        try {
            $resp = Http::timeout(self::IMAGE_MIRROR_TIMEOUT)->withOptions(['allow_redirects' => true])->get($remoteUrl);
        } catch (\Throwable $e) {
            Log::warning('[CreativeTemplateHub] mirrorRemoteImage request failed', ['url' => $remoteUrl, 'err' => $e->getMessage()]);
            return null;
        }
        if (!$resp->successful()) {
            Log::warning('[CreativeTemplateHub] mirrorRemoteImage non-2xx', ['url' => $remoteUrl, 'status' => $resp->status()]);
            return null;
        }
        $bytes = $resp->body();
        $size = strlen($bytes);
        if ($size === 0 || $size > self::IMAGE_MIRROR_MAX_BYTES) {
            Log::warning('[CreativeTemplateHub] mirrorRemoteImage invalid size', ['url' => $remoteUrl, 'size' => $size]);
            return null;
        }
        $ct = strtolower((string) $resp->header('Content-Type'));
        $ext = match (true) {
            str_contains($ct, 'jpeg'), str_contains($ct, 'jpg') => 'jpg',
            str_contains($ct, 'png') => 'png',
            str_contains($ct, 'webp') => 'webp',
            str_contains($ct, 'gif') => 'gif',
            default => $this->guessImageExtFromUrl($remoteUrl),
        };
        $contentType = match ($ext) {
            'jpg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'gif' => 'image/gif',
            default => 'application/octet-stream',
        };
        $filename = (string) Str::uuid() . '.' . $ext;
        $localUrl = StorageService::putBytes($bytes, $contentType, self::IMAGE_SUBDIR, $filename);
        if ($localUrl === null) {
            Log::warning('[CreativeTemplateHub] mirrorRemoteImage putBytes failed', ['url' => $remoteUrl, 'storage' => StorageService::getStorageType(), 'filename' => $filename]);
            return null;
        }
        return $localUrl;
    }

    private function guessImageExtFromUrl(string $url): string
    {
        $path = (string) parse_url($url, PHP_URL_PATH);
        $ext = strtolower((string) pathinfo($path, PATHINFO_EXTENSION));
        return match ($ext) {
            'jpg', 'jpeg' => 'jpg',
            'png', 'webp', 'gif' => $ext,
            default => 'png',
        };
    }

    private function mergeSourceMetadata(array $hubItem): array
    {
        $metadata = is_array($hubItem['source_metadata'] ?? null) ? $hubItem['source_metadata'] : [];
        $metadata['hub_template_id'] = (int) ($hubItem['id'] ?? 0);
        $metadata['hub_source_site_name'] = (string) ($hubItem['source_site_name'] ?? '');
        $metadata['hub_source_type'] = (string) ($hubItem['source_type'] ?? '');
        $metadata['hub_source_inspiration_id'] = $hubItem['source_inspiration_id'] ?? null;
        return $metadata;
    }

    private function forward(\Illuminate\Http\Client\Response $resp, ?callable $transform = null): JsonResponse
    {
        $body = $resp->json();
        if ($transform && $resp->successful()) {
            $body = $transform($body);
        }
        return response()->json($body, $resp->status());
    }

    private function forwardError(\Illuminate\Http\Client\Response $resp): JsonResponse
    {
        return response()->json($resp->json() ?: ['error' => 'hub_error'], $resp->status());
    }

    private function notReadyReason(): string
    {
        if ($this->hub->endpoint() === '') return 'endpoint_empty';
        if ($this->hub->origin() === '') return 'origin_empty';
        return 'unknown';
    }
}
