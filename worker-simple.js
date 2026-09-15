import worker from "./worker.js";
export { AppStorage } from "./durable-storage.js";

// Entrada única do projeto.
// Mantém cardápio, produtos, promoções, pedidos e painel administrativo
// usando somente Cloudflare Workers + Durable Objects.
export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  }
};
