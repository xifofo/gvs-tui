import { expect, test } from 'bun:test'
import { summarizeInput } from './runlog.ts'

test('session bindings are redacted while content identifiers remain useful', () => {
  const text = summarizeInput({ vid: 'episode1', report_binding: 'PRIVATE-CAPABILITY', binding: 'PRIVATE-CAPABILITY' })
  expect(text).toContain('vid=episode1')
  expect(text).toContain('report_binding=***')
  expect(text).not.toContain('PRIVATE-CAPABILITY')
})
