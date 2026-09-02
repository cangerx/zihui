import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiClientError, createApiClient } from '../../packages/api-client/src/index.ts'
import { createPoller } from '../src/utils/poller.ts'

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(payload),
  }
}

test('abort discards a fetch response that was already in flight', async () => {
  let resolveFetch
  let ticks = 0
  const poller = createPoller({
    fetch: () => new Promise((resolve) => { resolveFetch = resolve }),
    isDone: () => false,
    onTick: () => { ticks += 1 },
    interval: 0,
  })

  const running = poller.start()
  poller.abort()
  resolveFetch({ status: 'queued' })

  assert.deepEqual(await running, { status: 'aborted', data: null })
  assert.equal(ticks, 0)
})

test('abort converts an in-flight fetch rejection into an aborted result', async () => {
  let rejectFetch
  let observedError
  const poller = createPoller({
    fetch: () => new Promise((_, reject) => { rejectFetch = reject }),
    isDone: () => false,
    onError: (error) => { observedError = error },
  })

  const running = poller.start()
  poller.abort()
  const failure = new Error('request rejected after abort')
  rejectFetch(failure)

  assert.deepEqual(await running, { status: 'aborted', data: null })
  assert.equal(observedError, failure)
})

test('an aborted poll preserves exactly one current-token 401 signal during cancellation', async () => {
  let token = 'token-a'
  let resolvePoll
  let resolveCancel
  let requestCount = 0
  const pollResponse = new Promise((resolve) => { resolvePoll = resolve })
  const cancelResponse = new Promise((resolve) => { resolveCancel = resolve })
  const client = createApiClient({
    baseUrl: 'https://example.test/api/app/v1',
    channel: 'h5',
    getAccessToken: () => token,
    setAccessToken: (next) => { token = next },
    fetchImpl: async () => {
      requestCount += 1
      return requestCount === 1 ? pollResponse : cancelResponse
    },
  })
  let loginSignals = 0
  const observeSessionError = (error) => {
    if (error instanceof ApiClientError && error.accessTokenInvalidated) loginSignals += 1
  }
  const poller = createPoller({
    fetch: () => client.task('task-1'),
    isDone: () => false,
    onError: observeSessionError,
  })

  const runningPoll = poller.start()
  poller.abort()
  const runningCancel = client.cancelTask('task-1').catch((error) => {
    observeSessionError(error)
    return error
  })
  resolvePoll(jsonResponse(401, { error: { code: 'unauthenticated', message: 'expired' } }))
  assert.deepEqual(await runningPoll, { status: 'aborted', data: null })
  resolveCancel(jsonResponse(401, { error: { code: 'unauthenticated', message: 'expired' } }))
  const cancelError = await runningCancel

  assert.equal(token, null)
  assert.equal(cancelError.accessTokenInvalidated, false)
  assert.equal(loginSignals, 1)
})

test('a fetch rejection still surfaces when the poller was not aborted', async () => {
  const failure = new Error('request failed')
  const poller = createPoller({
    fetch: async () => { throw failure },
    isDone: () => false,
  })

  await assert.rejects(poller.start(), (error) => error === failure)
})

test('a terminal response stops polling immediately', async () => {
  const responses = [{ status: 'queued' }, { status: 'succeeded' }]
  let calls = 0
  const poller = createPoller({
    fetch: async () => responses[calls++],
    isDone: (value) => value.status === 'succeeded',
    interval: 0,
    maxInterval: 0,
  })

  const result = await poller.start()
  assert.equal(result.status, 'done')
  assert.deepEqual(result.data, { status: 'succeeded' })
  assert.equal(calls, 2)
})
