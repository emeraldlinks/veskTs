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
		// app/layout.vsk loads Google Fonts: allow the stylesheet host in
		// style-src and the font-file host in font-src, nothing else changes.
		// VersionBadge.vsk also fetches the latest @vesk/compiler release from
		// the npm registry, so that host joins connect-src.
		contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data:; font-src 'self' https://fonts.gstatic.com; frame-src 'self'; connect-src 'self' https://registry.npmjs.org; object-src 'none'; base-uri 'self'; form-action 'self'",
	}),
	plugins: [
		tailwindcss({ entry: 'app/global.css', appDir: 'app' }),
	],
	ssg: {},
});
