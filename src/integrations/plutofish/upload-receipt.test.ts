/** 成功回调只提取已有文件定位，空值和不安全数字不得伪造文件身份。 */
import { expect, test } from 'bun:test'
import { uploadCompletion } from './upload-receipt.ts'

test('成功回调兼容顶层和嵌套定位，保留大整数 ID 精度', () => {
  expect(uploadCompletion('task', { state: true, data: { file_id: '9007199254740993', pick_code: 'file' } }))
    .toEqual({ pickCode: 'task', fileId: '9007199254740993', filePickCode: 'file' })
  expect(uploadCompletion('task', { state: true, file_id: 123, pickcode: 'file' }))
    .toEqual({ pickCode: 'task', fileId: '123', filePickCode: 'file' })
})

test('缺失或无效文件定位留空，不使用原上传任务码冒充文件取件码', () => {
  for (const data of [undefined, {}, { file_id: 0 }, { file_id: Number.MAX_SAFE_INTEGER + 1 }, { file_id: 'invalid', pick_code: 'https://invalid' }]) {
    expect(uploadCompletion('task', { state: true, data })).toEqual({ pickCode: 'task' })
  }
})
