# Lanchonete 2

Cardápio digital, painel administrativo, APK Android e robô de atendimento pelo WhatsApp.

## Cardápio

- produtos e bebidas cadastrados pelo administrador;
- disponibilidade individual;
- promoção com pedido direto;
- carrinho, entrega ou retirada e formas de pagamento;
- pedido registrado no painel e enviado ao WhatsApp.

## Painel e APK

A área administrativa fica em `/admin.html`. Nela, o dono acompanha pedidos e valores, altera status, gerencia produtos, fotos e promoções, configura o número comercial e controla o robô.

O APK abre o painel próprio da Lanchonete 2 e possui uma identidade diferente dos demais aplicativos. O workflow `Gerar APK administrativo` compila uma versão instalável no GitHub Actions.

## Robô do WhatsApp

O robô usa o cardápio publicado para mostrar itens, montar o carrinho, coletar os dados do cliente e registrar o pedido. A conexão é feita pelo QR Code exibido dentro do APK administrativo.

Veja `ROBOT_SETUP.md` para configurar o Worker, o serviço 24 horas e o volume persistente da sessão.
