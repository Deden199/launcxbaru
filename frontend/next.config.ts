import type { NextConfig } from 'next'
import path from 'path'

// Temporary workaround for Next.js builds failing because `WebpackError` is not
// exported from the bundled webpack runtime. This ensures the class exists so
// the built-in minify plugin can instantiate it without throwing.
const webpackRuntime = require('next/dist/compiled/webpack/webpack.js') as {
  WebpackError?: ErrorConstructor
}

if (typeof webpackRuntime.WebpackError !== 'function') {
  class PatchedWebpackError extends Error {
    constructor(message?: string) {
      super(message)
      this.name = 'WebpackError'
    }
  }

  webpackRuntime.WebpackError = PatchedWebpackError as ErrorConstructor
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(__dirname, '..'),
}

export default nextConfig
