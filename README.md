# Lanchonete 2

Cardápio digital, painel administrativo, APK Android e robô de atendimento pelo WhatsApp.

## Cardápio

- produtos e bebidas cadastrados pelo administrador;
- disponibilidade individual;
- promoção com pedido direto;
- carrinho, entrega ou retirada e formas de pagamento;
- pedido registrado no painel e enviado ao WhatsApp.

## Painel e APK

A área administrativa fica em `/admin.html`. Nela, o dono acompanha pedidos e valores, altera status, gerencia produtos, fotos e promoções, configura o número comercial, controla o robô e personaliza nome, textos, logo, capa, fundo e cores.

O APK abre o painel próprio da Lanchonete 2 sem pedir senha e possui uma identidade diferente dos demais aplicativos. Uma chave exclusiva, separada da senha do painel web, é inserida somente durante o build.

## Robô do WhatsApp

O robô usa o cardápio publicado para mostrar itens, montar o carrinho, coletar os dados do cliente e registrar o pedido. A conexão é feita pelo QR Code exibido dentro do APK administrativo.

Veja `ROBOT_SETUP.md` para configurar o Worker, o serviço 24 horas e o volume persistente da sessão.

O deploy do Worker usa o workflow `Deploy Lanchonetes 2 e 3` do repositório principal, que concentra a credencial do Cloudflare sem copiá-la para este repositório.
