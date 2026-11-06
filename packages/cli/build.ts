import { buildPackages } from './src/build-packages';
import { bundleCli } from './src/bundle-cli';

buildPackages();
await bundleCli();
