# MARI MAIS SABOR

Sistema web para restaurante com cardápio digital, carrinho, painel administrativo, monitor da cozinha, acompanhamento do pedido, relatórios, logo da marca e impressão automática.

## Como rodar

```bash
npm install
npm start
```

Por padrão o sistema abre na porta `3000`.

Se a porta `3000` estiver ocupada, rode em outra porta:

```bash
$env:PORT=3001
npm start
```

## Links locais

- Cardápio do cliente: http://localhost:3000/cardapio
- Painel administrativo: http://localhost:3000/admin
- Painel da cozinha: http://localhost:3000/cozinha

Se estiver usando a porta `3001`, troque `3000` por `3001`.

## Deploy na Vercel

O projeto está preparado para rodar na Vercel com as mesmas rotas:

- `/cardapio`: cardápio do cliente
- `/admin`: painel administrativo
- `/cozinha`: monitor da cozinha

Passos recomendados:

1. Suba o código para o GitHub.
2. Na Vercel, importe o repositório `MARI-MAIS-SABOR`.
3. Crie ou conecte um banco Postgres/Neon no projeto.
4. Configure a variável de ambiente `DATABASE_URL` com a URL do banco.
5. Faça o deploy.

Quando `DATABASE_URL` existe, o sistema cria automaticamente a tabela `app_state` e salva pedidos, produtos e configurações no banco online. Sem `DATABASE_URL`, a Vercel tem apenas armazenamento temporário; por segurança, pedidos e alterações de estoque ficam bloqueados até o banco online ser configurado.

O arquivo local `data/db.json` não deve ser enviado para a Vercel porque pode conter pedidos reais de clientes. Para produção online, o sistema usa `data/default-db.json` como base inicial limpa.

Importante: a impressão direta na POS-80 funciona apenas no computador local da cozinha. Na Vercel, o monitor da cozinha mostra os pedidos, mas não imprime diretamente na impressora local.

## Link para clientes no Wi-Fi

Para abrir no celular do cliente, o celular precisa estar no mesmo Wi-Fi do computador que está rodando o sistema.

Use o IP do computador na rede. Exemplo atual:

- Cardápio no Wi-Fi: http://192.168.0.15:3001/cardapio

Se o IP do Wi-Fi mudar, consulte novamente o IP do computador e substitua no link.

## Fluxo de pedidos

1. O cliente faz o pedido pelo cardápio.
2. Se escolher Pix, o cliente vê o QR Code, a chave Pix e o Pix cópia e cola.
3. O pedido entra no painel da cozinha automaticamente.
4. O sistema não abre WhatsApp ao finalizar pedido.
5. A cozinha usa um monitor somente para visualização dos pedidos abertos.
6. O cliente só vê o andamento do pedido Pix depois que o admin confirmar o pagamento.
7. Depois da confirmação do Pix, o cliente acompanha o pedido com prazo estimado de 35 a 45 minutos e cronômetro.

## Impressão

O nome da impressora fica em `data/db.json`, no campo:

```json
"printerName": "NOME DA IMPRESSORA"
```

Regras atuais:

- Pedido novo: imprime uma única nota automaticamente quando houver impressora configurada.
- A nota única sai com dados da empresa, itens, observação, cliente e endereço.
- Clique em `Saiu para entrega`: apenas atualiza o status do pedido.
- Se a impressão direta falhar, o sistema abre a janela de impressão do navegador como reserva.

### Agente local para pedidos da Vercel

A Vercel não acessa diretamente uma impressora USB. No computador Windows da cozinha:

1. Copie `.env.print-agent.example` para `.env.print-agent`.
2. Preencha `DATABASE_URL` com a mesma conexão do Neon usada na Vercel.
3. Deixe `PRINTER_NAME=AUTO`; o nome preferido e o modo podem ser definidos no painel Admin, na aba `Marca`.
4. Execute `npm run print-agent` ou dê dois cliques em `iniciar-impressora.cmd`.
5. Mantenha a janela do agente aberta durante o atendimento.

Para iniciar o agente automaticamente junto com o Windows, execute uma vez `instalar-inicializacao-impressora.ps1`. Depois disso, o agente fica aguardando: ao conectar a POS-80 ao USB, ele a reconhece e passa a imprimir os pedidos pendentes.

Na primeira inicialização, pedidos antigos não são impressos. A partir desse momento, o agente consulta o Neon, imprime cada pedido novo e registra `printedAt` para evitar duplicações.

## Monitor da cozinha

O link `/cozinha` foi pensado para ficar aberto em um monitor. Ele não tem botões de alteração, não confirma pagamento e não muda status; apenas mostra os pedidos abertos e atualiza automaticamente.

## Logo e dados da empresa

No painel administrativo, abra a aba `Marca` para enviar ou trocar o logo.

Os dados da empresa usados na nota ficam em `data/db.json`:

```json
"address": "Rua Haiti 56 Rochdale-Osasco",
"contact": "11952458505",
"cep": "06220056",
"cnpj": "46.749.934/0001-21"
```

Os dados Pix também ficam em `data/db.json` e podem ser trocados no painel administrativo, aba `Marca`:

```json
"pixName": "Michael Lucas Ramos",
"pixKey": "34731163862"
```

## Acompanhamento do cliente

O cliente vê os status do pedido:

- Pedido recebido
- Em preparo
- A caminho
- Entregue

Enquanto o pedido estiver aberto, o cliente também vê o prazo estimado:

- Prazo estimado para entrega: 35 a 45 minutos
- Prazo estimado para retirada: 35 a 45 minutos
- Para Pix, a contagem do prazo começa quando o pagamento for confirmado no painel administrativo.

Quando o pedido fica `A caminho`, aparece uma senha para receber/retirar o pedido. A senha são os 4 últimos números do telefone do cliente.

## Arquivos importantes

- `server.js`: servidor, API, banco JSON e impressão direta.
- `public/app.js`: telas do cardápio, admin, cozinha e acompanhamento.
- `public/styles.css`: visual do sistema e impressão pelo navegador.
- `data/db.json`: produtos, pedidos, dados da empresa e configuração da impressora.
- `public/uploads`: fotos e logo enviados pelo painel.

## Observações

- O banco local fica em `data/db.json`.
- Fotos e logo enviados pelo painel ficam em `public/uploads`.
- Os arquivos enviados para `public/uploads` não são versionados, para evitar subir fotos reais ou sensíveis.
