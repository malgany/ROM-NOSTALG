import type { Env as WorkerEnv } from "../src/types";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}

declare module "cloudflare:workers" {
  interface ProvidedEnv extends WorkerEnv {}
}

export {};
