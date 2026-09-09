import worker from "./worker-fcm.js";

export default {
  async fetch(request, env, ctx) {
    return worker.fetch(request, env, ctx);
  }
};
