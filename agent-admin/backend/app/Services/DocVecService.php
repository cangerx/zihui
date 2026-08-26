<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 文档向量索引服务（SQLite + sqlite-vec / PHP cosine 兜底）
 *
 * 设计取舍：
 * - 二级 SQLite 连接 'docvec'（config/database.php 里定义），文件 storage/app/docs-vectors.db
 * - 启动时尝试加载 sqlite-vec 扩展（vec0 模式，KNN 索引），失败自动降级到 PHP 自定义 cosine 函数（线性扫描）
 * - 主库 doc_chunks.id 作为本库 chunk_id（跨库关联），doc_id 不在本库存储以减少冗余
 * - 向量统一存为 FLOAT32 packed BLOB（fallback 模式），或 vec0 的 FLOAT[dim] 列（vec0 模式）
 * - 切换 embedding 模型时维度可能变化，提供 dropAndRecreate() 由 admin 「全量重建」按钮调用
 *
 * 维度策略：
 *   - vec0 表创建时必须知道维度（FLOAT[1536]），表创建后维度不可变
 *   - 切换 embedding 模型导致维度变化时，必须先 dropAndRecreate(newDim)
 *   - fallback 模式不锁维度，dim 字段记录每行实际维度，搜索时按 model 过滤
 *
 * 距离函数：
 *   - vec0: 默认 L2（distance 列）。要求输入向量归一化（OpenAI 等 embedding 默认归一化）
 *   - fallback: PHP 自定义 cosine_dist 函数，返回 1 - cosine_similarity（越小越相似）
 *   - 两种模式 ORDER BY distance ASC LIMIT N，调用方拿到的 distance 都是「越小越相似」
 */
class DocVecService
{
    private const TABLE_VEC0 = 'doc_vec_index';
    private const TABLE_FALLBACK = 'doc_chunks_vec';

    /** 'unknown' | 'vec0' | 'fallback' */
    private string $mode = 'unknown';
    private bool $initialized = false;

    public function __construct()
    {
        // 不在构造里初始化，因为 docvec 连接首次访问时 SQLite 文件才会被创建。
        // initialize() 在第一次实际 IO 时调用，避免 boot 期开销。
    }

    /**
     * 当前向量库模式：'vec0' = 启用 sqlite-vec / 'fallback' = PHP 自定义 cosine 函数兜底
     */
    public function mode(): string
    {
        $this->ensureInitialized();
        return $this->mode;
    }

    /**
     * 写入或覆盖单条向量。$embedding 必须是 float[]，长度即维度。
     */
    public function upsert(int $chunkId, array $embedding, string $model): bool
    {
        $this->ensureInitialized();
        $dim = count($embedding);
        if ($dim === 0) return false;

        // 写入前归一化，使 L2 距离与 cosine 距离单调一致（OpenAI embedding 已归一化，二次归一化不影响）
        $vec = $this->normalize($embedding);

        if ($this->mode === 'vec0') {
            $this->ensureVec0Table($dim);
            // vec0 不支持 INSERT OR REPLACE，先 DELETE 再 INSERT
            DB::connection('docvec')->delete(
                "DELETE FROM " . self::TABLE_VEC0 . " WHERE chunk_id = ?",
                [$chunkId]
            );
            DB::connection('docvec')->insert(
                "INSERT INTO " . self::TABLE_VEC0 . "(chunk_id, embedding) VALUES (?, ?)",
                [$chunkId, $this->vec0Encode($vec)]
            );
        } else {
            $blob = $this->packBlob($vec);
            // SQLite 的 PDO 默认会按字符串绑定 blob，需用 SQL 显式 INSERT OR REPLACE
            DB::connection('docvec')->statement(
                "INSERT OR REPLACE INTO " . self::TABLE_FALLBACK
                . "(chunk_id, embedding, model, dim) VALUES (?, ?, ?, ?)",
                [$chunkId, $blob, $model, $dim]
            );
        }
        return true;
    }

    /**
     * KNN 检索：返回 [{chunk_id, distance}, ...]，按 distance 升序（越小越相似）
     *
     * @param array<float> $queryEmbedding 查询向量
     * @param int $topK 返回 top K 条
     * @param string|null $model 仅 fallback 模式生效，按 embedding_model 过滤
     */
    public function search(array $queryEmbedding, int $topK = 8, ?string $model = null): array
    {
        $this->ensureInitialized();
        if (empty($queryEmbedding)) return [];

        $vec = $this->normalize($queryEmbedding);

        if ($this->mode === 'vec0') {
            // 表不存在则返回空（首次还没写过向量的情况）
            if (!$this->vec0TableExists()) return [];
            $rows = DB::connection('docvec')->select(
                "SELECT chunk_id, distance FROM " . self::TABLE_VEC0
                . " WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
                [$this->vec0Encode($vec), $topK]
            );
        } else {
            $sql = "SELECT chunk_id, cosine_dist(embedding, ?) AS distance FROM " . self::TABLE_FALLBACK;
            $bindings = [$this->packBlob($vec)];
            if ($model !== null && $model !== '') {
                $sql .= " WHERE model = ?";
                $bindings[] = $model;
            }
            $sql .= " ORDER BY distance ASC LIMIT ?";
            $bindings[] = $topK;
            $rows = DB::connection('docvec')->select($sql, $bindings);
        }

        return array_map(fn($r) => [
            'chunk_id' => (int) $r->chunk_id,
            'distance' => (float) $r->distance,
        ], $rows);
    }

