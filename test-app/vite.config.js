import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VeskVitePlugin } from '../packages/compiler/src/vite-plugin.js';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');

export default defineConfig({
	root: '.',
	plugins: [tailwindcss(), VeskVitePlugin()],
	server: {
		port: 3000,
		host: true,
	},
	build: {
		outDir: '.vesk/static',
	},
	appType: 'spa',
	resolve: {
		alias: {
			'@': resolve(__dirname, 'app'),
		},
	},
});