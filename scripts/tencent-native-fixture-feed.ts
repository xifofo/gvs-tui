#!/usr/bin/env bun
/** Phone-free: append fresh native-event JSONL from local templates (no adb/Frida). */
import { feedTencentNativeFixtures, listFixtureTemplateKinds, type FixtureKind } from '../src/lib/tencent-native-fixture-feed.ts'

function arg(name: string, fallback = ''): string {
  const i = process.argv.indexOf(name)
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback
}

const gateway = arg('--gateway', process.env.GVS_HOST || 'http://127.0.0.1:8080')
const account = arg('--account', 'default')
const deviceGuid = arg('--device-guid', process.env.GVS_TENCENT_TV_DEVICE || '')
const outPath = arg('--out', '')
const kindsArg = arg('--kinds', 'watch,qimei,getfeature')
const delivery = arg('--delivery', 'pending') === 'mirror' ? 'mirror' as const : 'pending' as const
if (!deviceGuid) {
  console.error('usage: bun scripts/tencent-native-fixture-feed.ts --device-guid <TV_DEVICE_ID> [--gateway http://127.0.0.1:8080] [--out path] [--kinds watch,qimei,getfeature]')
  console.error('available templates:', listFixtureTemplateKinds().join(',') || '(none)')
  process.exit(1)
}
const kinds = kindsArg.split(',').map(s => s.trim()).filter(Boolean) as FixtureKind[]
const result = feedTencentNativeFixtures({ gateway, account, deviceGuid, outPath: outPath || undefined, kinds, delivery })
console.log(JSON.stringify({ ok: true, phone_required: false, ...result }, null, 2))
