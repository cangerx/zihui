<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Packaging\PackagingLicenseSettings;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Validator;

class PackagingLicenseSettingController extends Controller
{
    public function __construct(private PackagingLicenseSettings $settings)
    {
    }

    public function show(): JsonResponse
    {
        return response()->json($this->settings->snapshot());
    }

    public function update(Request $request): JsonResponse
    {
        $validator = Validator::make($request->all(), [
            'win_price' => ['required', 'integer', 'min:0', 'max:100000'],
            'mac_price' => ['required', 'integer', 'min:0', 'max:100000'],
            'self_serve_enabled' => ['required', 'boolean'],
        ]);
        if ($validator->fails()) {
            return response()->json(['error' => 'validation_failed', 'details' => $validator->errors()], 422);
        }

        return response()->json($this->settings->save($validator->validated()));
    }
}
