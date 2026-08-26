<?php

namespace Tests\Unit;

use App\Services\Hub\HubReviewerSubmitPolicy;
use PHPUnit\Framework\TestCase;

class HubReviewerSubmitPolicyTest extends TestCase
{
    public function test_reviewer_submits_approved_and_bypasses_quota(): void
    {
        $client = (object) ['is_hub_reviewer' => true];
        $this->assertTrue(HubReviewerSubmitPolicy::isReviewer($client));
        $this->assertSame('approved', HubReviewerSubmitPolicy::initialStatus($client));
        $this->assertTrue(HubReviewerSubmitPolicy::bypassDailyLimit($client));
    }

    public function test_ordinary_client_stays_pending_and_uses_quota(): void
    {
        $client = (object) ['is_hub_reviewer' => false];
        $this->assertFalse(HubReviewerSubmitPolicy::isReviewer($client));
        $this->assertSame('pending', HubReviewerSubmitPolicy::initialStatus($client));
        $this->assertFalse(HubReviewerSubmitPolicy::bypassDailyLimit($client));
    }
}
