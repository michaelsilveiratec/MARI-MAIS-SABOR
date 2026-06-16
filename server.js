const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const UPLOADS_DIR = path.join(PUBLIC_DIR, "uploads");
const DATA_FILE = path.join(ROOT, "data", "db.json");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
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

function readDb() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
}

function ensureUploadsDir() {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function listUploads() {
  ensureUploadsDir();
  return fs.readdirSync(UPLOADS_DIR)
    .filter(file => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map(file => ({
      name: file,
      url: `/uploads/${file}`
    }));
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
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
        reject(new Error("Imagem muito grande. Use arquivo de ate 8 MB."));
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
  if (!boundary) throw new Error("Upload invalido.");

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
      throw new Error("Formato de imagem nao permitido. Use jpg, png, webp ou gif.");
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

function parseJsonUpload(body) {
  const fileName = String(body.fileName || "foto").trim();
  const dataUrl = String(body.dataUrl || "");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/i);
  if (!match) throw new Error("Imagem invalida.");

  const extByType = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };
  const mime = match[1].toLowerCase();
  const ext = extByType[mime] || path.extname(fileName).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error("Formato de imagem nao permitido. Use jpg, png, webp ou gif.");
  }

  const content = Buffer.from(match[2], "base64");
  if (!content.length) throw new Error("Imagem vazia.");

  return {
    originalName: fileName,
    ext,
    content
  };
}

function normalizeProduct(input, current = {}) {
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
    dailyStock: Number(input.dailyStock ?? current.dailyStock ?? 0)
  };
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

function validateOrderStock(db, order) {
  const requested = order.items.reduce((acc, item) => {
    acc[item.productId] = (acc[item.productId] || 0) + Number(item.quantity || 0);
    return acc;
  }, {});

  for (const [productId, quantity] of Object.entries(requested)) {
    const product = db.products.find(current => current.id === productId);
    if (!product || !product.active) {
      throw new Error("Um item do pedido nao esta disponivel.");
    }

    if (product.dayOfWeek && product.dayOfWeek !== currentWeekday()) {
      throw new Error(`${product.name} nao esta disponivel no cardapio de hoje.`);
    }

    if (Number(product.dailyStock || 0) > 0) {
      const remaining = Number(product.dailyStock) - soldToday(db, productId);
      if (quantity > remaining) {
        throw new Error(`${product.name} esgotado devido ao numero de pedidos do dia.`);
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
        if (fallbackError) return send(res, 404, "Arquivo nao encontrado.", "text/plain; charset=utf-8");
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
  const db = readDb();

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      return send(res, 200, { ...db, uploads: listUploads() });
    }

    if (req.method === "GET" && url.pathname === "/api/uploads") {
      return send(res, 200, listUploads());
    }

    if (req.method === "POST" && url.pathname === "/api/uploads") {
      ensureUploadsDir();
      const contentType = req.headers["content-type"] || "";
      const file = contentType.includes("application/json")
        ? parseJsonUpload(await readBody(req))
        : parseMultipartFile(await readUpload(req), contentType);
      const fileName = safeUploadName(file.originalName, file.ext);
      const target = path.join(UPLOADS_DIR, fileName);
      fs.writeFileSync(target, file.content);
      return send(res, 201, {
        name: fileName,
        url: `/uploads/${fileName}`
      });
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      return send(res, 200, db.products);
    }

    if (req.method === "POST" && url.pathname === "/api/products") {
      const body = await readBody(req);
      const product = normalizeProduct(body);
      product.id = `p${Date.now()}`;
      db.products.unshift(product);
      writeDb(db);
      return send(res, 201, product);
    }

    if (parts[1] === "products" && parts[2]) {
      const index = db.products.findIndex(product => product.id === parts[2]);
      if (index === -1) return send(res, 404, { error: "Produto nao encontrado." });

      if (req.method === "PUT") {
        const body = await readBody(req);
        db.products[index] = normalizeProduct(body, db.products[index]);
        writeDb(db);
        return send(res, 200, db.products[index]);
      }

      if (req.method === "PATCH") {
        const body = await readBody(req);
        db.products[index] = { ...db.products[index], ...body };
        writeDb(db);
        return send(res, 200, db.products[index]);
      }

      if (req.method === "DELETE") {
        const [removed] = db.products.splice(index, 1);
        writeDb(db);
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
      writeDb(db);
      return send(res, 201, order);
    }

    if (parts[1] === "orders" && parts[2]) {
      const index = db.orders.findIndex(order => order.id === parts[2]);
      if (index === -1) return send(res, 404, { error: "Pedido nao encontrado." });

      if (req.method === "PATCH") {
        const body = await readBody(req);
        db.orders[index] = { ...db.orders[index], ...body };
        if (body.status) {
          db.orders[index].history = [
            ...(db.orders[index].history || []),
            { status: body.status, at: new Date().toISOString() }
          ];
        }
        writeDb(db);
        return send(res, 200, db.orders[index]);
      }
    }

    send(res, 404, { error: "Rota nao encontrada." });
  } catch (error) {
    send(res, 400, { error: error.message || "Erro na requisicao." });
  }
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) return handleApi(req, res);
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Mari Mais Sabor rodando em http://localhost:${PORT}`);
});
