import { defineConfig, preset } from '@vesk/compiler'
import tailwindcss from '@vesk/plugin-tailwind'

export default defineConfig({
	appDir: './app',
	outDir: './dist',
	publicDir: './public',
	// security: 'strict',                // preset string ("strict"|"minimal"|"off")
	// security: preset('production'),     // environment preset
	security: preset('production', {       // preset + overrides
		trustProxy: true,                   // set to true if behind nginx/Cloudflare
		// rateLimit: { windowMs: 60000, max: 100 },
		// cors: { origin: ['https://app.example.com'] },
	}),
	plugins: [
		tailwindcss({ entry: 'src/global.css', appDir: 'app' }),
	],
	ssg: {},
});
