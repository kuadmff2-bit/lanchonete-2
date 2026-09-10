# WhatsApp automático da Lanchonete 2

Esta integração é exclusivamente transacional. Ela não cria menus, não interpreta mensagens recebidas e não atende clientes.

## Fluxo

1. O cliente finaliza um pedido no cardápio.
2. O Worker registra o pedido e chama o serviço 24 horas.
3. O serviço envia o pedido completo ao número configurado da lanchonete.
4. O serviço envia a confirmação ao WhatsApp do cliente.
5. Ao tocar em **Confirmado**, **Saiu para entrega** ou **Cancelado** no APK, a atualização é enviada automaticamente ao cliente.

Pedidos abertos por `/?preview=admin` são apenas simulações: não são gravados, contabilizados ou enviados.

## Painel

Na aba **WhatsApp**, o administrador pode ver a conexão, escanear o QR Code, conectar outra conta, alterar o número que recebe pedidos e conferir as mensagens automáticas.

## Serviço 24 horas

Implante a pasta `whatsapp-robot` como serviço Node/Docker e mantenha um volume persistente em `/app/tokens`.

Variáveis da instância:

- `ROBOT_API_BASE=https://lanchonete-2.kuadmff2.workers.dev`;
- `ROBOT_WEBHOOK_TOKEN`: segredo da sincronização do QR;
- `ROBOT_CONTROL_TOKEN`: segredo das chamadas servidor-servidor;
- `WPP_SESSION=lanchonete-2-whatsapp`;
- `WPP_TOKEN_PATH=/app/tokens`.

Variáveis do Worker:

- `ROBOT_SERVICE_URL`: URL HTTPS terminando em `/instances/lanchonete-2-whatsapp`;
- `ROBOT_CONTROL_TOKEN`, `ADMIN_PASSWORD` ou `ADMIN_APP_TOKEN`: deve coincidir com o controle da instância;
- `ROBOT_WEBHOOK_TOKEN` ou `ROBOT_WEBHOOK_TOKEN_SHA256`: autentica a sincronização.

## Endpoints protegidos

- `GET /control/status`;
- `POST /control/reset`;
- `POST /control/send-order`;
- `POST /control/send-status`.

Os endpoints exigem `Authorization: Bearer <ROBOT_CONTROL_TOKEN>`. O navegador nunca recebe esse segredo.
