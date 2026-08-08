// Custom Vite config wrapper
// includes: TanStack devtools, tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro, etc.
// @ts-ignore
import { defineConfig } from "./vite-config.js";

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  nitro: {
    preset: "node-server",
  },
});
