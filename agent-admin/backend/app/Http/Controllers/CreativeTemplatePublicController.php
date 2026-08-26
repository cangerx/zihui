<?php

namespace App\Http\Controllers;

use App\Models\CreativeTemplate;
use App\Models\CreativeTemplateCategory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CreativeTemplatePublicController extends Controller
{
    public function categories(): JsonResponse
    {
        $categories = CreativeTemplateCategory::query()
            ->where('is_visible', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get(['id', 'name', 'description', 'sort_order']);

        return response()->json(['data' => $categories]);
    }

    public function list(Request $request): JsonResponse
    {
        $query = CreativeTemplate::with('category')
            ->where('is_visible', true)
            ->where('submission_status', CreativeTemplate::STATUS_APPROVED)
            ->whereHas('category', fn($q) => $q->where('is_visible', true))
            ->orderBy('sort_order')
            ->orderByDesc('id');

        if ($request->filled('category_id')) {
            $query->where('category_id', $request->input('category_id'));
        }
        if ($request->filled('search')) {
            $s = (string) $request->input('search');
            $query->where(function ($q) use ($s) {
                $q->where('title', 'like', "%{$s}%")
                    ->orWhere('description', 'like', "%{$s}%")
                    ->orWhere('prompt_template', 'like', "%{$s}%");
            });
        }

        $perPage = min((int) $request->input('per_page', 24), 100);
        $paginated = $query->paginate($perPage);
        $items = collect($paginated->items())->map(fn(CreativeTemplate $template) => $this->serializeTemplate($template))->values();

        return response()->json([
            'items' => $items,
            'total' => $paginated->total(),
            'current_page' => $paginated->currentPage(),
            'per_page' => $paginated->perPage(),
        ]);
    }

    public function show(int $id): JsonResponse
    {
        $template = CreativeTemplate::with('category')
            ->where('is_visible', true)
            ->where('submission_status', CreativeTemplate::STATUS_APPROVED)
            ->whereHas('category', fn($q) => $q->where('is_visible', true))
            ->find($id);
        if (!$template) return response()->json(['error' => 'not_found'], 404);
        return response()->json($this->serializeTemplate($template));
    }

    private function serializeTemplate(CreativeTemplate $template): array
    {
        return [
            'id' => (int) $template->id,
            'category_id' => (int) $template->category_id,
            'category_name' => $template->category?->name,
            'title' => (string) $template->title,
            'description' => (string) $template->description,
            'cover_image' => (string) $template->cover_image,
            'cover_thumb' => (string) $template->cover_thumb,
            'example_ref_images' => is_array($template->example_ref_images) ? $template->example_ref_images : [],
            'requires_ref_image' => (bool) $template->requires_ref_image,
            'default_size' => (string) $template->default_size,
            'prompt_template' => (string) $template->prompt_template,
            'variables' => is_array($template->variables) ? $template->variables : [],
            'sort_order' => (int) $template->sort_order,
            'updated_at' => optional($template->updated_at)->toIso8601String(),
        ];
    }
}
