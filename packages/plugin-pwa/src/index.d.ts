export interface PwaIcon { src: string; sizes: string; type: string; purpose?: string; }
export interface PwaOptions {
  name?: string;
  shortName?: string;
  description?: string;
  scope?: string;
  lang?: string;
  display?: 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser';
  orientation?: 'any' | 'natural' | 'landscape' | 'landscape-primary' | 'landscape-secondary' | 'portrait' | 'portrait-primary' | 'portrait-secondary';
  themeColor?: string;
  backgroundColor?: string;
  icons?: PwaIcon[];
  publicDir?: string;
  noServiceWorker?: boolean;
  swStrategy?: 'stale-while-revalidate' | 'cache-first' | 'network-first';
}
export function pwaPlugin(opts?: PwaOptions): import('@vesk/types').VeskPlugin;
export default pwaPlugin;