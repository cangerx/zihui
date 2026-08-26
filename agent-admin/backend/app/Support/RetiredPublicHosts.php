<?php

namespace App\Support;

/**
 * 已停用、不得再作为站点身份或公网绝对地址前缀的 host。
 */
class RetiredPublicHosts
{
    public const HOSTS = [
        'ai.haohuoban.com',
    ];

    public static function contains(string $urlOrHost): bool
    {
        $raw = trim($urlOrHost);
        if ($raw === '') {
            return false;
        }
        $host = parse_url($raw, PHP_URL_HOST);
        if (!is_string($host) || $host === '') {
            $host = parse_url('https://' . ltrim($raw, '/'), PHP_URL_HOST);
        }
        if (!is_string($host) || $host === '') {
            return false;
        }
        return in_array(strtolower($host), self::HOSTS, true);
    }

    public static function rewrite(string $url, string $replacementOrigin): string
    {
        if (!self::contains($url)) {
            return $url;
        }
        $origin = rtrim($replacementOrigin, '/');
        if ($origin === '') {
            return $url;
        }
        $rewritten = preg_replace('#^https?://ai\.haohuoban\.com#i', $origin, $url);
        return is_string($rewritten) ? $rewritten : $url;
    }
}
