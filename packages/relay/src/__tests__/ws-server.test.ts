import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'

vi.mock('../db', () => ({
  registerAgent: vi.fn(),
  resolveAgent: vi.fn(),
  updateTask: vi.fn(),
  getTaskById: vi.fn(),
}))

vi.mock('ws', () => ({
  WebSocketServer: vi.fn(),
  WebSocket: { OPEN: 1 },
}))

import { hashToken, storePendingPlan, getPendingPlan, removePendingPlan } from '../ws-server'

describe('hashToken', () => {
  test('produces a consistent SHA-256 hex string', () => {
    expect(hashToken('my-token')).toBe(hashToken('my-token'))
    expect(hashToken('my-token')).toHaveLength(64)
  })

  test('different tokens produce different hashes', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })
})

describe('storePendingPlan TTL', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('plan is accessible before TTL expires', () => {
    storePendingPlan('task-ttl-1', { slackUserId: 'U1', issueNumber: 1, planText: 'do the thing' })
    expect(getPendingPlan('task-ttl-1')?.planText).toBe('do the thing')
  })

  test('plan is evicted after 1 hour', () => {
    storePendingPlan('task-ttl-2', { slackUserId: 'U1', issueNumber: 2, planText: 'expires' })
    vi.advanceTimersByTime(60 * 60 * 1000 + 1)
    expect(getPendingPlan('task-ttl-2')).toBeUndefined()
  })

  test('manually removed plan is gone immediately', () => {
    storePendingPlan('task-ttl-3', { slackUserId: 'U1', issueNumber: 3, planText: 'removed' })
    removePendingPlan('task-ttl-3')
    expect(getPendingPlan('task-ttl-3')).toBeUndefined()
  })
})
