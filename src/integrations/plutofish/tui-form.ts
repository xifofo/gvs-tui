/** 终端连接页的编辑状态；公开快照只包含密钥长度，Tab 顺序固定为四个字段。 */
export class ConnectionForm {
  field = 0
  url: string
  key = ''
  gatewayKey = ''

  constructor(url: string) { this.url = url }
  tab(back = false): void { this.field = (this.field + (back ? 3 : 1)) % 4 }
  secret(operation: string, value: string): void {
    if (this.field !== 1 && this.field !== 3) return
    const property = this.field === 1 ? 'gatewayKey' : 'key'
    if (operation === 'connectionSecretClear') this[property] = ''
    else if (operation === 'connectionSecretBackspace') this[property] = this[property].slice(0, -1)
    else this[property] = (this[property] + value.replace(/[\x00-\x1f\x7f]/g, '')).slice(0, 4096)
  }
  view() { return { field: this.field, url: this.url, keyLength: this.key.length, gatewayKeyLength: this.gatewayKey.length } }
  clearSecrets(): void { this.key = ''; this.gatewayKey = '' }
}
