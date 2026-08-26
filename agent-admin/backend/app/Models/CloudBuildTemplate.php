<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class CloudBuildTemplate extends Model
{
    protected $table = 'cloud_build_templates';

    protected $fillable = [
        'version',
        'released_at',
        'changelog',
        'is_current',
        'released_by',
    ];

    protected $casts = [
        'released_at' => 'datetime',
        'is_current' => 'boolean',
    ];

    /**
     * 把指定 version 标为当前模板。其它行 is_current=0；不存在则插入。
     * 禁止把某一具体版本写死为 PHP 回退值。
     */
    public static function setCurrent(string $version, ?string $changelog = null): self
    {
        $version = trim($version);
        if (preg_match('/^\d{1,4}\.\d{1,4}\.\d{1,4}$/', $version) !== 1) {
            throw new \InvalidArgumentException('invalid_template_version');
        }

        return \Illuminate\Support\Facades\DB::transaction(function () use ($version, $changelog) {
            static::query()->where('is_current', 1)->update(['is_current' => 0]);
            $existing = static::query()->where('version', $version)->first();
            $attrs = ['is_current' => 1];
            if ($changelog !== null && $changelog !== '') {
                $attrs['changelog'] = $changelog;
            }
            if ($existing === null) {
                $attrs['released_at'] = now();
                $attrs['released_by'] = 'artisan';
            }

            return static::query()->updateOrCreate(['version' => $version], $attrs);
        });
    }
}
