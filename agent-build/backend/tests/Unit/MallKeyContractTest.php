<?php

namespace Tests\Unit;

use App\Http\Controllers\Admin\BuildClientController;
use App\Http\Controllers\Build\BuildRequestController;
use App\Services\Mall\MallAuthorizationService;
use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * 商城 mall_key 死契约守卫。
 *
 * 重构后，合法 mall_key 枚举只有一处真源：MallAuthorizationService::MALL_KEYS，
 * BuildRequestController / BuildClientController 已删除各自的私有 MALL_KEYS 副本、
 * 统一引用 service 常量。本测试守住：
 *   1. service::MALL_KEYS 排序后恰为 ['dianda','ewei','qdyun']（新增/删商城会触发本断言，强制同步各端）。
 *   2. service::MALL_LABELS 的 key 与 MALL_KEYS 对齐（每个商城都有展示名，不多不少）。
 *   3. 两个 controller 不再持有自己的 MALL_KEYS 常量（收口验证）；若历史回潮重新引入，
 *      则其值必须与 service 常量完全一致，防止三端枚举漂移。
 */
class MallKeyContractTest extends TestCase
{
    /** 死契约基准：三端一致的合法商城集合（排序后）。 */
    private const EXPECTED_KEYS = ['dianda', 'ewei', 'qdyun'];

    public function test_service_mall_keys_equal_expected_contract(): void
    {
        $keys = MallAuthorizationService::MALL_KEYS;
        sort($keys);
        $this->assertSame(
            self::EXPECTED_KEYS,
            $keys,
            'MallAuthorizationService::MALL_KEYS 偏离死契约 [dianda,ewei,qdyun]，新增/删商城须同步三端与本测试。'
        );
    }

    public function test_mall_labels_keys_align_with_mall_keys(): void
    {
        $labelKeys = array_keys(MallAuthorizationService::MALL_LABELS);
        sort($labelKeys);

        $keys = MallAuthorizationService::MALL_KEYS;
        sort($keys);

        $this->assertSame(
            $keys,
            $labelKeys,
            'MALL_LABELS 的 key 与 MALL_KEYS 不一致：每个 mall_key 必须有且仅有一个展示名。'
        );
        $this->assertSame(self::EXPECTED_KEYS, $labelKeys);
    }

    public function test_controllers_do_not_keep_divergent_mall_keys_copies(): void
    {
        $service = MallAuthorizationService::MALL_KEYS;
        sort($service);

        foreach ([BuildRequestController::class, BuildClientController::class] as $controller) {
            $ref = new ReflectionClass($controller);
            // 收口后两个 controller 不应再定义自己的 MALL_KEYS；
            // 若历史回潮重新引入了该常量，它必须与 service 常量完全一致（防漂移）。
            if ($ref->hasConstant('MALL_KEYS')) {
                $local = $ref->getConstant('MALL_KEYS');
                sort($local);
                $this->assertSame(
                    $service,
                    $local,
                    $controller . ' 仍持有自己的 MALL_KEYS 且与 MallAuthorizationService::MALL_KEYS 不一致，存在枚举漂移风险。'
                );
            } else {
                $this->assertFalse(
                    $ref->hasConstant('MALL_KEYS'),
                    $controller . ' 不应再持有本地 MALL_KEYS 常量（应引用 MallAuthorizationService::MALL_KEYS）。'
                );
            }
        }
    }
}
