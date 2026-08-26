import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));
const routeFile = readFileSync(join(repoRoot, "agent-admin/backend/routes/app.php"), "utf8");
const controllerFiles = [
  "BootstrapController.php",
  "AuthController.php",
  "ModelController.php",
  "BillingController.php",
];
const requiredRoutes = [
  "Route::get('/bootstrap'",
  "Route::post('/password/login'",
  "Route::post('/password/register'",
  "Route::post('/refresh'",
  "Route::get('/me'",
  "Route::post('/logout'",
  "Route::get('/models'",
  "Route::get('/billing/plans'",
  "Route::get('/billing/balance'",
  "Route::get('/', [ConversationController::class, 'index'])",
  "Route::post('/{id}/messages', [ConversationController::class, 'sendMessage'])",
  "Route::post('/image-tasks'",
  "Route::put('/{id}/content'",
  "Route::post('/{id}/complete'",
  "Route::get('/tasks'",
  "Route::post('/tasks/{id}/cancel'",
];

const failures = requiredRoutes.filter((route) => !routeFile.includes(route));
if (
  !routeFile.includes("Route::post('/assets/presign'") &&
  !routeFile.includes("Route::post('/presign'")
) {
  failures.push("POST /assets/presign route");
}
if (!routeFile.includes("Route::middleware('app.request')")) {
  failures.push("app.request middleware group");
}
for (const file of controllerFiles) {
  try {
    readFileSync(join(repoRoot, "agent-admin/backend/app/Http/Controllers/App/V1", file));
  } catch {
    failures.push(`missing controller ${file}`);
  }
}

if (failures.length) {
  console.error("App v1 contract check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("App v1 contract check passed");
