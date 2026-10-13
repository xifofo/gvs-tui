// electron-vite: import createWorker from './x?nodeWorker'
declare module '*?nodeWorker' {
  import { Worker, type WorkerOptions } from 'node:worker_threads'
  export default function createWorker(options: WorkerOptions): Worker
}
