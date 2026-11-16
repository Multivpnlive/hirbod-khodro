// @lovable.dev/vite-tanstack-config provides the required Vite plugins.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const appMeta = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  version: string;
  releaseDate: string;
};

export default defineConfig({
  define: {
    __HIRBOD_APP_VERSION__: JSON.stringify(appMeta.version),
    __HIRBOD_RELEASE_DATE__: JSON.stringify(appMeta.releaseDate),
  },
  nitro: {
    preset: "node-server",
  },
  tanstackStart: {
    server: { entry: "server" },
  },
});
