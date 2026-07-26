/** @vesk/adapter — Build and production server types */

export interface BuildOptions {
  outDir?: string;
  publicDir?: string;
  plugins?: Array<{
    name: string;
    onBuildStart?: () => Promise<void> | void;
    onBuildEnd?: () => Promise<void> | void;
    onCSS?: (content: string, filePath: string) => Promise<string | null> | string | null;
  }>;
  seo?: boolean;
  strictSeo?: boolean;
  siteUrl?: string;
}

export function build(appDir: string, options?: BuildOptions): Promise<void>;

export interface ProdServerOptions {
  port?: number;
}

export function startProdServer(outDir: string, options?: ProdServerOptions): void;
