<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

class AppV1ContractTest extends TestCase
{
    private function repositoryRoot(): string
    {
        return dirname(__DIR__, 2);
    }

    public function test_versioned_routes_cover_the_multichannel_slice(): void
    {
        $routes = file_get_contents($this->repositoryRoot() . '/routes/app.php');
        $this->assertIsString($routes);

        foreach ([
            "Route::get('/bootstrap'",
            "Route::post('/password/login'",
            "Route::post('/password/register'",
            "Route::get('/', [ConversationController::class, 'index'])",
            "Route::post('/{id}/messages', [ConversationController::class, 'sendMessage'])",
            "Route::post('/image-tasks'",
            "Route::get('/tasks'",
            "Route::post('/tasks/{id}/cancel'",
            "Route::delete('/tasks/{id}'",
        ] as $route) {
            $this->assertStringContainsString($route, $routes, $route);
        }
    }

    public function test_conversation_migration_defines_owner_scoped_tables(): void
    {
        $migration = file_get_contents($this->repositoryRoot() . '/database/migrations/2026_08_26_000010_create_app_conversations_tables.php');
        $this->assertIsString($migration);
        $this->assertStringContainsString("Schema::create('app_conversations'", $migration);
        $this->assertStringContainsString("Schema::create('app_messages'", $migration);
        $this->assertStringContainsString("->foreign('user_id')", $migration);
        $this->assertStringContainsString("->foreign('conversation_id')", $migration);
    }
}
