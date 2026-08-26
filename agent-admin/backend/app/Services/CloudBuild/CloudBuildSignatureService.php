<?php

namespace App\Services\CloudBuild;

class CloudBuildSignatureService
{
    public function __construct(private CloudBuildExecutionSettings $settings)
    {
    }

    /**
     * @return array{token:string,expires_at:int,url:string}|null
     */
    public function generate(string $buildId, string $clientRef, string $filename): ?array
    {
        if ($this->settings->signSecret === '') {
            return null;
        }
        $exp = time() + $this->settings->downloadTtlSeconds;
        $sig = hash_hmac('sha256', $buildId . $clientRef . $exp . $filename, $this->settings->signSecret);
        $payload = [
            'bid' => $buildId,
            'cid' => $clientRef,
            'exp' => $exp,
            'fn' => $filename,
            'sig' => $sig,
        ];
        $token = rtrim(strtr(base64_encode(json_encode($payload, JSON_UNESCAPED_SLASHES)), '+/', '-_'), '=');
        return [
            'token' => $token,
            'expires_at' => $exp,
            'url' => rtrim($this->settings->downloadBaseUrl, '/') . '/' . $token,
        ];
    }

    /**
     * @return array{build_id:string,client_ref:string,expires_at:int,filename:string}|null
     */
    public function verify(string $token): ?array
    {
        if ($this->settings->signSecret === '' || $token === '') {
            return null;
        }
        $pad = 4 - (strlen($token) % 4);
        if ($pad < 4) {
            $token .= str_repeat('=', $pad);
        }
        $decoded = base64_decode(strtr($token, '-_', '+/'), true);
        if ($decoded === false) {
            return null;
        }
        $data = json_decode($decoded, true);
        if (!is_array($data) || !isset($data['bid'], $data['cid'], $data['exp'], $data['fn'], $data['sig'])) {
            return null;
        }
        if ((int) $data['exp'] < time()) {
            return null;
        }
        $filename = (string) $data['fn'];
        $expected = hash_hmac(
            'sha256',
            $data['bid'] . $data['cid'] . $data['exp'] . $filename,
            $this->settings->signSecret
        );
        if (!hash_equals($expected, (string) $data['sig'])) {
            return null;
        }
        return [
            'build_id' => (string) $data['bid'],
            'client_ref' => (string) $data['cid'],
            'expires_at' => (int) $data['exp'],
            'filename' => $filename,
        ];
    }
}
