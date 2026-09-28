// 主进程的 tsc 只带 node 类型（不该看见 Bun 全局），但 cards.test.ts 是给
// `bun test` 跑的。这里只声明用到的两个入口，免得为了测试把整个 bun-types
// 拽进主进程的类型环境。
declare module 'bun:test' {
  type Matchers = {
    toBe(v: unknown): void
    toEqual(v: unknown): void
    toHaveLength(n: number): void
    toBeUndefined(): void
    toBeTruthy(): void
    toBeFalsy(): void
  }
  export function expect(v: unknown): Matchers
  export function test(name: string, fn: () => void | Promise<void>): void
}
