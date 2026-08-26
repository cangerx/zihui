<?php

namespace App\Services\SystemSetting;

use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

/**
 * 通用 key-value 系统配置服务。
 *
 * - 通过 (group_key, setting_key) 二元组定位一条配置
 * - 写入时可指定加密 key 列表，自动 Crypt::encryptString
 * - 读取时按 is_encrypted 标志自动解密
 *
 * 不耦合具体业务（COS、邮件等），由调用方确定语义。
 */
class SettingService
{
    /**
     * 读取一组配置，返回 [setting_key => 解密后的值] 映射。
     *
     * @return array<string, string|null>
     */
    public function getGroup(string $group): array
    {
        $rows = DB::table('system_settings')->where('group_key', $group)->get();
        $out = [];
        foreach ($rows as $r) {
            $out[$r->setting_key] = $this->resolveValue($r->setting_value, (bool) $r->is_encrypted);
        }
        return $out;
    }

    /**
     * 读取单个配置项。
     */
    public function get(string $group, string $key, mixed $default = null): mixed
    {
        $row = DB::table('system_settings')
            ->where('group_key', $group)
            ->where('setting_key', $key)
            ->first();
        if (!$row) return $default;
        $val = $this->resolveValue($row->setting_value, (bool) $row->is_encrypted);
        return $val ?? $default;
    }

    /**
     * 批量写入一组配置。
     *
     * @param  array<string, string|int|bool|null>  $values  setting_key => value
     * @param  string[]  $encryptedKeys  这些 key 的值会被 Crypt 加密后存
     */
    public function setGroup(string $group, array $values, array $encryptedKeys = []): void
    {
        $now = now();
        foreach ($values as $key => $value) {
            $isEncrypted = in_array($key, $encryptedKeys, true);
            $stored = $value;
            if ($isEncrypted && $value !== null && $value !== '') {
                $stored = Crypt::encryptString((string) $value);
            }

            // 显式 first → update/insert 二选一：updateOrInsert 在 update 分支会用第二个数组里全部字段覆盖
            // 已有行（包括 created_at），这里要保留首次创建时间，必须自己控制。
            $existing = DB::table('system_settings')
                ->where('group_key', $group)
                ->where('setting_key', $key)
                ->first();

            if ($existing) {
                DB::table('system_settings')
                    ->where('group_key', $group)
                    ->where('setting_key', $key)
                    ->update([
                        'setting_value' => $stored,
                        'is_encrypted' => $isEncrypted ? 1 : 0,
                        'updated_at' => $now,
                    ]);
            } else {
                DB::table('system_settings')->insert([
                    'group_key' => $group,
                    'setting_key' => $key,
                    'setting_value' => $stored,
                    'is_encrypted' => $isEncrypted ? 1 : 0,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
        }
    }

    private function resolveValue(?string $raw, bool $isEncrypted): ?string
    {
        if ($raw === null || $raw === '') return $raw;
        if (!$isEncrypted) return $raw;
        try {
            return Crypt::decryptString($raw);
        } catch (DecryptException $e) {
            return null;
        }
    }
}
