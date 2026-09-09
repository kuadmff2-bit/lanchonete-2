import worker from "./worker-fcm.js";
export { AppStorage } from "./durable-storage.js";

// O APK envia uma chave exclusiva definida somente no momento do build.
// O User-Agent, sozinho, nunca libera o painel.
export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  }
};
