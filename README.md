# MARI MAIS SABOR

Sistema web simples para restaurante, com cardapio digital, carrinho, painel administrativo, painel da cozinha, status do pedido, relatorios e envio do pedido para WhatsApp.

## Como rodar

```bash
npm install
npm start
```

Depois abra:

- Cardapio: http://localhost:3000/cardapio
- Administracao: http://localhost:3000/admin
- Cozinha: http://localhost:3000/cozinha

## Observacoes

- O banco inicial fica em `data/db.json`.
- Fotos enviadas pelo painel ficam em `public/uploads`.
- Os arquivos enviados para `public/uploads` nao sao versionados, para evitar subir fotos reais ou sensiveis.
