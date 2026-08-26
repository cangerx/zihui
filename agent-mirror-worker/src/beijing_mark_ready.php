<?php

$id = getenv('MIRROR_BUILD_ID');
$primary = getenv('MIRROR_PRIMARY');
$root = rtrim((string) (config('cloudbuild.storage.root') ?: ''), DIRECTORY_SEPARATOR);
if ($root === '') {
    $root = storage_path('app/cloud-build-artifacts');
}
$dir = $root . DIRECTORY_SEPARATOR . $id;
$arts = App\Models\CloudBuildArtifact::query()->where('build_id', $id)->get();
if ($arts->isEmpty()) {
    fwrite(STDERR, "no_artifacts\n");
    exit(2);
}
foreach ($arts as $art) {
    $path = $dir . DIRECTORY_SEPARATOR . $art->filename;
    if (!is_file($path)) {
        fwrite(STDERR, 'missing:' . $art->filename . "\n");
        exit(3);
    }
    $art->storage_path = $path;
    $art->size = filesize($path);
    $art->save();
}
$job = App\Models\CloudBuildJob::query()->where('build_id', $id)->first();
if (!$job) {
    fwrite(STDERR, "job_missing\n");
    exit(4);
}
if ($job->phase === 'artifact_pending') {
    app(App\Services\CloudBuild\CloudBuildJobClaimer::class)->transition($job, 'ready', [
        'mirror_url_primary' => $dir . DIRECTORY_SEPARATOR . $primary,
        'mirror_assigned_at' => null,
        'claim_owner' => null,
        'claimed_at' => null,
        'error_message' => null,
    ]);
}
echo $job->fresh()->phase, PHP_EOL;
