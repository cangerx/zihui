<?php

namespace App\Services\SkillRegistry;

use InvalidArgumentException;

/**
 * Skill / Version 状态机。已发布版本不得原地改包，只能撤回。
 */
class SkillStateMachine
{
    public const SKILL_STATUSES = ['draft', 'active', 'suspended', 'retired'];

    public const VERSION_STATUSES = [
        'uploaded', 'scanning', 'pending_review', 'published', 'rejected', 'revoked',
    ];

    public const VERSION_TERMINAL = ['rejected', 'revoked'];

    /** @var array<string, list<string>> */
    private const SKILL = [
        'draft' => ['active', 'retired'],
        'active' => ['suspended', 'retired'],
        'suspended' => ['active', 'retired'],
        'retired' => [],
    ];

    /** @var array<string, list<string>> */
    private const VERSION = [
        'uploaded' => ['scanning', 'rejected'],
        'scanning' => ['pending_review', 'rejected'],
        'pending_review' => ['published', 'rejected'],
        'published' => ['revoked'],
        'rejected' => [],
        'revoked' => [],
    ];

    public function canSkill(string $from, string $to): bool
    {
        return $from === $to || in_array($to, self::SKILL[$from] ?? [], true);
    }

    public function canVersion(string $from, string $to): bool
    {
        return $from === $to || in_array($to, self::VERSION[$from] ?? [], true);
    }

    public function assertSkill(string $from, string $to): void
    {
        if (!$this->canSkill($from, $to)) {
            throw new InvalidArgumentException("illegal skill status: {$from} -> {$to}");
        }
    }

    public function assertVersion(string $from, string $to): void
    {
        if (!$this->canVersion($from, $to)) {
            throw new InvalidArgumentException("illegal version status: {$from} -> {$to}");
        }
        if (in_array($from, self::VERSION_TERMINAL, true) && $to !== $from) {
            throw new InvalidArgumentException("terminal version cannot resurrect: {$from} -> {$to}");
        }
        if ($from === 'published' && !in_array($to, ['published', 'revoked'], true)) {
            throw new InvalidArgumentException('published version is immutable');
        }
    }
}
