<?php

namespace App\Services\ModelRef;

use InvalidArgumentException;

class OfficialModelRefService
{
    /** @var list<array<string,mixed>> */
    private array $items;

    /** @var array<string,int> */
    private array $index = [];

    /** @param list<array<string,mixed>>|null $items */
    public function __construct(?array $items = null)
    {
        $this->items = $items ?? (array) (config('official_model_refs.items') ?? []);
        $this->buildIndex();
    }

    /**
     * @return array{found:bool,id:?string,modality:?string,unit:?string,amount_cny:?float,text:string,source_url:string,captured_at:string}
     */
    public function lookup(string $modelId, ?string $modality = null): array
    {
        $empty = [
            'found' => false,
            'id' => null,
            'modality' => $modality,
            'unit' => null,
            'amount_cny' => null,
            'text' => '',
            'source_url' => '',
            'captured_at' => '',
        ];
        $key = $this->normalize($modelId);
        if ($key === '' || !isset($this->index[$key])) {
            return $empty;
        }
        $item = $this->items[$this->index[$key]];
        if ($modality !== null && $modality !== '' && (string) ($item['modality'] ?? '') !== $modality) {
            return $empty;
        }
        $amount = $item['amount_cny'] ?? null;

        return [
            'found' => true,
            'id' => (string) ($item['id'] ?? ''),
            'modality' => (string) ($item['modality'] ?? ''),
            'unit' => (string) ($item['unit'] ?? ''),
            'amount_cny' => is_numeric($amount) ? (float) $amount : null,
            'text' => (string) ($item['text'] ?? ''),
            'source_url' => (string) ($item['source_url'] ?? ''),
            'captured_at' => (string) ($item['captured_at'] ?? ''),
        ];
    }

    private function buildIndex(): void
    {
        foreach ($this->items as $offset => $item) {
            $keys = [(string) ($item['id'] ?? '')];
            foreach ((array) ($item['aliases'] ?? []) as $alias) {
                $keys[] = (string) $alias;
            }
            foreach ($keys as $raw) {
                $key = $this->normalize($raw);
                if ($key === '') {
                    continue;
                }
                if (isset($this->index[$key]) && $this->index[$key] !== $offset) {
                    throw new InvalidArgumentException('官方参考目录别名冲突：' . $raw);
                }
                $this->index[$key] = $offset;
            }
        }
    }

    private function normalize(string $value): string
    {
        return strtolower(preg_replace('/\s+/', '', trim($value)) ?? '');
    }
}
