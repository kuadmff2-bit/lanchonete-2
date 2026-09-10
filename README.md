# Lanchonete 2

Cardápio digital, painel administrativo, APK Android e WhatsApp transacional.

## Cardápio

- produtos, bebidas, promoções e carrinho;
- entrega ou retirada e formas de pagamento;
- pedido registrado no painel;
- pedido completo enviado automaticamente ao WhatsApp da lanchonete;
- confirmação enviada automaticamente ao cliente;
- modos claro e escuro com a paleta azul e amarela;
- prévia do administrador sem registrar, contar ou enviar pedidos.

## Painel e APK

A área administrativa fica em `/admin.html`. O dono acompanha pedidos e valores, altera status, gerencia produtos, fotos, promoções, número comercial, nome, textos, logo, capa e imagem de fundo.

O APK da Lanchonete 2 abre diretamente, sem pedir a senha do painel web. Ele usa uma chave exclusiva inserida durante o build, recebe notificações de novos pedidos e utiliza a mesma marca de hambúrguer azul e amarela no ícone e na tela de carregamento.

O painel aberto no navegador continua protegido pela senha administrativa.

## WhatsApp

A integração não atende nem responde mensagens recebidas. Ela apenas envia automaticamente:

- o pedido completo para a lanchonete;
- a confirmação de recebimento para o cliente;
- pedido confirmado;
- saiu para entrega ou pronto para retirada;
- pedido cancelado.

Veja `ROBOT_SETUP.md` para a configuração do serviço 24 horas e do QR Code.

O deploy do Worker é executado pelo workflow `Deploy Lanchonetes 2 e 3` do repositório principal.
