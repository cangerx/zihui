<?php

$id = getenv('MIRROR_BUILD_ID');
$job = App\Models\CloudBuildJob::query()->where('build_id', $id)->first();
if (!$job) {
    fwrite(STDERR, "job_missing\n");
    exit(2);
}
echo json_encode($job->release_assets ?: []);
