// The root type check (tsc --noEmit over src/**) reaches app/src/main/shims/
// tool-paths.ts through src/lib/desktop-tool-paths.test.ts. Electron is only
// installed inside app/, so CI's TUI job cannot resolve its types. Declare the
// minimal surface that shim uses; the desktop build keeps the real typings.
declare module 'electron' {
  export const app: {
    readonly isPackaged: boolean
    getAppPath(): string
    getPath(name: string): string
  }
}

declare namespace NodeJS {
  interface Process {
    /** Electron-only: resources directory of the packaged app. */
    resourcesPath: string
  }
}
