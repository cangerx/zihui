<?php

namespace Tests\Unit;

use App\Models\CloudBuildQuota;
use Carbon\Carbon;

class CloudBuildQuotaServiceTest extends CloudBuildExecutionTestCase
{
    public function test_incr_and_decr_do_not_go_below_zero(): void
    {
        $this->seedClient();
        $today = Carbon::now()->toDateString();

        $this->assertSame(0, $this->quota->getDailyCount('client-a', $today));
        $this->assertSame(1, $this->quota->incrDailyCount('client-a', $today));
        $this->assertSame(2, $this->quota->incrDailyCount('client-a', $today));
        $this->assertSame(1, $this->quota->decrDailyCount('client-a', $today));
        $this->assertSame(0, $this->quota->decrDailyCount('client-a', $today));
        $this->assertSame(0, $this->quota->decrDailyCount('client-a', $today));

        $row = CloudBuildQuota::query()->where('client_ref', 'client-a')->first();
        $this->assertNotNull($row);
        $this->assertSame(0, (int) $row->consumed);
    }
}
