<?php

namespace App\Services\Sms;

use App\Models\SystemSetting;
use GuzzleHttp\Client;
use Illuminate\Support\Facades\Log;

/**
 * 阿里云短信发送服务（Dysmsapi 2017-05-25）。
 *
 * 设计取舍：不引入 alibabacloud/dysmsapi-* SDK，避免与现有 imageseg 抠图所依赖的
 * darabonba-openapi ^0.2 版本冲突，也不增大「在线更新」zip 的 vendor 体积。
 * 这里用项目已有的 guzzlehttp/guzzle 直连阿里云 RPC 接口，自行完成 HMAC-SHA1 签名。
 *
 * 安全：AccessKey 仅从 SystemSetting（加密）读取并在服务端使用，绝不下发桌面端。
 */
class AliyunSmsService
{
    /** RPC 网关地址（华东 1 杭州，短信为中心化服务，region 固定 cn-hangzhou） */
    private string $endpoint = 'https://dysmsapi.aliyuncs.com/';

    private string $apiVersion = '2017-05-25';

    /**
     * 发送短信。
     *
     * @param  array  $templateParam  模板变量键值对，例如 ['code' => '123456']
     * @return array{ok:bool, code?:string, message?:string, request_id?:string, biz_id?:string}
     */
    public function send(string $mobile, string $templateCode, array $templateParam, ?string $signName = null): array
    {
        $accessKeyId = (string) SystemSetting::getRawValue('sms_access_key_id', '');
        $accessKeySecret = (string) SystemSetting::getRawValue('sms_access_key_secret', '');
        $signName = $signName ?? (string) SystemSetting::getValue('sms_sign_name', '');

        if ($accessKeyId === '' || $accessKeySecret === '' || $signName === '' || $templateCode === '') {
            return ['ok' => false, 'message' => '短信配置不完整（AccessKey / 签名 / 模板）'];
        }

        $params = [
            // 公共参数
            'AccessKeyId'      => $accessKeyId,
            'Action'           => 'SendSms',
            'Format'           => 'JSON',
            'RegionId'         => 'cn-hangzhou',
            'SignatureMethod'  => 'HMAC-SHA1',
            'SignatureNonce'   => $this->nonce(),
            'SignatureVersion' => '1.0',
            'Timestamp'        => gmdate('Y-m-d\TH:i:s\Z'),
            'Version'          => $this->apiVersion,
            // 业务参数
            'PhoneNumbers'  => $mobile,
            'SignName'      => $signName,
            'TemplateCode'  => $templateCode,
            'TemplateParam' => json_encode($templateParam, JSON_UNESCAPED_UNICODE),
        ];

        $params['Signature'] = $this->sign($params, $accessKeySecret);

        try {
            $client = new Client(['timeout' => 10, 'connect_timeout' => 5]);
            $resp = $client->get($this->endpoint, ['query' => $params]);
            $body = json_decode((string) $resp->getBody(), true) ?: [];
        } catch (\GuzzleHttp\Exception\RequestException $e) {
            // 阿里云的业务错误（如签名/模板错误）通常以 4xx + JSON body 返回，需取出 body 给出友好提示
            $body = [];
            if ($e->hasResponse()) {
                $body = json_decode((string) $e->getResponse()->getBody(), true) ?: [];
            }
            if (empty($body)) {
                Log::warning('[sms] request failed: ' . $e->getMessage());
                return ['ok' => false, 'message' => '短信网关请求失败，请稍后再试'];
            }
        } catch (\Throwable $e) {
            Log::warning('[sms] request error: ' . $e->getMessage());
            return ['ok' => false, 'message' => '短信网关异常，请稍后再试'];
        }

        $code = (string) ($body['Code'] ?? '');
        if ($code === 'OK') {
            return [
                'ok'         => true,
                'code'       => $code,
                'request_id' => (string) ($body['RequestId'] ?? ''),
                'biz_id'     => (string) ($body['BizId'] ?? ''),
            ];
        }

        Log::warning('[sms] send rejected: ' . $code . ' ' . ($body['Message'] ?? ''));
        return [
            'ok'      => false,
            'code'    => $code,
            'message' => $this->friendlyError($code, (string) ($body['Message'] ?? '短信发送失败')),
        ];
    }

    /**
     * 阿里云 RPC 签名（GET 请求，HMAC-SHA1）。
     * StringToSign = "GET&" + enc("/") + "&" + enc(sort(params))
     * Signature    = Base64(HMAC-SHA1(AccessKeySecret + "&", StringToSign))
     */
    private function sign(array $params, string $accessKeySecret): string
    {
        ksort($params);
        $pairs = [];
        foreach ($params as $k => $v) {
            $pairs[] = $this->percentEncode($k) . '=' . $this->percentEncode((string) $v);
        }
        $canonicalizedQuery = implode('&', $pairs);
        $stringToSign = 'GET&' . $this->percentEncode('/') . '&' . $this->percentEncode($canonicalizedQuery);

        return base64_encode(hash_hmac('sha1', $stringToSign, $accessKeySecret . '&', true));
    }

    /** 阿里云专用 percent-encode（与官方 SDK 规则一致） */
    private function percentEncode(string $str): string
    {
        $res = urlencode($str);
        $res = str_replace('+', '%20', $res);
        $res = str_replace('*', '%2A', $res);
        $res = str_replace('%7E', '~', $res);

        return $res;
    }

    private function nonce(): string
    {
        return uniqid((string) mt_rand(0, 99999), true);
    }

    /** 把阿里云错误码翻译成对终端用户友好的中文提示 */
    private function friendlyError(string $code, string $message): string
    {
        $map = [
            'isv.BUSINESS_LIMIT_CONTROL'      => '验证码发送过于频繁，请稍后再试',
            'isv.MOBILE_NUMBER_ILLEGAL'       => '手机号格式不正确',
            'isv.TEMPLATE_MISSING_PARAMETERS' => '短信模板参数缺失，请联系管理员',
            'isv.SMS_SIGNATURE_ILLEGAL'       => '短信签名不合法，请联系管理员',
            'isv.SMS_TEMPLATE_ILLEGAL'        => '短信模板不合法，请联系管理员',
            'isv.AMOUNT_NOT_ENOUGH'           => '短信余额不足，请联系管理员',
            'isv.DAY_LIMIT_CONTROL'           => '今日发送已达上限，请明天再试',
        ];

        return $map[$code] ?? ('短信发送失败：' . $message);
    }
}
