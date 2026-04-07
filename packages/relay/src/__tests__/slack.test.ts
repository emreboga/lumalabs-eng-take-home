import { vi, describe, test, expect } from 'vitest'

vi.mock('@slack/bolt', () => ({
  App: vi.fn(() => ({ client: {}, command: vi.fn(), action: vi.fn() })),
  ExpressReceiver: vi.fn(() => ({ app: {}, router: { get: vi.fn() } })),
  LogLevel: { WARN: 'warn' },
}))

vi.mock('../ws-server', () => ({
  registerToken: vi.fn(),
}))

import { toSlackMrkdwn } from '../slack'

describe('toSlackMrkdwn', () => {
  test('converts **bold** to *bold*', () => {
    expect(toSlackMrkdwn('hello **world**')).toBe('hello *world*')
  })

  test('converts # heading to *heading*', () => {
    expect(toSlackMrkdwn('# Title')).toBe('*Title*')
  })

  test('converts ## and deeper headings', () => {
    expect(toSlackMrkdwn('## Section\n### Sub')).toBe('*Section*\n*Sub*')
  })

  test('removes --- horizontal rules', () => {
    expect(toSlackMrkdwn('above\n---\nbelow')).toBe('above\n\nbelow')
  })

  test('converts [text](url) to <url|text>', () => {
    expect(toSlackMrkdwn('[click here](https://example.com)')).toBe('<https://example.com|click here>')
  })

  test('leaves plain text unchanged', () => {
    expect(toSlackMrkdwn('just plain text')).toBe('just plain text')
  })
})
