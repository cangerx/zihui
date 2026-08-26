<?php

namespace App\Services\Build;

class SignatureService
{
    private string $secret;
    private int $ttl;

    public function __construct()
    {
        $this->secret = config('build.download.sign_secret');
        $this->ttl = config('build.download.ttl_seconds', 1800);
    }

    /**
     * 生成签名下载 token。
     * token = base64url(json({bid, cid, exp, fn?, sig}))
     * sig = HMAC-SHA256(secret, bid + cid + exp + (fn ?? "")) hex lower
     *
     * @return array{token: string, expires_at: int}
     */
    public function generate(string $buildId, string $clientId, ?string $filename = null): array
    {
        $exp = time() + $this->ttl;
        $sigInput = $buildId . $clientId . $exp . ($filename ?? '');
        $sig = hash_hmac('sha256', $sigInput, $this->secret);

        $payload = ['bid' => $buildId, 'cid' => $clientId, 'exp' => $exp];
        if ($filename !== null) {
            $payload['fn'] = $filename;
        }
        $payload['sig'] = $sig;

        $token = rtrim(strtr(base64_encode(json_encode($payload, JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
        return ['token' => $token, 'expires_at' => $exp];
    }

    /**
     * 校验 token 有效性。
     *
     * @return array{build_id: string, client_id: string, expires_at: int, filename: ?string}|null
     */
    public function verify(string $token): ?array
    {
        $pad = 4 - (strlen($token) % 4);
        if ($pad < 4) {
            $token .= str_repeat('=', $pad);
        }
        $decoded = base64_decode(strtr($token, '-_', '+/'), true);
        if ($decoded === false) {
            return null;
        }

        $data = json_decode($decoded, true);
        if (!is_array($data) || !isset($data['bid'], $data['cid'], $data['exp'], $data['sig'])) {
            return null;
        }

        if ((int) $data['exp'] < time()) {
            return null;
        }

        $filename = isset($data['fn']) ? (string) $data['fn'] : null;
        $sigInput = $data['bid'] . $data['cid'] . $data['exp'] . ($filename ?? '');
        $expectedSig = hash_hmac('sha256', $sigInput, $this->secret);
        if (!hash_equals($expectedSig, (string) $data['sig'])) {
            return null;
        }

        return [
            'build_id' => (string) $data['bid'],
            'client_id' => (string) $data['cid'],
            'expires_at' => (int) $data['exp'],
            'filename' => $filename,
        ];
    }
}
