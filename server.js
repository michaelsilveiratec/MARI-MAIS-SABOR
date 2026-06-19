const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Pool } = require("pg");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_FILE = path.join(ROOT, "data", "db.json");
const SEED_DATA_FILE = path.join(ROOT, "data", "default-db.json");
const RUNTIME_DATA_FILE = process.env.VERCEL ? path.join("/tmp", "mari-mais-sabor-db.json") : DATA_FILE;
const PRINT_SCRIPT = path.join(ROOT, "print-large.ps1");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".jfif", ".png", ".webp", ".gif", ".avif", ".bmp"]);
const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.POSTGRES_PRISMA_URL || "";

let pool = null;
let databaseReady = false;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml; charset=utf-8"
};

const WEEKDAY_KEYS = {
  Mon: "segunda",
  Tue: "terca",
  Wed: "quarta",
  Thu: "quinta",
  Fri: "sexta",
  Sat: "sabado",
  Sun: "domingo"
};

function seedDataFile() {
  return fs.existsSync(SEED_DATA_FILE) ? SEED_DATA_FILE : DATA_FILE;
}

function readSeedDb() {
  return JSON.parse(fs.readFileSync(seedDataFile(), "utf8"));
}

function runtimeDataFile() {
  if (process.env.VERCEL && !fs.existsSync(RUNTIME_DATA_FILE)) {
    fs.copyFileSync(seedDataFile(), RUNTIME_DATA_FILE);
  }
  return RUNTIME_DATA_FILE;
}

function shouldUseSqlDatabase() {
  return Boolean(DATABASE_URL);
}

