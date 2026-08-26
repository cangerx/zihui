<?php

namespace App\Services;

use App\Models\SyncBlob;
use App\Models\SyncDevice;
use App\Models\SyncRecord;
use App\Models\User;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * 结构化数据同步服务。
 *   - server_seq：每用户单调自增游标，pull 据此增量
 *   - 行级 base_rev 乐观并发：base_rev != 服务端 rev → 返回 conflict + 服务端当前版本，客户端合并后重推
 */
class SyncService
{
    // 敏感字段：入库前服务端加密，pull 下发前解密（明文仅经 HTTPS 传输）。
    private const SECRET_FIELDS = [
        'model_providers' => ['api_key'],
    ];

    private const ENC_PREFIX = 'enc:v1:';

    private function encryptPayload(string $entity, $payload)
    {
        if (!is_array($payload) || empty(self::SECRET_FIELDS[$entity])) return $payload;
        $fields = $payload['fields'] ?? null;
        if (!is_array($fields)) return $payload;
        foreach (self::SECRET_FIELDS[$entity] as $f) {
            $v = $fields[$f] ?? null;
            if (is_string($v) && $v !== '' && !str_starts_with($v, self::ENC_PREFIX)) {
                $fields[$f] = self::ENC_PREFIX . Crypt::encryptString($v);
            }
        }
        $payload['fields'] = $fields;
        return $payload;
    }

    private function decryptPayload(string $entity, $payload)
    {
        if (!is_array($payload) || empty(self::SECRET_FIELDS[$entity])) return $payload;
        $fields = $payload['fields'] ?? null;
        if (!is_array($fields)) return $payload;
        foreach (self::SECRET_FIELDS[$entity] as $f) {
            $v = $fields[$f] ?? null;
            if (is_string($v) && str_starts_with($v, self::ENC_PREFIX)) {
                try {
                    $fields[$f] = Crypt::decryptString(substr($v, strlen(self::ENC_PREFIX)));
                } catch (\Throwable $e) {
                    Log::warning('[sync] decrypt failed', ['entity' => $entity, 'field' => $f]);
                    $fields[$f] = '';
                }
            }
        }
        $payload['fields'] = $fields;
        return $payload;
    }

    /** 拉取增量。 */
    public function pull(User $user, int $sinceSeq, int $limit): array
    {
        $limit = max(1, min(1000, $limit));
        $rows = SyncRecord::where('user_id', $user->id)
            ->where('server_seq', '>', $sinceSeq)
            ->orderBy('server_seq')
            ->limit($limit)
            ->get();

        $changes = $rows->map(fn ($r) => $this->toChange($r))->all();
        $maxSeq = $rows->count() ? (int) $rows->last()->server_seq : $sinceSeq;
        $hasMore = $rows->count() === $limit
            && SyncRecord::where('user_id', $user->id)->where('server_seq', '>', $maxSeq)->exists();

        return ['changes' => $changes, 'max_seq' => $maxSeq, 'has_more' => $hasMore];
    }

    /** 推送本机变更。返回 ['results'=>[], 'new_max_seq'=>int]。 */
    public function push(User $user, array $changes, string $deviceId): array
    {
        // 同一用户的 push 串行化：事务内 max(server_seq) 是无锁快照读，两台设备并发
        // push 会分配到相同 seq 撞 (user_id, server_seq) 唯一键（整批 500）；行级
        // lockForUpdate 的加锁顺序由客户端给定，并发时也可能互为死锁。
        $lockName = "sync_push_{$user->id}";
        $got = DB::selectOne('SELECT GET_LOCK(?, 10) AS l', [$lockName]);
        if (!((int) ($got->l ?? 0))) {
            // 未拿到锁（另一设备正在 push）：返回空结果，客户端 oplog 保留下次重试
            return ['results' => [], 'new_max_seq' => 0];
        }
        try {
            return DB::transaction(function () use ($user, $changes, $deviceId) {
                return $this->applyChanges($user, $changes, $deviceId);
            });
        } finally {
            DB::selectOne('SELECT RELEASE_LOCK(?) AS r', [$lockName]);
        }
    }

