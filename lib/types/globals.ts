declare global {
  namespace NodeJS {
    interface Process {
      /** set by browser bundlers (browserify, webpack process polyfill) */
      browser?: boolean
    }
  }
}

export {}
