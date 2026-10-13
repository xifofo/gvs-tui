import { parentPort, workerData } from 'node:worker_threads'
import { ed2kFile } from './ed2k'

const { path } = workerData as { path: string }
ed2kFile(path, (done, total) => parentPort?.postMessage({ type: 'progress', done, total }))
  .then((r) => parentPort?.postMessage({ type: 'done', ...r }))
  .catch((e) => parentPort?.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) }))