    private function applyChanges(User $user, array $changes, string $deviceId): array
    {
        // 引用完整性：非删除变更引用的 blob 必须已 committed。否则缺媒体的记录会
        // 让其它设备对该 blob 永久 404 重试；也兜住「秒传探测后 blob 被 GC」竞态。
        $allShas = [];
        foreach ($changes as $ch) {
            if (!empty($ch['deleted'])) continue;
            foreach ((array) ($ch['blobs'] ?? []) as $s) {
                if (is_string($s) && preg_match('/^[a-f0-9]{64}$/', $s)) $allShas[$s] = true;
            }
        }
        $committed = [];
        if ($allShas) {
            $committed = array_flip(SyncBlob::where('user_id', $user->id)
                ->whereIn('sha256', array_keys($allShas))
                ->where('status', 'committed')
                ->pluck('sha256')
                ->all());
        }

        $seq = (int) SyncRecord::where('user_id', $user->id)->max('server_seq');
        $results = [];

        foreach ($changes as $ch) {
            $entity = (string) ($ch['entity'] ?? '');
            $uid = (string) ($ch['uid'] ?? '');
            if ($entity === '' || $uid === '') continue;
            // 列宽防御：超长 entity/uid 直接拒绝该条，避免 MySQL 报错使整批 500
            if (!preg_match('/^[a-z0-9_]{1,40}$/', $entity) || strlen($uid) > 64) {
                $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'rejected', 'reason' => 'invalid_change'];
                continue;
            }
            if (empty($ch['deleted'])) {
                $missing = [];
                foreach ((array) ($ch['blobs'] ?? []) as $s) {
                    if (is_string($s) && $s !== '' && !isset($committed[$s])) $missing[] = $s;
                }
                if ($missing) {
                    $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'rejected', 'reason' => 'blob_missing'];
                    continue;
                }
            }
            $deleted = (bool) ($ch['deleted'] ?? false);
            $baseRev = (int) ($ch['base_rev'] ?? 0);
            $hash = (string) ($ch['content_hash'] ?? '');
            $updatedMs = (int) ($ch['updated_ms'] ?? 0);
            $payload = $ch['payload'] ?? null;

            $existing = SyncRecord::where('user_id', $user->id)
                ->where('entity', $entity)
                ->where('sync_uid', $uid)
                ->lockForUpdate()
                ->first();

            if ($deleted) {
                if (!$existing || $existing->deleted) {
                    $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'applied', 'rev' => $existing->rev ?? 0];
                    continue;
                }
                if ($baseRev !== (int) $existing->rev) {
                    $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'conflict', 'remote' => $this->toChange($existing)];
                    continue;
                }
                $seq++;
                $existing->rev = (int) $existing->rev + 1;
                $existing->deleted = true;
                $existing->payload = null;
                $existing->content_hash = '';
                $existing->updated_ms = $updatedMs;
                $existing->server_seq = $seq;
                $existing->origin_device = $deviceId;
                $existing->save();
                $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'applied', 'rev' => $existing->rev, 'server_seq' => $seq];
                continue;
            }

            // upsert
            if ($existing && !$existing->deleted && $existing->content_hash === $hash && $hash !== '') {
                // 内容一致：幂等，不消耗 seq
                $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'applied', 'rev' => (int) $existing->rev];
                continue;
            }

            $baseMatch = !$existing || $baseRev === (int) $existing->rev;
            if ($existing && !$baseMatch) {
                $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'conflict', 'remote' => $this->toChange($existing)];
                continue;
            }

            $seq++;
            $newRev = $existing ? (int) $existing->rev + 1 : 1;
            $storePayload = $this->encryptPayload($entity, $payload);
            SyncRecord::updateOrCreate(
                ['user_id' => $user->id, 'entity' => $entity, 'sync_uid' => $uid],
                [
                    'server_seq' => $seq,
                    'rev' => $newRev,
                    'deleted' => false,
                    'content_hash' => $hash,
                    'updated_ms' => $updatedMs,
                    'origin_device' => $deviceId,
                    'payload' => $storePayload !== null ? json_encode($storePayload, JSON_UNESCAPED_UNICODE) : null,
                ],
            );
            $results[] = ['entity' => $entity, 'uid' => $uid, 'status' => 'applied', 'rev' => $newRev, 'server_seq' => $seq];
        }

        if ($deviceId !== '') {
            SyncDevice::updateOrCreate(
                ['user_id' => $user->id, 'device_id' => $deviceId],
                ['last_seq' => $seq, 'last_sync_at' => now()],
            );
        }

        return ['results' => $results, 'new_max_seq' => $seq];
    }

    private function toChange(SyncRecord $r): array
    {
        $payload = $r->deleted || $r->payload === null ? null : json_decode($r->payload, true);
        if ($payload !== null) {
            $payload = $this->decryptPayload($r->entity, $payload);
        }
        return [
            'server_seq' => (int) $r->server_seq,
            'entity' => $r->entity,
            'uid' => $r->sync_uid,
            'rev' => (int) $r->rev,
            'deleted' => (bool) $r->deleted,
            'content_hash' => (string) $r->content_hash,
            'updated_ms' => (int) $r->updated_ms,
            'payload' => $payload,
        ];
    }
}
