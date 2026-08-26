<?php

namespace App\Http\Controllers;

use App\Models\TtsProvider;
use App\Services\Tts\TtsAdapterFactory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

/**
 * TTS 供应商管理(管理端)。key 留服务端, 输出只给 mask; testConnection 发短文本试合成。
 */
class TtsProviderController extends Controller
{
    private const PRESET_TYPES = ['doubao', 'openai_compatible', 'generic'];

    public function index(Request $request): JsonResponse
    {
        $query = TtsProvider::query();
        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('keyword')) {
            $query->where('name', 'like', "%{$request->keyword}%");
        }
        $providers = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        $providers->getCollection()->transform(function (TtsProvider $p) {
            $p->setAttribute('api_key_masked', $p->maskedKey());
            return $p;
        });
        return response()->json($providers);
    }

    public function store(Request $request): JsonResponse
    {
        $validator = $this->validator($request);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $data = $validator->validated();
        $data['status'] = $data['status'] ?? 'active';
        $provider = TtsProvider::create($data);
        return response()->json($provider, 201);
    }

    public function update(Request $request, int $id): JsonResponse
    {
        $provider = TtsProvider::find($id);
        if (!$provider) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $validator = $this->validator($request, false);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }
        $data = $validator->validated();
        // 编辑时 api_key 留空 = 保持原 key 不变(对齐 provider 范式)
        if (!array_key_exists('api_key', $data) || $data['api_key'] === null || $data['api_key'] === '') {
            unset($data['api_key']);
        }
        $provider->update($data);
        return response()->json($provider->fresh());
    }

    public function destroy(int $id): JsonResponse
    {
        $provider = TtsProvider::find($id);
        if (!$provider) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $provider->delete();
        return response()->json(['ok' => true]);
    }

    /** 试连: 发短文本试合成, 验证能解码出音频 */
    public function testConnection(Request $request, int $id): JsonResponse
    {
        $provider = TtsProvider::find($id);
        if (!$provider) {
            return response()->json(['error' => 'not_found'], 404);
        }
        $text = (string) $request->get('test_text', '语音合成测试');
        try {
            $bytes = TtsAdapterFactory::make($provider)->synthesize($provider, $text, null, 1.0);
            return response()->json(['ok' => true, 'bytes' => strlen($bytes), 'format' => $provider->format]);
        } catch (\Throwable $e) {
            return response()->json(['ok' => false, 'message' => $e->getMessage()]);
        }
    }

    private function validator(Request $request, bool $requireName = true)
    {
        return Validator::make($request->all(), [
            'name'          => ($requireName ? 'required' : 'sometimes') . '|string|max:100',
            'preset_type'   => 'in:' . implode(',', self::PRESET_TYPES),
            'endpoint'      => 'nullable|string|max:1000',
            'api_key'       => 'nullable|string',
            'auth'          => 'nullable|array',
            'headers'       => 'nullable|array',
            'body_template' => 'nullable|string',
            'response_type' => 'nullable|in:binary,json-base64,json-url',
            'audio_path'    => 'nullable|string|max:200',
            'format'        => 'nullable|in:mp3,wav,pcm',
            'voice_default' => 'nullable|string|max:120',
            'speed_default' => 'nullable|numeric|min:0.5|max:2',
            'config'        => 'nullable|array',
            'status'        => 'nullable|in:active,disabled',
        ]);
    }
}
