import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    cloudflare({
      configPath: "e2e/wrangler.jsonc",
      persistState: false,
      remoteBindings: false,
      inspectorPort: false
    }),
    tailwindcss()
  ]
});