    /**
     * 按 chunk_id 列表批量删除（CASCADE 删除文档时一起清理）
     */
    public function deleteByChunkIds(array $chunkIds): int
    {
        if (empty($chunkIds)) return 0;
        $this->ensureInitialized();
        $table = $this->mode === 'vec0' ? self::TABLE_VEC0 : self::TABLE_FALLBACK;
        $chunkIds = array_map('intval', $chunkIds);
        $placeholders = implode(',', array_fill(0, count($chunkIds), '?'));
        return DB::connection('docvec')->delete(
            "DELETE FROM {$table} WHERE chunk_id IN ({$placeholders})",
            $chunkIds
        );
    }

    /**
     * 删除某 doc 的所有向量（供 doc destroy / 重新索引时清旧向量用）
     * 通过 mysql doc_chunks 反查 chunk_id 列表
     */
    public function deleteByDocId(int $docId): int
    {
        $chunkIds = DB::connection('mysql')->table('doc_chunks')
            ->where('doc_id', $docId)
            ->pluck('id')
            ->all();
        return $this->deleteByChunkIds($chunkIds);
    }

    /**
     * 全量重建：drop 表（vec0 / fallback 都重新建）
     * admin「切换 embedding 模型 + 全量重建」按钮触发
     */
    public function dropAndRecreate(): void
    {
        $this->ensureInitialized();
        if ($this->mode === 'vec0') {
            DB::connection('docvec')->statement("DROP TABLE IF EXISTS " . self::TABLE_VEC0);
            // vec0 表延迟到下次 upsert 按新维度建
        } else {
            DB::connection('docvec')->statement("DROP TABLE IF EXISTS " . self::TABLE_FALLBACK);
            $this->ensureFallbackTable();
        }
    }

    /**
     * 已索引向量行数（admin 统计用）
     */
    public function indexedCount(): int
    {
        $this->ensureInitialized();
        if ($this->mode === 'vec0') {
            if (!$this->vec0TableExists()) return 0;
            $row = DB::connection('docvec')->selectOne("SELECT COUNT(*) AS cnt FROM " . self::TABLE_VEC0);
        } else {
            $row = DB::connection('docvec')->selectOne("SELECT COUNT(*) AS cnt FROM " . self::TABLE_FALLBACK);
        }
        return (int) ($row->cnt ?? 0);
    }

    // =========================================================================
    // Initialization
    // =========================================================================

    private function ensureInitialized(): void
    {
        if ($this->initialized) return;

        // 确保 SQLite 文件父目录存在 + 文件本身存在
        // Laravel SqliteConnector::connect() 会先 file_exists 检查；不存在直接抛
        // 「Database file at path [xxx] does not exist」InvalidArgumentException
        // 所以这里必须主动 touch 创建空文件（SQLite 打开空文件会被识别为新库）
        $dbPath = (string) config('database.connections.docvec.database');
        if ($dbPath === '') {
            throw new \RuntimeException('docvec 数据库路径未配置（config/database.php 检查 connections.docvec.database）');
        }
        $dir = dirname($dbPath);
        if (!is_dir($dir) && !@mkdir($dir, 0755, true) && !is_dir($dir)) {
            throw new \RuntimeException("docvec 目录不可写：{$dir}");
        }
        if (!file_exists($dbPath)) {
            // 用 fopen+fclose 比 touch 更兼容（某些主机 touch 函数被禁）；
            // 失败时给出可执行修复命令，便于运维定位
            $handle = @fopen($dbPath, 'a');
            if ($handle === false) {
                throw new \RuntimeException(
                    "docvec 数据库文件无法创建：{$dbPath}（请确保 storage/app 目录对 PHP 进程用户可写：" .
                    "chown -R www-data:www-data " . dirname($dbPath) . " && chmod -R 775 " . dirname($dbPath) . "）"
                );
            }
            fclose($handle);
            // SQLite 文件需要 PHP 进程能读写，赋默认 664（umask 通常会再砍一刀）
            @chmod($dbPath, 0664);
        }

        $pdo = DB::connection('docvec')->getPdo();

        // SQLite WAL 模式更适合并发读多写少（KNN 查询多）
        try {
            $pdo->exec('PRAGMA journal_mode=WAL');
            $pdo->exec('PRAGMA synchronous=NORMAL');
        } catch (\Throwable $e) {
            // 忽略 PRAGMA 失败，不影响功能
        }

        // 尝试加载 sqlite-vec 扩展
        $loaded = $this->tryLoadVecExtension($pdo);
        if ($loaded) {
            $this->mode = 'vec0';
        } else {
            $this->mode = 'fallback';
            // 注册 PHP 自定义 cosine_dist 函数；DETERMINISTIC 让查询优化器知道相同输入返回相同输出
            $pdo->sqliteCreateFunction('cosine_dist', [self::class, 'cosineDistanceFn'], 2, \PDO::SQLITE_DETERMINISTIC);
            $this->ensureFallbackTable();
        }

        $this->initialized = true;
    }

