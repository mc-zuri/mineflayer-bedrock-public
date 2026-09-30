declare global {
  namespace NodeJS {
    interface Process {
      /** set by browser bundlers (browserify, webpack process polyfill) */
      browser?: boolean
    }
  }
  // node (and browsers) ignore a null handle; @types/node only admits undefined
  function clearTimeout (timeout: NodeJS.Timeout | null | undefined): void
  function clearInterval (interval: NodeJS.Timeout | null | undefined): void
}

export {}
