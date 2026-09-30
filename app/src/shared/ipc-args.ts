/** Strip Vue proxies without turning an omitted top-level argument into null. */
export function ipcArgs<T extends unknown[]>(args: T): T {
  return args.map(value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))) as T
}