    /**
     * 尝试加载 sqlite-vec 扩展。文件路径：storage/app/sqlite-vec/vec0.{dll|so}
     * 加载失败有几种典型原因：
     *   1. 扩展文件未放置（更新包未带 vec0.dll/.so）→ 静默降级
     *   2. PHP 编译时未启用 pdo_sqlite 的 loadExtension → 静默降级
     *   3. ABI 不兼容（SQLite 版本太旧）→ 静默降级
     */
    private function tryLoadVecExtension(\PDO $pdo): bool
    {
        $isWin = stripos(PHP_OS, 'WIN') === 0;
        $libname = $isWin ? 'vec0.dll' : 'vec0.so';
        $path = storage_path('app/sqlite-vec/' . $libname);

        if (!is_file($path)) {
            return false;
        }

        try {
            // PDO::loadExtension 需要 SQLite 编译时启用 SQLITE_LOAD_EXTENSION
            // 部分 PHP 发行版禁用了该能力，loadExtension 会抛 PDOException
            $pdo->loadExtension($path);
            return true;
        } catch (\Throwable $e) {
            Log::info('[DocVec] sqlite-vec extension load failed, fallback to PHP cosine', [
                'path' => $path,
                'err'  => $e->getMessage(),
            ]);
            return false;
        }
    }

    private function ensureFallbackTable(): void
    {
        DB::connection('docvec')->statement(
            "CREATE TABLE IF NOT EXISTS " . self::TABLE_FALLBACK . " ("
            . "chunk_id INTEGER PRIMARY KEY,"
            . "embedding BLOB NOT NULL,"
            . "model TEXT NOT NULL,"
            . "dim INTEGER NOT NULL"
            . ")"
        );
        DB::connection('docvec')->statement(
            "CREATE INDEX IF NOT EXISTS idx_doc_chunks_vec_model ON " . self::TABLE_FALLBACK . "(model)"
        );
    }

    private function vec0TableExists(): bool
    {
        $row = DB::connection('docvec')->selectOne(
            "SELECT name FROM sqlite_master WHERE type IN ('virtual', 'table') AND name = ?",
            [self::TABLE_VEC0]
        );
        return $row !== null;
    }

    private function ensureVec0Table(int $dim): void
    {
        if ($this->vec0TableExists()) return;
        // vec0 创建语法：CREATE VIRTUAL TABLE name USING vec0(col INTEGER PRIMARY KEY, embedding FLOAT[dim])
        $sql = sprintf(
            "CREATE VIRTUAL TABLE %s USING vec0(chunk_id INTEGER PRIMARY KEY, embedding FLOAT[%d])",
            self::TABLE_VEC0,
            $dim
        );
        DB::connection('docvec')->statement($sql);
    }

    // =========================================================================
    // Vector helpers
    // =========================================================================

    /**
     * vec0 模式的查询向量编码：sqlite-vec 接受 JSON 数组字符串
     */
    private function vec0Encode(array $vec): string
    {
        return '[' . implode(',', array_map(fn($v) => sprintf('%.8f', (float) $v), $vec)) . ']';
    }

    /**
     * fallback 模式：array<float> → packed float32 BLOB（small-endian，与 unpack('f*') 一致）
     */
    private function packBlob(array $vec): string
    {
        // PHP 7.4+ 支持 spread；用动态方式以兼容老版本
        return call_user_func_array('pack', array_merge(['f*'], array_map('floatval', $vec)));
    }

    /**
     * L2 归一化（unit vector），确保 L2 距离与 cosine 距离单调
     */
    private function normalize(array $vec): array
    {
        $norm = 0.0;
        foreach ($vec as $v) $norm += ((float) $v) * ((float) $v);
        $norm = sqrt($norm);
        if ($norm <= 1e-12) return $vec;  // 全零向量直接返回
        return array_map(fn($v) => ((float) $v) / $norm, $vec);
    }

    /**
     * SQLite 自定义函数：cosine 距离 = 1 - cosine_similarity
     * 输入两个 packed float32 BLOB；维度不匹配返回 1.0（最远）
     *
     * 静态方法供 sqliteCreateFunction 注册使用
     */
    public static function cosineDistanceFn(string $aBlob, string $bBlob): float
    {
        $a = unpack('f*', $aBlob);
        $b = unpack('f*', $bBlob);
        if ($a === false || $b === false) return 1.0;
        $n = count($a);
        if ($n === 0 || $n !== count($b)) return 1.0;

        $dot = 0.0;
        $na = 0.0;
        $nb = 0.0;
        for ($i = 1; $i <= $n; $i++) {
            $va = $a[$i];
            $vb = $b[$i];
            $dot += $va * $vb;
            $na  += $va * $va;
            $nb  += $vb * $vb;
        }
        if ($na <= 0 || $nb <= 0) return 1.0;
        return 1.0 - ($dot / sqrt($na * $nb));
    }
}
