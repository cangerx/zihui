<?php

return [
    /*
    |--------------------------------------------------------------------------
    | AI Deck 资源分发（三层模型）的母 CDN 约定
    |--------------------------------------------------------------------------
    | 母 CDN 人工上传 ffmpeg 二进制与模板包，云控端据本配置「自检完备性」并「一键拉取」
    | 下载固化到本站 public，再经 client manifest 下发桌面端。
    | 改成自检后，管理员不再手填资产 / 粘贴 manifest，只需把文件上传到下方约定地址。
    */

    // 母 CDN 基址：ffmpeg 二进制存于 {base}/ffmpeg/{platform}/，模板包存于 {base}/pptdemo/
    'mother_cdn' => rtrim(env('DECK_MOTHER_CDN', 'https://your-cdn-domain.example.com'), '/'),

    // 模板期望清单：pack-deck-templates 产出的 manifest.json 上传到此固定地址，
    // 云控端自检时拉它作为「应有哪些模板」的权威依据（替代旧的人工粘贴 manifest 内容）。
    'template_manifest_url' => env('DECK_TEMPLATE_MANIFEST_URL', 'https://your-cdn-domain.example.com/pptdemo/manifest.json'),

    // ffmpeg 期望清单（固定）：3 平台 × {ffmpeg, ffprobe} = 6 项，url 按 {base}/ffmpeg/{platform}/{bin}{.exe} 生成
    'ffmpeg_platforms' => ['win32-x64', 'darwin-x64', 'darwin-arm64'],
    'ffmpeg_binaries'  => ['ffmpeg', 'ffprobe'],
];
