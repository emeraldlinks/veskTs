/** @type {import('@vesk/compiler').VeskConfig} */
export default {
	// Root directory for file-based routing (default: ./app)
	appDir: './app',

	// Output directory for compiled assets (default: ./dist)
	outDir: './dist',

	// Public directory served as static files (default: ./public)
	publicDir: './public',

	// Configure SSG routes (static paths for dynamic routes)
	ssg: {
		// Example: pre-render blog posts
		// getStaticPaths: async () => {
		//   return { paths: [{ params: { slug: 'hello-world' } }, { params: { slug: 'ssr-in-vesk' } }] };
		// },
	},
};
