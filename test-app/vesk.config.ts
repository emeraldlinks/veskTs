import { defineConfig, definePlugin, preset } from '@vesk/compiler'
import tailwindcss from '@vesk/plugin-tailwind'

const testPlugin = definePlugin({
  name: 'test-services',
  provides: {
    serviceName: () => 'provided-by-plugin',
  },
  onRequest: async (ctx) => {
    ctx.set('pluginValue', 'injected-by-onRequest');
  },
});

export default defineConfig({
  appDir: './app',
  outDir: './dist',
  publicDir: './public',
  md: {
    html: 'allowlist',
    allowTags: ['a', 'em', 'br'],
  },
  security: preset('production', {
    trustProxy: true,
    cors: { origin: ['http://localhost:3002'] },
  }),
  plugins: [
    tailwindcss({ entry: 'src/global.css', appDir: 'app' }),
    testPlugin,
  ],
  ssg: {},
})
