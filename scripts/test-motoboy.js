const assert = require("assert/strict");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const runtimeFile = path.join(os.tmpdir(), `mari-motoboy-test-${process.pid}.json`);
fs.copyFileSync(path.join(__dirname, "..", "data", "default-db.json"), runtimeFile);
process.env.RUNTIME_DATA_FILE = runtimeFile;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.POSTGRES_PRISMA_URL;
delete process.env.POSTGRES_URL_NON_POOLING;
delete process.env.MOTOBOY_PHONE;
delete process.env.MOTOBOY_PASSWORD;

const handleRequest = require("../server");
const server = http.createServer((req, res) => handleRequest(req, res));

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch {}
  return { status: response.status, body };
}

async function run() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const page = await request(baseUrl, "/motoboy");
  assert.equal(page.status, 200);
  assert.match(page.body, /Entregas \| Mari Mais Sabor/);

  const unconfigured = await request(baseUrl, "/api/motoboy/login", {
    method: "POST",
    body: JSON.stringify({ phone: "11999999999", password: "segredo" })
  });
  assert.equal(unconfigured.status, 503);

  const configured = await request(baseUrl, "/api/delivery-driver", {
    method: "PATCH",
    body: JSON.stringify({ phone: "11999999999", password: "segredo" })
  });
  assert.equal(configured.status, 200);
  assert.equal(configured.body.configured, true);

  const publicState = await request(baseUrl, "/api/state");
  assert.equal(publicState.body.deliveryDriver.passwordHash, undefined);

  const denied = await request(baseUrl, "/api/motoboy/login", {
    method: "POST",
    body: JSON.stringify({ phone: "11999999999", password: "errada" })
  });
  assert.equal(denied.status, 401);

  const login = await request(baseUrl, "/api/motoboy/login", {
    method: "POST",
    body: JSON.stringify({ phone: "(11) 99999-9999", password: "segredo" })
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);
  const auth = { Authorization: `Bearer ${login.body.token}` };

  const db = JSON.parse(fs.readFileSync(runtimeFile, "utf8"));
  db.orders.unshift({
    id: "9999",
    createdAt: new Date().toISOString(),
    status: "em_preparo",
    customer: { name: "Cliente Teste", phone: "(11) 98765-4321" },
    fulfillment: {
      type: "Entrega",
      address: "Rua do Teste",
      number: "10",
      neighborhood: "Centro",
      complement: ""
    },
    payment: { method: "Pix" },
    items: [],
    totals: { subtotal: 0, deliveryFee: 0, total: 0 },
    history: [{ status: "em_preparo", at: new Date().toISOString() }]
  });
  fs.writeFileSync(runtimeFile, JSON.stringify(db, null, 2));

  const dispatched = await request(baseUrl, "/api/orders/9999", {
    method: "PATCH",
    body: JSON.stringify({ status: "saiu_para_entrega" })
  });
  assert.equal(dispatched.status, 200);
  assert.match(dispatched.body.deliveryToken, /^[A-F0-9]{12}$/);

  const list = await request(baseUrl, "/api/motoboy/orders", { headers: auth });
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].customer.name, "Cliente Teste");
  assert.equal(list.body[0].totals, undefined);

  const wrongCode = await request(baseUrl, `/api/motoboy/orders/${dispatched.body.deliveryToken}/confirm-delivery`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ code: "0000" })
  });
  assert.equal(wrongCode.status, 400);

  const delivered = await request(baseUrl, `/api/motoboy/orders/${dispatched.body.deliveryToken}/confirm-delivery`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ code: "4321" })
  });
  assert.equal(delivered.status, 200);
  assert.equal(delivered.body.status, "entregue");
  assert.ok(delivered.body.deliveredAt);

  const emptyList = await request(baseUrl, "/api/motoboy/orders", { headers: auth });
  assert.equal(emptyList.body.length, 0);

  console.log("Fluxo do motoboy validado com sucesso.");
}

run()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
    fs.rmSync(runtimeFile, { force: true });
  });
