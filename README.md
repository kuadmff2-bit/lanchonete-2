# Lanchonete 2

Cardápio digital e painel administrativo em um único projeto Cloudflare.

## O que funciona sem API externa

- cardápio com produtos, bebidas, fotos e disponibilidade;
- carrinho, entrega ou retirada e formas de pagamento;
- promoções com pedido direto;
- pedidos salvos e exibidos no painel administrativo;
- totais e histórico de pedidos;
- alteração de status dos pedidos;
- personalização de nome, textos, logo, capa e fundo;
- modos claro e escuro;
- WhatsApp apenas como link de contato.

O funcionamento principal usa somente **Cloudflare Workers + Durable Objects com armazenamento SQLite**. Não é necessário criar Firebase, Railway, Supabase, banco externo, API de WhatsApp ou chave de API para o cardápio funcionar.

## Arquitetura simples

- `worker-simple.js`: única entrada do Worker;
- `worker.js`: produtos, promoções, pedidos, autenticação e aparência;
- `storage.js` + `durable-storage.js`: armazenamento interno da própria Cloudflare;
- `index.html`: cardápio público;
- `admin.html`: painel administrativo.

Os arquivos antigos de robô, push e APK podem continuar no repositório como legado, mas **não participam do deploy atual do site**.

## Publicação

O projeto já possui `wrangler.jsonc` pronto. Ao conectar este repositório ao Cloudflare Workers, use:

```bash
npm run deploy
```

ou diretamente:

```bash
npx wrangler deploy
```

Não é preciso configurar variáveis de Firebase, Railway, Supabase, WhatsApp ou qualquer API externa.

## Painel

A área administrativa fica em `/admin.html`. O painel do navegador continua protegido pela senha administrativa já configurada no projeto.
