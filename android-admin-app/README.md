# Lanchonete 2 Admin APK

Aplicativo Android que abre diretamente o painel administrativo da lanchonete:

`https://lanchonete-2.kuadmff2.workers.dev/admin`

## Recursos
- sem barra de endereço do navegador;
- entrada automática, sem campo de senha no APK;
- pedidos, produtos, promoções, WhatsApp e aparência;
- upload/troca de imagens pelo seletor do Android;
- notificações nativas de novos pedidos;
- links externos abrem no aplicativo correspondente;
- botão voltar do Android navega no painel;
- visual azul e amarelo e o mesmo hambúrguer no ícone e na tela de carregamento.

O APK é salvo em `apk/Lanchonete-2-Admin.apk`. Para reconstruí-lo, passe a chave exclusiva
como propriedade Gradle `adminAppToken`; no GitHub Actions ela vem do secret
`ADMIN_APP_TOKEN` e também é cadastrada como segredo separado no Worker.
