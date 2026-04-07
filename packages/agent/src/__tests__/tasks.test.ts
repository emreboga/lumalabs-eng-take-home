import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('../github', () => ({
  getApprovedPlan: vi.fn(),
  getIssue: vi.fn(),
  getRepoUrl: vi.fn(() => 'https://github.com/test/repo.git'),
  getGithubToken: vi.fn(() => 'test-token'),
  getAuthenticatedUserInfo: vi.fn(() => Promise.resolve({ login: 'testuser', email: 'test@example.com' })),
  createPullRequest: vi.fn(() => Promise.resolve('https://github.com/test/repo/pull/1')),
  listAssignedIssues: vi.fn(),
  postPlanComment: vi.fn(),
}))

vi.mock('../claude', () => ({
  runClaude: vi.fn(() => Promise.resolve('')),
  IMPLEMENT_TIMEOUT_MS: 900_000,
}))

import * as github from '../github'
import { handleImplement, findTestCommand } from '../tasks'

// ─── handleImplement — planText source ───────────────────────────────────────

describe('handleImplement — planText source', () => {
  beforeEach(() => vi.clearAllMocks())

  test('uses incomingPlanText and does not call getApprovedPlan', async () => {
    // throw at getIssue to halt execution right after the planText check
    vi.mocked(github.getIssue).mockRejectedValue(new Error('halt'))

    await expect(
      handleImplement(1, vi.fn(), vi.fn(), undefined, 'the approved plan')
    ).rejects.toThrow('halt')

    expect(github.getApprovedPlan).not.toHaveBeenCalled()
  })

  test('falls back to getApprovedPlan and reports missing plan', async () => {
    vi.mocked(github.getApprovedPlan).mockResolvedValue(null)
    const sendResult = vi.fn()

    await handleImplement(1, vi.fn(), sendResult)

    expect(github.getApprovedPlan).toHaveBeenCalledWith(1)
    expect(sendResult).toHaveBeenCalledWith(expect.stringContaining('No approved plan found'))
  })
})

// ─── findTestCommand ──────────────────────────────────────────────────────────

describe('findTestCommand', () => {
  let dir: string

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'runafk-test-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  test('detects npm test script', () => {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'jest' } }))
    expect(findTestCommand(dir)).toBe('npm run test')
  })

  test('prefers test:ci over test', () => {
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest', 'test:ci': 'jest --ci' } }),
    )
    expect(findTestCommand(dir)).toBe('npm run test:ci')
  })

  test('returns null when no test runner config found', () => {
    expect(findTestCommand(dir)).toBeNull()
  })
})

// ─── Title sanitization ───────────────────────────────────────────────────────

describe('title sanitization', () => {
  const sanitize = (t: string) => t.replace(/[^\x20-\x7E]/g, '').trim().slice(0, 72)

  test('strips non-ASCII characters', () => {
    expect(sanitize('Fix 🐛 bug')).toBe('Fix  bug')
  })

  test('truncates to 72 characters', () => {
    expect(sanitize('a'.repeat(100))).toBe('a'.repeat(72))
  })

  test('passes clean ASCII through unchanged', () => {
    expect(sanitize('Add user authentication')).toBe('Add user authentication')
  })
})
