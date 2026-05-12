import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    auxiliaryWorkers: [
      { configPath: './workers/spacedust.wrangler.jsonc' },
    ],
  }),
  experimental: {
    rustCompiler: true,
    advancedRouting: true
  }
});
