<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8" />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	<link rel="stylesheet" href="/_vesk/static/_tailwind.css" />
	<link rel="stylesheet" href="/_vesk/static/global.css" />
	<title> VeskTS test app </title></head>
<body>
<div id="root">
<style>
  .nav { margin-left: 20px; display: flex; gap: 10px; } </style>
<!--vsk-->
<nav class="flex nav gap-6 px-8 py-4 border-b border-gray-200 bg-white">
	<!--vsk-->
	<div>
		<a href="/" class="text-gray-500 hover:text-black font-medium no-underline">
			Home
		</a>
	</div>
	<!--vsk-->
	<div>
		<a href="/about" class="text-gray-500 hover:text-black font-medium no-underline">
			About
		</a>
	</div>
	<!--vsk-->
	<div>
		<a href="/blog" class="text-gray-500 hover:text-black font-medium no-underline">
			Blog
		</a>
	</div>
</nav>
<!--vsk-->
<main class="max-w-3xl mx-auto my-8 px-4">
	<h1 class="text-4xl font-bold mb-2">
		Welcome to Vesk
	</h1>
	<p class="text-gray-500 mb-4">
		A compiler-first reactive UI framework for the post-VDOM web.
	</p>
	<!--vsk-->
	<p>
		10
	</p>
	<p>
		Hurray 3 xwon
	</p>
	<!--vsk-->
	<button>
		+
	</button>
	<!--vsk-->
	<div class="bg-white gg rounded-xl p-6 shadow-sm border border-gray-100">
		<h2 class="text-xl  font-semibold mb-2">
			Getting Started
		</h2>
		<p>
			Edit
			<code class="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono">
				app/page.vsk
			</code>
			to change this page.
		</p>
		<style>
.gg { color: red; } 		</style>
		<!--vsk-->
		<div>
			<!--vsk-->
			<p class="error">
				Error: Boom!
			</p>
		</div>
		<!--vsk-->
		<div>
			<!--vsk-->
			<p>
				Count: 10
			</p>
			<!--vsk-->
			<p class="error">
				Error: Insufficient! 10
			</p>
		</div>
	</div>
</main>
<footer class="text-center py-8 text-gray-400 text-sm">
	<p>
		Powered by Vesk
	</p>
</footer>
</div>
	<script type="module" src="/_vesk/static/client.js"></script>
</body>
</html>