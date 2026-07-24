import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VeskPlugin } from '@vesk/compiler';

export default defineConfig({
	plugins: [tailwindcss(), VeskPlugin()],
});

