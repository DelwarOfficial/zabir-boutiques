globalThis.process ??= {};
globalThis.process.env ??= {};
import { env } from "cloudflare:workers";
function getEnv(context) {
  if (!env) throw new Error("Cloudflare runtime env is unavailable");
  return env;
}
export {
  getEnv as g
};
