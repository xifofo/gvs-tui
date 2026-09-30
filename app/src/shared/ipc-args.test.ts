import { expect, test } from 'bun:test'
import { reactive } from 'vue'
import { ipcArgs } from './ipc-args'

test('optional diagnostic job arguments survive renderer serialization', () => {
  expect(ipcArgs([])).toEqual([])
  expect(ipcArgs([undefined])).toEqual([undefined])
  expect(ipcArgs([12, undefined, false])).toEqual([12, undefined, false])
  expect(ipcArgs([null])).toEqual([null])
})

test('reactive payloads are plain data before crossing IPC', () => {
  const payload = reactive({ nested: { selected: ['audio-1'] } })
  const [copy] = ipcArgs([payload])
  expect(structuredClone(copy)).toEqual({ nested: { selected: ['audio-1'] } })
  payload.nested.selected.push('audio-2')
  expect(copy.nested.selected).toEqual(['audio-1'])
})
