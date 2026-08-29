# Welcome

This is **dynamic markdown** loaded from a file on the server by path.

Server-side rendering means the page awaits the fetch of this file and
renders its real contents — not a literal path string.

- Pick a doc from the dropdown above
- Each file lives in `vesk-web/docs/*.md`
- The API route reads the file and returns its markdown
- `<Md>` renders it

## How it works

1. A `track` cell holds the selected `docPath`
2. `useFetch('/api/docs/<path>')` reads the file on the server
3. `<Md content={contents}>` renders the returned markdown
