# Prettier Plugin

`@vesk/prettier-plugin` provides formatting support for `.vsk` files
in Prettier.

## Setup

Install the plugin:

```bash
npm install -D @vesk/prettier-plugin
```

Add to your `.prettierrc`:

```json
{
  "plugins": ["@vesk/prettier-plugin"]
}
```

## How it works

1. The plugin registers `.vsk` as a handled file extension.
2. It transforms `.vsk` syntax to TypeScript/JSX for Prettier's parser.
3. After formatting, it maps the result back to `.vsk` syntax.
4. Vesk-specific syntax (`component`, `&[]`, `{#client}`/`{#server}`)
   is preserved through the format pass.

## Integration with editor

Most editors auto-detect Prettier plugins from the config file. Once
installed and configured, `.vsk` files format on save automatically.

## Verified against

- `packages/prettier-plugin/` — formatter implementation
