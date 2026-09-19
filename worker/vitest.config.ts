import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: {
        configPath: "./wrangler.jsonc",
      },
      miniflare: {
        bindings: {
          TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
          TURN_KEY_ID: "test-turn-key-id",
          TURN_KEY_API_TOKEN: "test-turn-api-token",
        },
      },
    }),
  ],
});
