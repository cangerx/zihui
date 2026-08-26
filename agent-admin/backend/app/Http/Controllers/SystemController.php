<?php

namespace App\Http\Controllers;

use Illuminate\Support\Facades\Artisan;

class SystemController extends Controller
{
    public function clearCache()
    {
        Artisan::call('cache:clear');
        Artisan::call('config:clear');
        Artisan::call('route:clear');
        Artisan::call('view:clear');

        return response()->json(['message' => 'Cache cleared']);
    }
}