function getPool() {
  if (!pool) {
    const isLocalDatabase = /localhost|127\.0\.0\.1/i.test(DATABASE_URL);
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocalDatabase ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function ensureDatabase() {
  if (!shouldUseSqlDatabase() || databaseReady) return;

  const client = getPool();
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TEXT PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const existing = await client.query("SELECT id FROM app_state WHERE id = $1", ["main"]);
  if (!existing.rowCount) {
    await client.query(
      "INSERT INTO app_state (id, data) VALUES ($1, $2::jsonb)",
      ["main", JSON.stringify(readSeedDb())]
    );
  }

  databaseReady = true;
}

async function readDb() {
  if (shouldUseSqlDatabase()) {
    await ensureDatabase();
    const result = await getPool().query("SELECT data FROM app_state WHERE id = $1", ["main"]);
    return result.rows[0]?.data || readSeedDb();
  }

  return JSON.parse(fs.readFileSync(runtimeDataFile(), "utf8"));
}

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function listUploads() {
  if (process.env.VERCEL) return [];
  ensureUploadsDir();
  return fs.readdirSync(UPLOADS_DIR)
    .filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map(file => ({
      name: file,
      url: `/uploads/${file}`
    }));
}

async function writeDb(db) {
  if (shouldUseSqlDatabase()) {
    await ensureDatabase();
    await getPool().query(
      `
        INSERT INTO app_state (id, data, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (id)
        DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
      `,
      ["main", JSON.stringify(db)]
    );
    return;
  }

  fs.writeFileSync(runtimeDataFile(), JSON.stringify(db, null, 2));
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function dateTime(value) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatAddress(order) {
  if (order.fulfillment?.type === "Retirada") return "Retirada no restaurante";
  return `${order.fulfillment?.address || ""}, ${order.fulfillment?.number || ""} - ${order.fulfillment?.neighborhood || ""} ${order.fulfillment?.complement || ""}`.trim();
}

function formatPayment(order) {
  if (order.payment?.method === "Dinheiro na entrega") {
    return `Dinheiro na entrega${order.payment.changeFor ? ` - troco para ${order.payment.changeFor}` : " - levar troco"}`;
  }
  if (order.payment?.method === "Cartao na entrega" || order.payment?.method === "Cartão na entrega") {
    return "Cartão na entrega - levar maquininha";
  }
  return order.payment?.pixProof ? `Pix - comprovante: ${order.payment.pixProof}` : "Pix";
}

function receiptHeader(restaurant = {}) {
  return `${(restaurant.name || "Mari Mais Sabor").toUpperCase()}
Endereço: ${restaurant.address || "Rua Haiti 56 Rochdale-Osasco"}
Contato: ${restaurant.contact || "11952458505"}
CEP: ${restaurant.cep || "06220056"}
CNPJ: ${restaurant.cnpj || "46.749.934/0001-21"}`;
}

function driverReceiptText(order, restaurant = {}) {
  return `PEDIDO #${order.id}
${receiptHeader(restaurant)}

Cliente: ${order.customer?.name || ""}
Telefone: ${order.customer?.phone || ""}
Horário: ${dateTime(order.createdAt)}

Itens:
${(order.items || []).map(item => `${item.quantity}x ${item.name}`).join("\n")}

Observação:
${order.note || "Sem observação"}

Endereço:
${formatAddress(order)}

Pagamento:
${formatPayment(order)}

Total:
${money(order.totals?.total)}
`;
}

function kitchenReceiptText(order, restaurant = {}) {
  return `${receiptHeader(restaurant)}

COMANDA COZINHA

Pedido: #${order.id}
Horário: ${dateTime(order.createdAt)}
Tipo: ${order.fulfillment?.type || "Entrega"}

Itens:
${(order.items || []).map(item => `${item.quantity}x ${item.name}`).join("\n")}

Observação:
${order.note || "Sem observação"}

Cliente:
${order.customer?.name || ""}
Telefone:
${order.customer?.phone || ""}
Endereço:
${formatAddress(order)}
`;
}

function receiptText(order, restaurant = {}, type = "driver") {
  if (type === "kitchen") return kitchenReceiptText(order, restaurant);
  if (type === "both") return kitchenReceiptText(order, restaurant);
  return driverReceiptText(order, restaurant);
}

function localLogoPath(restaurant = {}) {
  const logoUrl = String(restaurant.logoUrl || "").trim();
  if (!logoUrl.startsWith("/uploads/")) return "";

  const filePath = path.join(PUBLIC_DIR, logoUrl.replace(/^\//, ""));
  return filePath.startsWith(UPLOADS_DIR) && fs.existsSync(filePath) ? filePath : "";
}

function printReceipt(order, printerName, restaurant = {}, type = "driver") {
  if (!printerName) throw new Error("Nenhuma impressora configurada no sistema.");

  return new Promise((resolve, reject) => {
    const powershell = spawn(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", PRINT_SCRIPT],
      {
        env: { ...process.env, PRINTER_NAME: printerName, LOGO_PATH: localLogoPath(restaurant) },
        windowsHide: true
      }
    );

    let errorOutput = "";
    powershell.stderr.on("data", chunk => {
      errorOutput += chunk.toString();
    });
    powershell.on("error", reject);
    powershell.on("close", code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(errorOutput.trim() || "Não foi possível enviar para a impressora."));
    });
    powershell.stdin.end(receiptText(order, restaurant, type));
  });
}

function send(res, status, payload, contentType = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  if (Buffer.isBuffer(payload)) {
    res.end(payload);
    return;
  }
  res.end(typeof payload === "string" ? payload : JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 12_000_000) {
        req.destroy();
        reject(new Error("Payload muito grande."));
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function readUpload(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", chunk => {
      size += chunk.length;
      if (size > 8_000_000) {
        req.destroy();
        reject(new Error("Imagem muito grande. Use arquivo de até 8 MB."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseMultipartFile(buffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  const boundary = boundaryMatch?.[1] || boundaryMatch?.[2];
  if (!boundary) throw new Error("Upload inválido.");

  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    let partStart = cursor + delimiter.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;

    const next = buffer.indexOf(delimiter, partStart);
    if (next === -1) break;

    let partEnd = next;
    if (buffer[partEnd - 2] === 13 && buffer[partEnd - 1] === 10) partEnd -= 2;

    const part = buffer.subarray(partStart, partEnd);
    const headerSeparator = Buffer.from("\r\n\r\n");
    let headerEnd = part.indexOf(headerSeparator);
    let separatorLength = headerSeparator.length;
    if (headerEnd === -1) {
      const fallbackSeparator = Buffer.from("\n\n");
      headerEnd = part.indexOf(fallbackSeparator);
      separatorLength = fallbackSeparator.length;
    }
    if (headerEnd === -1) {
      cursor = next;
      continue;
    }

    const headers = part.subarray(0, headerEnd).toString("latin1");
    const body = part.subarray(headerEnd + separatorLength);
    const disposition = headers.match(/Content-Disposition:[^\r\n]+/i)?.[0] || "";
    const filename =
      disposition.match(/filename\*=UTF-8''([^;\r\n]+)/i)?.[1] ||
      disposition.match(/filename="([^"]*)"/i)?.[1] ||
      disposition.match(/filename=([^;\r\n]+)/i)?.[1];
    if (!filename) {
      cursor = next;
      continue;
    }

    const originalName = decodeURIComponent(filename).replace(/^"(.*)"$/, "$1");
    const ext = path.extname(originalName).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) {
      throw new Error("Formato de imagem não permitido. Use jpg, jpeg, jfif, png, webp, gif, avif ou bmp.");
    }
    if (!body.length) throw new Error("Imagem vazia.");

    return {
      originalName,
      ext,
      content: body
    };
  }

  throw new Error("Nenhuma imagem enviada.");
}

function safeUploadName(originalName, ext) {
  const base = path.basename(originalName, ext)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "foto";
  return `${Date.now()}-${base}${ext}`;
}

function detectImageExtension(content) {
  if (content.length >= 4 && content[0] === 0x89 && content[1] === 0x50 && content[2] === 0x4e && content[3] === 0x47) return ".png";
  if (content.length >= 3 && content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff) return ".jpg";
  if (content.length >= 2 && content[0] === 0x42 && content[1] === 0x4d) return ".bmp";
  if (content.length >= 6 && content.subarray(0, 6).toString("ascii") === "GIF87a") return ".gif";
  if (content.length >= 6 && content.subarray(0, 6).toString("ascii") === "GIF89a") return ".gif";
  if (content.length >= 12 && content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (content.length >= 12 && content.subarray(4, 8).toString("ascii") === "ftyp" && ["avif", "avis"].includes(content.subarray(8, 12).toString("ascii"))) return ".avif";
  return "";
}

function parseJsonUpload(body) {
  const fileName = String(body.fileName || "foto").trim();
  const dataUrl = String(body.dataUrl || "");
  const match = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!match) throw new Error("Imagem inválida.");

  const extByType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/pjpeg": ".jpg",
    "image/jfif": ".jfif",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/avif": ".avif",
    "image/bmp": ".bmp",
    "image/x-ms-bmp": ".bmp"
  };
  const mime = String(match[1] || "").toLowerCase();
  const content = Buffer.from(match[2], "base64");
  if (!content.length) throw new Error("Imagem vazia.");

  const detectedExt = detectImageExtension(content);
  const fileExt = path.extname(fileName).toLowerCase();
  const ext = detectedExt || extByType[mime] || fileExt;
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Formato de imagem não permitido. Use jpg, jpeg, jfif, png, webp, gif, avif ou bmp.");
  }

  return {
    originalName: fileName,
    ext,
    content
  };
}

function imageDataUrl(file) {
  const contentType = MIME[file.ext] || "application/octet-stream";
  return `data:${contentType.split(";")[0]};base64,${file.content.toString("base64")}`;
}

function canWriteLocalUploads() {
  return !process.env.VERCEL;
}

function hasDailyStockLimit(value) {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

function normalizeDailyStock(value) {
  if (!hasDailyStockLimit(value)) return null;
  const stock = Number(value);
  if (!Number.isFinite(stock) || stock < 0) return 0;
  return Math.floor(stock);
}

function normalizeProduct(input, current = {}) {
  const dailyStockSource = Object.prototype.hasOwnProperty.call(input, "dailyStock")
    ? input.dailyStock
    : current.dailyStock;

  return {
    ...current,
    name: String(input.name || current.name || "").trim(),
    category: String(input.category || current.category || "Marmitas").trim(),
    description: String(input.description || current.description || "").trim(),
    price: Number(input.price ?? current.price ?? 0),
    image: String(input.image || current.image || "").trim(),
    active: Boolean(input.active ?? current.active ?? true),
    dishOfDay: Boolean(input.dishOfDay ?? current.dishOfDay ?? false),
    dayOfWeek: String(input.dayOfWeek ?? current.dayOfWeek ?? "").trim(),
    dailyStock: normalizeDailyStock(dailyStockSource)
  };
}

function normalizeRestaurant(input, current = {}) {
  const next = { ...current };
  [
    "name",
    "address",
    "contact",
    "cep",
    "cnpj",
    "logoUrl",
    "whatsapp",
    "pixKey",
    "pixName",
    "printerName"
  ].forEach(key => {
    if (input[key] !== undefined) next[key] = String(input[key] || "").trim();
  });
  if (input.deliveryFee !== undefined) next.deliveryFee = Number(input.deliveryFee || 0);
  return next;
}

function normalizeOrder(input) {
  const items = Array.isArray(input.items) ? input.items : [];
  return {
    customer: input.customer || {},
    fulfillment: input.fulfillment || {},
    payment: input.payment || {},
    note: String(input.note || "").trim(),
    items: items.map(item => ({
      productId: String(item.productId || ""),
      name: String(item.name || ""),
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      note: String(item.note || "").trim()
    })),
    totals: {
      subtotal: Number(input.totals?.subtotal || 0),
      deliveryFee: Number(input.totals?.deliveryFee || 0),
      total: Number(input.totals?.total || 0)
    }
  };
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function localDateKey(value) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function currentWeekday() {
  const shortDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short"
  }).format(new Date());
  return WEEKDAY_KEYS[shortDay] || "";
}

function soldToday(db, productId) {
  const dateKey = todayKey();
  return db.orders
    .filter(order => order.status !== "cancelado" && localDateKey(order.createdAt) === dateKey)
    .flatMap(order => order.items || [])
    .filter(item => item.productId === productId)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function productWithAvailability(db, product) {
  const hasLimit = hasDailyStockLimit(product.dailyStock);
  const dailyStock = hasLimit ? Number(product.dailyStock) : null;
  const sold = soldToday(db, product.id);
  const remaining = hasLimit ? Math.max(0, dailyStock - sold) : null;
  return {
    ...product,
    soldToday: sold,
    remainingToday: remaining,
    soldOut: hasLimit && remaining <= 0
  };
}

function productsWithAvailability(db) {
  return db.products.map(product => productWithAvailability(db, product));
}

function compactHistory(history = []) {
  return history.filter((entry, index, entries) => index === 0 || entry.status !== entries[index - 1]?.status);
}

function validateOrderStock(db, order) {
  const requested = order.items.reduce((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + Number(item.quantity || 0);
    return acc;
  }, {});

  for (const [productId, quantity] of Object.entries(requested)) {
    const product = db.products.find(current => current.id === productId);
    if (!product || !product.active) {
      throw new Error("Um item do pedido não está disponível.");
    }

    if (product.dayOfWeek && product.dayOfWeek !== currentWeekday()) {
      throw new Error(`${product.name} não está disponível no cardápio de hoje.`);
    }

    if (hasDailyStockLimit(product.dailyStock)) {
      const remaining = Math.max(0, Number(product.dailyStock) - soldToday(db, productId));
      if (quantity > remaining) {
        throw new Error(`${product.name} esgotado devido ao número de pedidos do dia.`);
      }
    }
  }
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const safePath = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, safePath);

  if (url.pathname === "/" || !path.extname(filePath)) {
    filePath = path.join(PUBLIC_DIR, "index.html");
  }

  if (!filePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, "Acesso negado.", "text/plain; charset=utf-8");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return send(res, 404, "Arquivo não encontrado.", "text/plain; charset=utf-8");
        send(res, 200, fallback, MIME[".html"]);
      });
      return;
    }
    send(res, 200, content, MIME[path.extname(filePath)] || "application/octet-stream");
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);
  const db = await readDb();

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, { ...db, products: productsWithAvailability(db), uploads: listUploads() });
    }

    if (req.method === "GET" && url.pathname === "/api/uploads") {
      return send(res, 200, listUploads());
    }

    if (req.method === "PATCH" && url.pathname === "/api/restaurant") {
      const body = await readBody(req);
      db.restaurant = normalizeRestaurant(body, db.restaurant);
      await writeDb(db);
      return send(res, 200, db.restaurant);
    }

    if (req.method === "POST" && url.pathname === "/api/uploads") {
      const contentType = req.headers["content-type"] || "";
      const file = contentType.includes("application/json")
        ? parseJsonUpload(await readBody(req))
        : parseMultipartFile(await readUpload(req), contentType);

      if (!canWriteLocalUploads()) {
        return send(res, 201, {
          name: file.originalName,
          url: imageDataUrl(file)
        });
      }

      ensureUploadsDir();
      const fileName = safeUploadName(file.originalName, file.ext);
      const target = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(target, file.content);
      return send(res, 201, {
        name: fileName,
        url: `/uploads/${fileName}`
      });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      return send(res, 200, productsWithAvailability(db));
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const body = await readBody(req);
      const product = normalizeProduct(body);
      product.id = `p${Date.now()}`;
      db.products.unshift(product);
      await writeDb(db);
      return send(res, 201, product);
    }

    if (parts[1] === "products" && parts[2]) {
      const index = db.products.findIndex(product => product.id === parts[2]);
      if (index === -1) return send(res, 404, { error: "Produto não encontrado." });

      if (req.method === "PUT") {
        const body = await readBody(req);
        db.products[index] = normalizeProduct(body, db.products[index]);
        await writeDb(db);
        return send(res, 200, db.products[index]);
      }

      if (req.method === "PATCH") {
        const body = await readBody(req);
        db.products[index] = { ...db.products[index], ...body };
        await writeDb(db);
        return send(res, 200, db.products[index]);
      }

      if (req.method === "DELETE") {
        const [removed] = db.products.splice(index, 1);
        await writeDb(db);
        return send(res, 200, removed);
      }
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      return send(res, 200, db.orders);
    }

    if (req.method === "POST" && url.pathname === "/api/orders") {
      const body = await readBody(req);
      const base = normalizeOrder(body);
      validateOrderStock(db, base);
      const order = {
        ...base,
        id: String(db.nextOrder || 1).padStart(4, "0"),
        createdAt: new Date().toISOString(),
        status: "novo",
        paymentStatus: base.payment.method === "Pix" ? "aguardando pagamento" : "pagar na entrega",
        history: [{ status: "novo", at: new Date().toISOString() }]
      };
      db.nextOrder = Number(db.nextOrder || 1) + 1;
      db.orders.unshift(order);
      await writeDb(db);
      if (db.restaurant.printerName && !process.env.VERCEL) {
        try {
          await printReceipt(order, db.restaurant.printerName, db.restaurant, "kitchen");
          order.printedAt = new Date().toISOString();
          order.printError = "";
        } catch (error) {
          order.printError = error.message || "Não foi possível imprimir automaticamente.";
        }
        await writeDb(db);
      }
      return send(res, 201, order);
    }

    if (parts[1] === "orders" && parts[2]) {
      const index = db.orders.findIndex(order => order.id === parts[2]);
      if (index === -1) return send(res, 404, { error: "Pedido não encontrado." });

      if (req.method === "POST" && parts[3] === "print") {
        if (process.env.VERCEL) {
          return send(res, 400, { error: "Impressão direta disponível apenas no computador local da cozinha." });
        }
        await printReceipt(db.orders[index], db.restaurant.printerName, db.restaurant, url.searchParams.get("type") || "driver");
        db.orders[index].printedAt = new Date().toISOString();
        db.orders[index].printError = "";
        await writeDb(db);
        return send(res, 200, {
          ok: true,
          printerName: db.restaurant.printerName
        });
      }

      if (req.method === "PATCH") {
        const body = await readBody(req);
        const previousStatus = db.orders[index].status;
        db.orders[index] = { ...db.orders[index], ...body };
        db.orders[index].history = compactHistory(db.orders[index].history || []);
        if (body.confirmPayment) {
          db.orders[index].paymentStatus = "pago";
          db.orders[index].paymentConfirmedAt = db.orders[index].paymentConfirmedAt || new Date().toISOString();
          delete db.orders[index].confirmPayment;
        }
        if (body.status && body.status !== previousStatus) {
          db.orders[index].history = [
            ...(db.orders[index].history || []),
            { status: body.status, at: new Date().toISOString() }
          ];
        }
        await writeDb(db);
        return send(res, 200, db.orders[index]);
      }
    }

    send(res, 404, { error: "Rota não encontrada." });
  } catch (error) {
    send(res, 400, { error: error.message || "Erro na requisição." });
  }
}

async function handleRequest(req, res) {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  serveStatic(req, res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    send(res, 500, { error: error.message || "Erro interno no servidor." });
  });
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Mari Mais Sabor rodando em http://localhost:${PORT}`);
  });
}

module.exports = handleRequest;
