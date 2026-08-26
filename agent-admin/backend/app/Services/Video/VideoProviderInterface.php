<?php

namespace App\Services\Video;

use App\Models\VideoProviderAccount;
use App\Models\VideoTask;

interface VideoProviderInterface
{
    public function submit(VideoTask $task, VideoProviderAccount $account): VideoSubmitResult;

    public function query(VideoTask $task, VideoProviderAccount $account): VideoQueryResult;

    public function cancel(VideoTask $task, VideoProviderAccount $account): VideoQueryResult;

    public function test(VideoProviderAccount $account): array;
}
