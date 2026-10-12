// electron-vite: `import p from './x.png?asset'` 得到打包后的绝对路径
declare module '*?asset' {
  const path: string
  export default path
}
