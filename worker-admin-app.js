import worker from "./worker-fcm.js";

const ADMIN_APP_MARKER = "LanchoneteAdminApp/";

function isAdminAppRequest(request) {
  return (request.headers.get("user-agent") || "").includes(ADMIN_APP_MARKER);
}

function authorizeAdminAppRequest(request, env) {
  if (!isAdminAppRequest(request) || !env.ADMIN_PASSWORD) return request;

  const headers = new Headers(request.headers);
  // A senha permanece somente no Cloudflare. O APK apenas se identifica pelo User-Agent próprio.
  headers.set("x-admin-password", env.ADMIN_PASSWORD);
  return new Request(request, { headers });
}

async function prepareAdminHtmlForApp(request, response) {
  if (!isAdminAppRequest(request) || !response.ok) return response;

  const url = new URL(request.url);
  if (url.pathname !== "/admin" && url.pathname !== "/admin.html") return response;

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("text/html")) return response;

  let html = await response.text();
  const prePaintCss = `
<style id="admin-app-prepaint">
  #loginPanel { display: none !important; }
  #adminApp[hidden] { display: block !important; }
  #logoutButton { display: none !important; }
</style>`;

  if (!html.includes('id="admin-app-prepaint"')) {
    html = html.includes("</head>")
      ? html.replace("</head>", `${prePaintCss}\n</head>`)
      : `${prePaintCss}\n${html}`;
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  headers.delete("etag");
  headers.set("cache-control", "no-store");

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export default {
  async fetch(request, env, ctx) {
    const authorizedRequest = authorizeAdminAppRequest(request, env);
    const response = await worker.fetch(authorizedRequest, env, ctx);
    return prepareAdminHtmlForApp(request, response);
  }
};
