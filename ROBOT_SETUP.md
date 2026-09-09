# Robô do painel administrativo

A interface do robô fica integrada ao painel administrativo e é carregada pelos arquivos `admin-robot.js` e `admin-robot.css`.

## Recursos no ADM
- visualizar o estado real da conexão do WhatsApp;
- gerar e escanear o QR Code dentro do APK administrativo;
- desconectar a sessão atual e conectar outro número;
- ligar/desligar o robô;
- mensagem de saudação;
- mensagem de fallback;
- menu automático;
- horário de atendimento;
- taxa fixa de entrega, aplicada somente aos pedidos entregues;
- encaminhamento para atendente;
- teste rápido das respostas;
- número central do WhatsApp da lanchonete.

## Número central do WhatsApp
O número comercial é salvo no KV `PROMOTIONS`, na chave `business-contact`, e é exposto pelo endpoint `/api/business-contact`.

Ao alterar o número na área **Robô > WhatsApp da lanchonete**:
- o botão de WhatsApp do cardápio passa a usar o novo número;
- o número mostrado no site é atualizado;
- a finalização de pedidos consulta o número atual antes de abrir o WhatsApp;
- serviços externos do robô podem consultar o mesmo endpoint e usar a mesma configuração.

Ao trocar a conta conectada, use **Robô > Conectar outro WhatsApp**. O serviço encerra a sessão anterior, apaga somente os dados daquela sessão e gera um novo QR Code dentro do próprio APK.

## Sincronização
As configurações são salvas no backend pelo endpoint `/api/robot` e armazenadas no KV `PROMOTIONS`, na chave `robot-settings`. O navegador/WebView mantém uma cópia local apenas como fallback.

O endpoint `POST /api/robot` exige a autenticação normal do administrador. O `GET /api/robot` expõe somente as regras de atendimento.

## Motor de conversa e pedidos
O endpoint `POST /api/robot/chat` mantém uma sessão separada para cada cliente e usa os produtos reais cadastrados no cardápio.

Fluxo principal:
1. Cliente pede o cardápio.
2. Robô envia o link do cardápio digital e todos os produtos disponíveis numerados, com preço.
3. Cliente envia o número do produto.
4. Robô pergunta quantas unidades.
5. Na etapa de quantidade, somente números inteiros de 1 a 30 são aceitos.
6. O item e a quantidade são acumulados no carrinho do cliente.
7. O cliente pode escolher outros produtos ou enviar `finalizar`.
8. Ao finalizar, o robô pede nome, entrega/retirada, endereço quando necessário e forma de pagamento.
9. Se houver taxa de entrega configurada, ela é informada ao cliente e somada ao total no servidor.
10. O pedido é criado pelo mesmo endpoint `/api/orders` usado pelo cardápio e aparece normalmente no painel administrativo.

Comandos úteis durante o atendimento:
- `cardápio` — mostra o link e a lista numerada atualizada;
- `carrinho` — mostra os itens acumulados e o total;
- `finalizar` — inicia o fechamento do pedido;
- `cancelar` — limpa o atendimento e o carrinho;
- `atendente` — solicita atendimento humano, quando habilitado.

As sessões expiram automaticamente depois de algumas horas sem atividade para evitar carrinhos abandonados permanentes.

## Integração com WhatsApp
Um serviço de WhatsApp deve encaminhar cada mensagem recebida para `POST /api/robot/chat` usando um `contactId` estável e, de preferência, o telefone do cliente. A resposta JSON contém o texto em `reply`, além do estado da conversa, carrinho e indicadores como `handoff` ou `completed`.

Exemplo de entrada:

```json
{
  "contactId": "5592999999999",
  "phone": "5592999999999",
  "message": "cardápio"
}
```

Quando a variável secreta `ROBOT_WEBHOOK_TOKEN` estiver configurada no Cloudflare, o serviço externo também deve enviar o mesmo valor no cabeçalho `x-robot-token`.

## Serviço 24 horas e QR no APK

Implante a pasta `whatsapp-robot` como um serviço Node/Docker separado. No Railway, monte um volume persistente em `/app/tokens` para a conexão continuar válida após reinicializações.

Variáveis do serviço do WhatsApp:

- `ROBOT_API_BASE`: endereço público do Worker desta lanchonete;
- `ROBOT_WEBHOOK_TOKEN`: segredo forte e exclusivo usado para mensagens, estado do QR e comandos;
- `WPP_SESSION`: nome exclusivo da sessão desta lanchonete;
- `WPP_TOKEN_PATH`: `/app/tokens` quando o volume persistente estiver montado.

Variáveis do Worker/Cloudflare:

- `ROBOT_WEBHOOK_TOKEN`: o mesmo segredo do serviço, configurado como secret; ou
- `ROBOT_WEBHOOK_TOKEN_SHA256`: o SHA-256 do segredo, que pode ficar nas variáveis do Worker sem revelar o valor original;
- `ADMIN_PASSWORD` ou `ADMIN_PASSWORD_SHA256`: autenticação do painel.

O serviço envia o estado e o QR ao Worker e consulta periodicamente os comandos de reinício. O navegador e o APK nunca recebem `ROBOT_WEBHOOK_TOKEN`: eles leem o QR somente depois da autenticação administrativa. Cada lanchonete deve usar uma sessão, um volume e um segredo próprios para não misturar contas ou pedidos.
