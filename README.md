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
