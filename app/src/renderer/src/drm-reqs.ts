import { ref } from 'vue'
import type { DRMStatus } from '@shared/api'
import * as reqs from '@shared/drm-requirements'
import { gvs } from './store'

/** Bumped whenever the gateway table is installed, so templates re-render. */
const version = ref(0)
const source = ref<'gateway' | 'fallback'>('fallback')
let loading: Promise<void> | null = null

/** Use the table from a /v1/drm/devices response; older gateways keep the fallback. */
export function applyDRMStatus(st: DRMStatus | null | undefined): void {
  const list = reqs.fromGateway(st?.requirements)
  if (!list) return
  reqs.useRequirements(list)
  source.value = 'gateway'
  version.value++
}

export function loadDRMRequirements(): Promise<void> {
  loading ??= gvs('drmStatus').then(applyDRMStatus, () => { loading = null })
  return loading
}

export const drmSource = () => (version.value, source.value)
export const l1Badge = (p: string) => (version.value, reqs.l1Badge(p))
export const drmSummary = (p: string) => (version.value, reqs.drmSummary(p))
export const activeRequirements = () => (version.value, reqs.activeRequirements())