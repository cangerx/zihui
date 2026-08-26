<?php

namespace App\Http\Controllers;

use App\Models\TtsAudioAsset;
use App\Models\TtsProvider;
use App\Services\Tts\TtsAdapterFactory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

/**
 * TTS 客户端代理(桌面端解说): key 留服务端, 端只提交文本/音色, 服务端代调上游并落盘返 URL。
 */
class TtsAudioController extends Controller
{
    /** 可用 TTS 供应商目录(供桌面端选音色; 不含 key) */
    public function catalog(): JsonResponse
    {
        $items = TtsProvider::where('status', 'active')
            ->get(['id', 'name', 'preset_type', 'format', 'voice_default', 'speed_default'])
            ->map(function (TtsProvider $p) {
                return [
                    'id'            => $p->id,
                    'name'          => $p->name,
                    'preset_type'   => $p->preset_type,
                    'format'        => $p->format,
                    'voice_default' => $p->voice_default,
                    'speed_default' => $p->speed_default,
                ];
            });
        return response()->json(['providers' => $items]);
    }

    /** 合成一段音频: 服务端代调上游 → 落 public → 登记(按字符) → 返 URL。 */
    public function synthesize(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'provider_id' => 'nullable|integer',
            'text'        => 'required|string|max:5000',
            'voice'       => 'nullable|string|max:120',
            'speed'       => 'nullable|numeric|min:0.5|max:2',
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        $provider = $request->filled('provider_id')
            ? TtsProvider::where('status', 'active')->find($request->integer('provider_id'))
            : TtsProvider::where('status', 'active')->orderBy('id')->first();
        if (!$provider) {
            return response()->json(['error' => 'no_active_tts_provider'], 503);
        }

        $text  = (string) $request->get('text');
        $voice = $request->filled('voice') ? (string) $request->get('voice') : null;
        $speed = (float) ($request->get('speed', $provider->speed_default ?: 1.0));
        $chars = mb_strlen($text);
        $userId = (int) (optional($request->user())->id ?? 0);

        try {
            $bytes = TtsAdapterFactory::make($provider)->synthesize($provider, $text, $voice, $speed);

            $rel = 'updates/tts/' . date('Y-m-d');
            $dir = public_path($rel);
            if (!is_dir($dir)) {
                @mkdir($dir, 0755, true);
            }
            $filename = Str::uuid() . '.' . ($provider->format ?: 'mp3');
            file_put_contents($dir . DIRECTORY_SEPARATOR . $filename, $bytes);
            $url = url($rel . '/' . $filename);

            $asset = TtsAudioAsset::create([
                'user_id'     => $userId,
                'provider_id' => $provider->id,
                'text_hash'   => hash('sha256', $text . '|' . ($voice ?? '') . '|' . $speed),
                'char_count'  => $chars,
                'voice'       => $voice ?? $provider->voice_default,
                'format'      => $provider->format ?: 'mp3',
                'storage_url' => $url,
                'size'        => strlen($bytes),
                'status'      => 'ready',
            ]);

            return response()->json([
                'ok'         => true,
                'url'        => $url,
                'format'     => $provider->format ?: 'mp3',
                'char_count' => $chars,
                'asset_id'   => $asset->id,
            ]);
        } catch (\Throwable $e) {
            TtsAudioAsset::create([
                'user_id'     => $userId,
                'provider_id' => $provider->id,
                'char_count'  => $chars,
                'status'      => 'failed',
                'error'       => mb_substr($e->getMessage(), 0, 500),
            ]);
            return response()->json(['error' => 'tts_failed', 'message' => $e->getMessage()], 502);
        }
    }
}
