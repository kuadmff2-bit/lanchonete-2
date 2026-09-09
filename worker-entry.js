import worker from "./worker-fcm.js";

const ADMIN_APP_MARKER = "LanchoneteAdminApp/";

function isAdminAppRequest(request) {
  return (request.headers.get("user-agent") || "").includes(ADMIN_APP_MARKER);
}

function withAdminAppAuth(request, env) {
  if (!isAdminAppRequest(request) || !env.ADMIN_PASSWORD) return request;

  const headers = new Headers(request.headers);
  headers.set("x-admin-password", env.ADMIN_PASSWORD);

  return new Request(request, { headers });
}

export default {
  async fetch(request, env, ctx) {
    return worker.fetch(withAdminAppAuth(request, env), env, ctx);
  }
};
