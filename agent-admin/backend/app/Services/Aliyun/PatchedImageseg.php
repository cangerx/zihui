<?php

namespace App\Services\Aliyun;

use AlibabaCloud\SDK\Imageseg\V20191230\Imageseg;

/**
 * 阿里 SDK 版本组合 bug 修补层。
 *
 * 问题：
 *   - alibabacloud/imageseg-20191230 4.0.1 的 Imageseg.php 在 segmentHDCommonImageAdvance 等 Advance 方法里
 *     调用 `$_postOSSObject($bucket, $form, $runtime)`，把 `$this->_retryOptions` 传进 form 数组。
 *   - 但 alibabacloud/openapi-core 1.0.9（imageseg 4.0.1 在 composer.json 里要求 ^1.0.0 解析出的最高版本）
 *     的 OpenApiClient 父类 **没有声明 `$_retryOptions` 属性**。
 *   - PHP 8 访问未声明属性触发 `Undefined property` warning，被 Laravel ErrorHandler 升级为
 *     ErrorException → HTTP 500「Undefined property: AlibabaCloud\SDK\Imageseg\V20191230\Imageseg::$_retryOptions」。
 *
 * 修法：本类继承 Imageseg，**补声明** `$_retryOptions` protected 字段。子类声明对父类继承的方法可见，
 * 等同于把缺失字段「打补丁」回去。null 是合法默认值（_postOSSObject 内部容器允许 null 表示「用 client 默认重试」）。
 *
 * 注意：composer 升级 imageseg 子包时无影响（本类只继承不改 vendor）。
 *       未来阿里官方修了这个版本组合 bug，可移除本类 + 改回 `new Imageseg(...)`。
 */
class PatchedImageseg extends Imageseg
{
    /**
     * SDK 4.0 引用但父类未声明的字段。null = 用客户端默认重试策略。
     *
     * @var mixed
     */
    protected $_retryOptions;
}
