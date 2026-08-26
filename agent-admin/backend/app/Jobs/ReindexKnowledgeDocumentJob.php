<?php

namespace App\Jobs;

use App\Models\KbDocument;
use App\Services\Knowledge\KbRagService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * 知识库文档向量化（异步索引）。
 *
 * 执行模式（与 ProcessMattingTaskJob 一致）：
 *   - QUEUE_CONNECTION=sync（默认）→ Controller 用 terminating callback 在响应后跑 handle()
 *   - QUEUE_CONNECTION=database     → ::dispatch() 入队，worker 拉取
 *
 * 配套 worker：
 *   php artisan queue:work database --queue=kb-index,image,default --tries=2 --timeout=300 --sleep=2
 */
class ReindexKnowledgeDocumentJob implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 2;
    public int $timeout = 300;

    public function backoff(): int
    {
        return 10;
    }

    public function __construct(public int $documentId)
    {
        $this->onQueue('kb-index');
    }

    public function handle(KbRagService $rag): void
    {
        @set_time_limit(0);

        $doc = KbDocument::find($this->documentId);
        if (!$doc) {
            Log::warning("[ReindexKnowledgeDocumentJob] doc {$this->documentId} not found");
            return;
        }

        // reindexDocument 内部负责置 processing/ready/failed 状态
        $rag->reindexDocument($this->documentId);
    }

    public function failed(Throwable $e): void
    {
        $doc = KbDocument::find($this->documentId);
        if ($doc && $doc->index_status !== KbDocument::STATUS_READY) {
            $doc->update([
                'index_status' => KbDocument::STATUS_FAILED,
                'index_error' => 'Job failed: ' . mb_substr($e->getMessage(), 0, 480, 'UTF-8'),
            ]);
        }
        Log::error("[ReindexKnowledgeDocumentJob] {$this->documentId} permanently failed: {$e->getMessage()}");
    }
}
