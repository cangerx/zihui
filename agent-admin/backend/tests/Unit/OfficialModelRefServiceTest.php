<?php

namespace Tests\Unit;

use App\Services\ModelRef\OfficialModelRefService;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class OfficialModelRefServiceTest extends TestCase
{
    private function service(): OfficialModelRefService
    {
        $config = require dirname(__DIR__, 2) . '/config/official_model_refs.php';

        return new OfficialModelRefService($config['items'] ?? []);
    }

    public function test_first_batch_official_ids_are_found(): void
    {
        $service = $this->service();
        foreach ([
            'doubao-seedance-2-0-260128',
            'doubao-seedance-2-0-fast-260128',
            'doubao-seedance-2-5',
            'MiniMax-H3',
            'kling-v3',
        ] as $id) {
            $hit = $service->lookup($id, 'video');
            $this->assertTrue($hit['found'], $id);
            $this->assertSame('video', $hit['modality']);
            $this->assertNotSame('', $hit['source_url']);
        }
    }

    public function test_alias_and_repeated_lookup_are_identical(): void
    {
        $service = $this->service();
        $first = $service->lookup('seedance-2.5', 'video');
        $second = $service->lookup('doubao-seedance-2-5', 'video');
        $third = $service->lookup('Seedance 2.5', 'video');

        $this->assertTrue($first['found']);
        $this->assertSame($first, $second);
        $this->assertSame($first, $third);
        $this->assertSame($first, $service->lookup('seedance-2.5', 'video'));
    }

    public function test_unlisted_and_unknown_ids_are_not_found(): void
    {
        $service = $this->service();
        $this->assertFalse($service->lookup('veo3.1-fast', 'video')['found']);
        $this->assertFalse($service->lookup('unknown-model-xyz')['found']);
        $this->assertFalse($service->lookup('')['found']);
    }

    public function test_modality_mismatch_does_not_cross(): void
    {
        $service = $this->service();
        $this->assertFalse($service->lookup('MiniMax-H3', 'chat')['found']);
        $this->assertTrue($service->lookup('MiniMax-H3', 'video')['found']);
        $this->assertTrue($service->lookup('MiniMax-H3')['found']);
    }

    public function test_conflicting_aliases_throw_on_load(): void
    {
        $this->expectException(InvalidArgumentException::class);
        new OfficialModelRefService([
            ['id' => 'a', 'aliases' => ['same'], 'modality' => 'video'],
            ['id' => 'b', 'aliases' => ['same'], 'modality' => 'video'],
        ]);
    }
}
