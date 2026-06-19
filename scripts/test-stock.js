const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `mari-stock-test-${Date.now()}`);
const port = 3200 + Math.floor(Math.random() * 500);

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(pathname, options = {}) {
  const body = options.body ? JSON.stringify(options.body) : "";
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      path: pathname,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, res => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        responseBody += chunk;
      });
      res.on("end", () => {
        let data = {};
        try {
          data = JSON.parse(responseBody);
        } catch {
          data = { raw: responseBody };
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          const error = new Error(data.error || `HTTP ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.data = data;
          reject(error);
          return;
        }

        resolve(data);
      });
    });

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer() {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      await request("/api/state");
      return;
    } catch {
      await delay(250);
    }
  }
  throw new Error("Test server did not start.");
}

function orderPayload(product, quantity) {
  return {
    customer: { name: "Cliente Teste Estoque", phone: "11999999999" },
    fulfillment: { type: "Retirada", address: "", number: "", neighborhood: "", complement: "" },
    payment: { method: "Dinheiro na entrega", changeFor: "" },
    note: "Teste automatizado de estoque",
    items: [{ productId: product.id, name: product.name, quantity, price: product.price }],
    totals: {
      subtotal: product.price * quantity,
      deliveryFee: 0,
      total: product.price * quantity
    }
  };
}

function soldForProduct(orders, productId) {
  return orders
    .filter(order => order.status !== "cancelado")
    .flatMap(order => order.items || [])
    .filter(item => item.productId === productId)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function stopServer(child) {
  if (!child || child.killed) return;
  await new Promise(resolve => {
    const timer = setTimeout(resolve, 1500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function removeTempRoot() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      return;
    } catch {
      await delay(250);
    }
  }
}

async function main() {
  fs.mkdirSync(tempRoot, { recursive: true });
  copyFile(path.join(root, "server.js"), path.join(tempRoot, "server.js"));
  copyFile(path.join(root, "print-large.ps1"), path.join(tempRoot, "print-large.ps1"));
  copyFile(path.join(root, "data", "default-db.json"), path.join(tempRoot, "data", "default-db.json"));
  copyFile(path.join(root, "data", "default-db.json"), path.join(tempRoot, "data", "db.json"));
  fs.cpSync(path.join(root, "public"), path.join(tempRoot, "public"), { recursive: true });

  const child = spawn(process.execPath, ["server.js"], {
    cwd: tempRoot,
    env: { ...process.env, PORT: String(port), NODE_PATH: path.join(root, "node_modules") },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    const before = await request("/api/state");
    const product = before.products.find(item => item.name === "Coca-Cola 600 ml");
    assert(product, "Coca-Cola 600 ml was not found.");
    assert(Number(product.dailyStock) === 30, "Expected Coca-Cola daily stock to be 30.");

    await request("/api/orders", {
      method: "POST",
      body: orderPayload(product, 29)
    });

    const after29 = await request("/api/state");
    const productAfter29 = after29.products.find(item => item.id === product.id);
    const soldAfter29 = soldForProduct(after29.orders, product.id);
    assert(soldAfter29 === 29, `Expected 29 sold, got ${soldAfter29}.`);
    assert(Number(productAfter29.remainingToday) === 1, `Expected 1 remaining, got ${productAfter29.remainingToday}.`);

    let blocked = false;
    try {
      await request("/api/orders", {
        method: "POST",
        body: orderPayload(product, 2)
      });
    } catch (error) {
      blocked = true;
      assert(error.message.includes("esgotado"), `Unexpected over-limit message: ${error.message}`);
    }
    assert(blocked, "Expected over-limit order to be blocked.");

    await request("/api/orders", {
      method: "POST",
      body: orderPayload(product, 1)
    });

    const after30 = await request("/api/state");
    const productAfter30 = after30.products.find(item => item.id === product.id);
    const soldAfter30 = soldForProduct(after30.orders, product.id);
    assert(soldAfter30 === 30, `Expected 30 sold, got ${soldAfter30}.`);
    assert(Number(productAfter30.remainingToday) === 0, `Expected 0 remaining, got ${productAfter30.remainingToday}.`);
    assert(productAfter30.soldOut === true, "Expected product to be marked as sold out.");

    console.log("stock test ok");
    console.log(`Coca-Cola 600 ml: limit ${product.dailyStock}, sold ${soldAfter30}, remaining ${productAfter30.remainingToday}`);
  } finally {
    await stopServer(child);
    await removeTempRoot();
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

main().catch(async error => {
  await removeTempRoot();
  console.error(error.message);
  process.exit(1);
});
