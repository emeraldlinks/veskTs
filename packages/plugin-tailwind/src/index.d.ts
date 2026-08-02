/** @vesk/plugin-tailwind — Tailwind CSS plugin types */

export interface TailwindOptions {
  entry?: string;
  appDir?: string;
}

declare function tailwindcss(options?: TailwindOptions): {
  name: string;
  dependencies: string[];
  onBuildStart: () => Promise<void>;
  onCSS: (content: string, filePath: string) => Promise<string | null>;
  onFileWatch: (filePath: string) => Promise<{ handled: boolean }>;
};

export default tailwindcss;
