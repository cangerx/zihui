<?php

namespace App\Http\Controllers;

use App\Models\UsageRecord;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class UsageRecordController extends Controller
{
    public function index(Request $request)
    {
        $query = UsageRecord::with([
            'user:id,username,nickname',
            'cloudModel:id,provider_id,model_id,name,type',
            'cloudModel.provider:id,name',
        ]);

        if ($request->filled('user_id')) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->filled('cloud_model_id')) {
            $query->where('cloud_model_id', $request->cloud_model_id);
        }
        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }
        if ($request->filled('status')) {
            $query->where('status', $request->status);
        }
        if ($request->filled('start_date')) {
            $query->where('created_at', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->where('created_at', '<=', $request->end_date . ' 23:59:59');
        }

        $records = $query->orderByDesc('id')->paginate($request->get('per_page', 50));
        return response()->json($records);
    }

    public function stats(Request $request)
    {
        $query = UsageRecord::where('status', 'success');

        if ($request->filled('user_id')) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->filled('cloud_model_id')) {
            $query->where('cloud_model_id', $request->cloud_model_id);
        }
        if ($request->filled('type')) {
            $query->where('type', $request->type);
        }
        if ($request->filled('start_date')) {
            $query->where('created_at', '>=', $request->start_date);
        }
        if ($request->filled('end_date')) {
            $query->where('created_at', '<=', $request->end_date . ' 23:59:59');
        }

        $totalCalls = (clone $query)->count();
        $totalTokens = (clone $query)->where('balance_type', 'token')->sum('total_tokens');
        $totalTokenCost = (clone $query)->where('balance_type', 'token')->sum('cost');
        $totalCredits = (clone $query)->where('balance_type', 'credit')->sum('cost');

        $byModel = (clone $query)->select(
            'cloud_model_id',
            'balance_type',
            DB::raw('COUNT(*) as calls'),
            DB::raw('SUM(total_tokens) as tokens'),
            DB::raw('SUM(cost) as cost')
        )->groupBy('cloud_model_id', 'balance_type')->with([
            'cloudModel:id,provider_id,model_id,name,type',
            'cloudModel.provider:id,name',
        ])->get();

        $daily = (clone $query)->select(
            DB::raw('DATE(created_at) as date'),
            DB::raw('COUNT(*) as calls'),
            DB::raw("SUM(CASE WHEN balance_type='token' THEN cost ELSE 0 END) as token_cost"),
            DB::raw("SUM(CASE WHEN balance_type='credit' THEN cost ELSE 0 END) as credit_cost")
        )->groupBy('date')->orderBy('date')->get();

        return response()->json([
            'total_calls' => $totalCalls,
            'total_tokens' => (int)$totalTokens,
            'total_token_cost' => (float)$totalTokenCost,
            'total_credits' => (float)$totalCredits,
            'by_model' => $byModel,
            'daily' => $daily,
        ]);
    }
}
