import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SwaggerUiAsset {
  file: string;
  contentType: string;
  content: string;
}

const ASSET_FILES: SwaggerUiAsset[] = [
  { file: 'swagger-ui.css', contentType: 'text/css; charset=utf-8', content: '' },
  { file: 'swagger-ui-bundle.js', contentType: 'text/javascript; charset=utf-8', content: '' },
  { file: 'swagger-ui-standalone-preset.js', contentType: 'text/javascript; charset=utf-8', content: '' },
];

function assetDirectories(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    join(here, 'swagger-ui'),
    resolve(here, '..', '..', 'docs', 'dist', 'swagger-ui'),
  ];
}

export function readSwaggerUiAssets(): SwaggerUiAsset[] {
  const directory = assetDirectories().find((candidate) => ASSET_FILES.every((asset) => existsSync(join(candidate, asset.file))));
  if (!directory) throw new Error('Swagger UI assets are missing from @vesk/docs; run npm install and rebuild packages.');
  return ASSET_FILES.map((asset) => ({ ...asset, content: readFileSync(join(directory, asset.file), 'utf8') }));
}
