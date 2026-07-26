import { defineConfig } from '@vesk/compiler'
import tailwindcss from '@vesk/plugin-tailwind'

export default defineConfig({
	appDir: './app',
	outDir: './dist',
	publicDir: './public',
	plugins: [
		tailwindcss({ entry: 'src/global.css' }),
	],
	ssg: {},
});
