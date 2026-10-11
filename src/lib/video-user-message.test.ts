import { test,expect } from 'bun:test'
import { userMessage } from './user-message'

test('new video providers have actionable errors without private diagnostics',()=>{
  for(const [input,expected] of [
    ['PROVIDER_UNAVAILABLE: migu mobile login required for current API key','平台账号'],
    ['PROVIDER_UNAVAILABLE: migu mobile protocol file required','服务配置'],
    ['PROVIDER_UNAVAILABLE: migu requested mobile quality unavailable; inspect qualities','刷新画质'],
    ['PROVIDER_UNAVAILABLE: migu TV protected ClothHat stream not supported','其他可用画质'],
    ['INVALID_PARAM: migu mobile loginId does not belong to current API key','重新获取二维码'],
  ]){
    const result=userMessage(input+'; diagnostic={"token":"PRIVATE_SECRET"}')
    expect(result).toContain(expected!);expect(result).not.toContain('PRIVATE_SECRET');expect(userMessage(result)).toBe(result)
  }
})
