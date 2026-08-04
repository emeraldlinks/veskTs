# scratch-app

Created with [create-vesk](https://www.npmjs.com/package/create-vesk) — a new [Vesk](https://vesk.dev) project.

## Getting started

```bash
npm install
npm run dev
```

- `npm run dev` — dev server with HMR at http://localhost:3000
- `npm run build` — production build (SSG + SSR) into `.vesk/`
- `npm run start` — run the production server
- `npm run typecheck` — typecheck `app/` and `src/`

## Project structure

```
app/
  layout.vsk           # root layout (nav + {props.children})
  page.vsk             # / — tracked counter
  about/page.vsk       # /about
  blog/page.vsk        # /blog
  blog/[slug]/page.vsk # /blog/:slug (dynamic)
  posts/page.vsk       # /posts — useFetch + tracked cell
  statements/page.vsk  # /statements — every JS construct
  not-found.vsk        # custom 404
  error.vsk            # custom error page
  middleware.ts        # request middleware (onion model)
  api/posts/route.ts   # /api/posts
  api/hello/route.ts   # /api/hello
src/global.css        # tailwind entry
public/               # static assets
vesk.config.ts        # framework config
```
