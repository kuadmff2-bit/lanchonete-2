import appWorker from "./worker-admin-app.js";
import { handlePushRelay, notifyNewOrderViaRelay } from "./push-relay.js";
export { AppStorage } from "./durable-storage.js";

function withRobotControlToken(env) {
  if (!env?.ADMIN_PASSWORD) return env;
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === "ROBOT_CONTROL_TOKEN") return target.ADMIN_PASSWORD;
      return Reflect.get(target, property, receiver);
    }
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const runtimeEnv = withRobotControlToken(env);

    if (url.pathname === "/api/push/relay") {
      return handlePushRelay(request, runtimeEnv);
    }

    const response = await appWorker.fetch(request, runtimeEnv, ctx);

    if (url.pathname === "/api/orders" && request.method === "POST" && response.ok) {
      const data = await response.clone().json().catch(() => ({}));
      if (data?.order && !data?.duplicate) {
        const task = notifyNewOrderViaRelay(runtimeEnv, data.order).catch(() => null);
        if (ctx?.waitUntil) ctx.waitUntil(task);
        else await task;
      }
    }

    return response;
  }
};
