import assert from "node:assert/strict";
import test from "node:test";
import { ApiClientError, createApiClient } from "./index.ts";

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  } as unknown as Response;
}

test("builds requests without URL or Headers browser constructors", async () => {
  const descriptors = {
    URL: Object.getOwnPropertyDescriptor(globalThis, "URL"),
    Headers: Object.getOwnPropertyDescriptor(globalThis, "Headers"),
    FormData: Object.getOwnPropertyDescriptor(globalThis, "FormData"),
    Blob: Object.getOwnPropertyDescriptor(globalThis, "Blob"),
  };
  for (const name of Object.keys(descriptors)) {
    Object.defineProperty(globalThis, name, { configurable: true, value: undefined });
  }

  try {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = createApiClient({
      baseUrl: "https://api.example.test/api/app/v1",
      channel: "mini_program",
      getAccessToken: () => "token-a",
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedUrl = String(input);
        capturedInit = init;
        return response(200, { data: [] });
      }) as typeof fetch,
    });

    await client.tasks({ type: "image", status: "queued", limit: 5 });
    assert.equal(
      capturedUrl,
      "https://api.example.test/api/app/v1/tasks?type=image&status=queued&limit=5",
    );
    const headers = capturedInit?.headers as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer token-a");
    assert.equal(headers["X-Channel"], "mini_program");
  } finally {
    for (const [name, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("a stale 401 cannot clear a newer access token", async () => {
  let token: string | null = "token-a";
  let finish!: (value: Response) => void;
  const pendingResponse = new Promise<Response>((resolve) => { finish = resolve; });
  const client = createApiClient({
    baseUrl: "/api/app/v1",
    channel: "h5",
    getAccessToken: () => token,
    setAccessToken: (next) => { token = next; },
    fetchImpl: (async () => pendingResponse) as typeof fetch,
  });

  const request = client.me();
  token = "token-b";
  finish(response(401, { error: { code: "unauthenticated", message: "expired" } }));
  await assert.rejects(request, (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.accessTokenInvalidated, false);
    return true;
  });
  assert.equal(token, "token-b");
});

test("a current-token 401 clears the access token", async () => {
  let token: string | null = "token-a";
  const client = createApiClient({
    baseUrl: "/api/app/v1",
    channel: "h5",
    getAccessToken: () => token,
    setAccessToken: (next) => { token = next; },
    fetchImpl: (async () => response(401, {
      error: { code: "unauthenticated", message: "expired" },
    })) as typeof fetch,
  });

  await assert.rejects(client.me(), (error: unknown) => {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.accessTokenInvalidated, true);
    return true;
  });
  assert.equal(token, null);
});
