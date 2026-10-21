import {expect,test} from 'bun:test'
import {tencentProfileStoppedBinding} from './tencent-profile-binding'

const binding={binding:'private-binding',status:'registration_response_unverified',stop:true,adprofile:{registration_delivery:{status:'registration_response_unverified',stop:true}}}
test('only authenticated binding with matching registration outcome receives compatibility handling',()=>{
 expect(tencentProfileStoppedBinding(binding)).toBe(true)
 expect(tencentProfileStoppedBinding({...binding,stop:undefined,status:'bound'})).toBe(true)
 expect(tencentProfileStoppedBinding({...binding,binding:''})).toBe(false)
 expect(tencentProfileStoppedBinding({...binding,status:'risk_rejected'})).toBe(false)
 for(const error of [{em:93},{code:403},{httpStatus:401},{http_status:429},{error:{message:'rejected'}},{raw:{em:94}}]) {
  expect(tencentProfileStoppedBinding({...binding,...error})).toBe(false)
 }
 expect(tencentProfileStoppedBinding({binding:'private-binding',stop:true,status:'rejected'})).toBe(false)
})
