<?php

namespace Tests\Feature;

use App\Models\Plan;
use App\Models\User;
use App\Models\UserBalance;
use App\Models\UserPlan;
use App\Models\UserPlanQuota;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use RuntimeException;
use Tests\TestCase;
use Tymon\JWTAuth\Facades\JWTAuth;

class AppV1ProfileTest extends TestCase
{
    use RefreshDatabase;

    protected function migrateUsing(): array
    {
        return [
            '--path' => [
                'database/migrations/2024_01_01_000001_create_users_table.php',
                'database/migrations/2024_01_01_000008_create_user_balances_table.php',
                'database/migrations/2026_05_03_000001_create_system_settings_table.php',
                'database/migrations/2026_05_03_000004_create_plans_tables.php',
                'database/migrations/2026_07_15_000001_create_user_plan_quotas_table.php',
            ],
            '--seed' => false,
        ];
    }

    public function test_profile_and_balance_require_authentication(): void
    {
        $this->getJson('/api/app/v1/auth/me')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');

        $this->getJson('/api/app/v1/billing/balance')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');

        $this->postJson('/api/app/v1/auth/logout')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_profile_and_balance_are_scoped_to_current_user(): void
    {
        $owner = $this->user('owner', 'Owner Name');
        $other = $this->user('other', 'Other Name');
        $this->wallet($owner, 'credit', 12.5);
        $this->wallet($owner, 'token', 30);
        $this->wallet($other, 'credit', 999);
        $this->planQuota($owner, 'credit', 100, 25);

        $headers = ['Authorization' => 'Bearer '.$this->token($owner)];

        $this->withHeaders($headers)->getJson('/api/app/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.id', $owner->id)
            ->assertJsonPath('data.nickname', 'Owner Name')
            ->assertJsonMissing(['nickname' => 'Other Name'])
            ->assertJsonStructure(['data' => ['id', 'username', 'nickname', 'avatar', 'balances']]);

        $this->withHeaders($headers)->getJson('/api/app/v1/billing/balance')
            ->assertOk()
            ->assertJsonPath('data.0.type', 'token')
            ->assertJsonPath('data.0.wallet', 30)
            ->assertJsonPath('data.0.plan', 0)
            ->assertJsonPath('data.0.total', 30)
            ->assertJsonPath('data.1.type', 'credit')
            ->assertJsonPath('data.1.wallet', 12.5)
            ->assertJsonPath('data.1.plan', 75)
            ->assertJsonPath('data.1.total', 87.5);

        $otherHeaders = ['Authorization' => 'Bearer '.$this->token($other)];
        $this->withHeaders($otherHeaders)->getJson('/api/app/v1/auth/me')
            ->assertOk()
            ->assertJsonPath('data.id', $other->id)
            ->assertJsonMissing(['nickname' => 'Owner Name']);
        $this->withHeaders($otherHeaders)->getJson('/api/app/v1/billing/balance')
            ->assertOk()
            ->assertJsonPath('data.0.type', 'token')
            ->assertJsonPath('data.0.total', 0)
            ->assertJsonPath('data.1.type', 'credit')
            ->assertJsonPath('data.1.wallet', 999)
            ->assertJsonPath('data.1.plan', 0)
            ->assertJsonPath('data.1.total', 999);
    }

    public function test_logout_blacklists_the_current_token(): void
    {
        config(['jwt.blacklist_enabled' => true, 'jwt.blacklist_grace_period' => 0]);
        $user = $this->user('logout', 'Logout User');
        $token = $this->token($user);

        $this->withToken($token)->postJson('/api/app/v1/auth/logout')
            ->assertOk()
            ->assertJsonPath('data', null);

        $this->withToken($token)->getJson('/api/app/v1/auth/me')
            ->assertStatus(401)
            ->assertJsonPath('error.code', 'unauthenticated');
    }

    public function test_logout_reports_token_invalidation_failure(): void
    {
        JWTAuth::shouldReceive('getToken')->once()->andReturn('token-that-cannot-be-invalidated');
        JWTAuth::shouldReceive('invalidate')->once()->andThrow(new RuntimeException('cache unavailable'));

        $response = (new \App\Http\Controllers\App\V1\AuthController())->logout();

        $this->assertSame(503, $response->getStatusCode());
        $this->assertSame('logout_failed', $response->getData(true)['error']['code']);
    }

    public function test_logout_response_survives_a_logging_failure(): void
    {
        JWTAuth::shouldReceive('getToken')->once()->andReturn('token-that-cannot-be-invalidated');
        JWTAuth::shouldReceive('invalidate')->once()->andThrow(new RuntimeException('cache unavailable'));
        Log::shouldReceive('warning')->once()->andThrow(new RuntimeException('logger unavailable'));

        $response = (new \App\Http\Controllers\App\V1\AuthController())->logout();

        $this->assertSame(503, $response->getStatusCode());
        $this->assertSame('logout_failed', $response->getData(true)['error']['code']);
    }

    public function test_login_has_a_versioned_rate_limit(): void
    {
        RateLimiter::clear(hash('sha256', '127.0.0.1|limited@example.test'));
        for ($attempt = 0; $attempt < 10; $attempt++) {
            $this->postJson('/api/app/v1/auth/password/login', [
                'identifier' => 'Limited@Example.Test',
                'password' => 'wrong-password',
            ])->assertStatus(401);
        }

        $this->postJson('/api/app/v1/auth/password/login', [
            'identifier' => 'limited@example.test',
            'password' => 'wrong-password',
        ])->assertStatus(429)
            ->assertJsonPath('error.code', 'rate_limited')
            ->assertJsonStructure(['meta' => ['request_id']]);
    }

    public function test_registration_has_a_versioned_rate_limit(): void
    {
        RateLimiter::clear('ip:127.0.0.1');
        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/app/v1/auth/password/register', [
                'email' => "invalid-{$attempt}",
                'password' => 'password',
                'nickname' => 'Rate Test',
            ])->assertStatus(422);
        }

        $this->postJson('/api/app/v1/auth/password/register', [
            'email' => 'still-invalid',
            'password' => 'password',
            'nickname' => 'Rate Test',
        ])->assertStatus(429)
            ->assertJsonPath('error.code', 'rate_limited')
            ->assertJsonStructure(['meta' => ['request_id']]);
    }

    private function user(string $prefix, string $nickname): User
    {
        $suffix = bin2hex(random_bytes(4));
        return User::create([
            'username' => "{$prefix}_{$suffix}",
            'email' => "{$prefix}_{$suffix}@example.test",
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'nickname' => $nickname,
            'role' => 'user',
            'status' => 'active',
        ]);
    }

    private function token(User $user): string
    {
        return JWTAuth::fromUser($user);
    }

    private function wallet(User $user, string $type, float $amount): void
    {
        UserBalance::create([
            'user_id' => $user->id,
            'balance_type' => $type,
            'amount' => $amount,
        ]);
    }

    private function planQuota(User $user, string $type, float $granted, float $consumed): void
    {
        $plan = Plan::create([
            'code' => 'profile-test',
            'name' => 'Profile test plan',
            'status' => 'active',
        ]);
        $userPlan = UserPlan::create([
            'user_id' => $user->id,
            'plan_id' => $plan->id,
            'source' => 'admin',
            'status' => 'active',
        ]);
        UserPlanQuota::create([
            'user_id' => $user->id,
            'user_plan_id' => $userPlan->id,
            'plan_id' => $plan->id,
            'balance_type' => $type,
            'granted' => $granted,
            'consumed' => $consumed,
            'expires_at' => now()->addDay(),
            'status' => 'active',
        ]);
    }
}
