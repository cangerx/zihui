<?php

namespace App\Http\Controllers\App\V1;

use App\Models\CloudModel;
use App\Models\ModelAssignment;
use App\Support\AppV1Response;
use Illuminate\Http\Request;

class ModelController
{
    public function index(Request $request)
    {
        $user = auth()->user();
        $groupIds = $user->groups()->pluck('user_groups.id')->all();
        $direct = ModelAssignment::where('assignee_type', 'user')->where('assignee_id', $user->id)->pluck('cloud_model_id')->all();
        $group = $groupIds === [] ? [] : ModelAssignment::where('assignee_type', 'group')->whereIn('assignee_id', $groupIds)->pluck('cloud_model_id')->all();

        $query = CloudModel::query()
            ->whereIn('id', array_values(array_unique(array_merge($direct, $group))))
            ->where('status', 'active')
            ->whereHas('provider', fn ($provider) => $provider->where('status', 'active'))
            ->with('provider:id,name,type')
            ->orderBy('id');
        if ($request->filled('type')) $query->where('type', $request->string('type')->toString());

        $models = $query->get()->map(fn ($model) => [
            'id' => (int) $model->id,
            'model_id' => (string) $model->model_id,
            'name' => (string) $model->name,
            'type' => (string) $model->type,
            'provider_name' => (string) ($model->provider->name ?? ''),
            'provider_type' => (string) ($model->provider->type ?? ''),
        ])->values()->all();

        return AppV1Response::ok($models);
    }
}
