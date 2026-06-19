const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { Pool } = require("pg");

const execFileAsync = promisify(execFile);

const ROOT = path.join(__dirname, "..");
const ENV_FILE = path.join(ROOT, ".env.print-agent");
const DEFAULT_STATE_FILE = path.join(ROOT, "data", "print-agent-state.json");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const separator = trimmed.indexOf("=");
    if (separator === -1) return;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

loadEnvFile(ENV_FILE);

const server = require("../server");
const printReceipt = server.printReceipt;
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const PRINTER_NAME = String(process.env.PRINTER_NAME || "AUTO").trim();
const POLL_INTERVAL_MS = Math.max(2000, Number(process.env.POLL_INTERVAL_MS || 5000));
const DRY_RUN = /^(1|true|yes|sim)$/i.test(String(process.env.PRINT_AGENT_DRY_RUN || ""));
const DETECT_ONLY = process.argv.includes("--detect-printer");
const STATE_FILE = process.env.PRINT_AGENT_STATE_FILE
  ? path.resolve(ROOT, process.env.PRINT_AGENT_STATE_FILE)
  : DEFAULT_STATE_FILE;

if (process.platform !== "win32") {
  throw new Error("O agente de impressão atual funciona somente no Windows.");
}
if (!DATABASE_URL && !DETECT_ONLY) {
  throw new Error("DATABASE_URL não configurada. Crie .env.print-agent a partir de .env.print-agent.example.");
}
if (typeof printReceipt !== "function") {
  throw new Error("A função local de impressão não está disponível.");
}

const isLocalDatabase = /localhost|127\.0\.0\.1/i.test(DATABASE_URL);
const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: isLocalDatabase ? false : { rejectUnauthorized: false },
      max: 2,
      idleTimeoutMillis: 30000
    })
  : null;

function loadState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      return {
        version: 1,
        startedAt: saved.startedAt || new Date().toISOString(),
        printedOrderIds: Array.isArray(saved.printedOrderIds) ? saved.printedOrderIds.map(String) : [],
        lastPrintedAt: saved.lastPrintedAt || ""
      };
    } catch (error) {
      throw new Error(`Estado do agente inválido em ${STATE_FILE}: ${error.message}`);
    }
  }

  const initial = {
    version: 1,
    startedAt: new Date().toISOString(),
    printedOrderIds: [],
    lastPrintedAt: ""
  };
  saveState(initial);
  return initial;
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, STATE_FILE);
}

function orderTime(order) {
  const value = Date.parse(order?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

function normalizeDeviceName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isVirtualPrinter(printer) {
  return /pdf|xps|onenote|fax/i.test(`${printer?.Name || ""} ${printer?.DriverName || ""}`);
}

function printerScore(printer, preferredName, devices) {
  if (!printer || isVirtualPrinter(printer)) return -1;

  const name = normalizeDeviceName(printer.Name);
  const driver = normalizeDeviceName(printer.DriverName);
  const preferred = normalizeDeviceName(preferredName);
  const port = String(printer.PortName || "").toUpperCase();
  const thermal = /\bpos\s*80\b|\bthermal\b|\breceipt\b|\bcupom\b|\b80\s*mm\b/.test(`${name} ${driver}`);
  const preferredMatch = Boolean(preferred && (name === preferred || name.includes(preferred) || preferred.includes(name)));
  if (!thermal && !preferredMatch) return -1;
  const usbDevices = devices.filter(device => /^USBPRINT\\/i.test(String(device.InstanceId || "")));
  const serialDevices = devices.filter(device => String(device.Class || "").toLowerCase() === "ports");
  const deviceMatches = devices.some(device => {
    const physical = normalizeDeviceName(`${device.FriendlyName || ""} ${device.InstanceId || ""}`);
    return Boolean(physical && (physical.includes(name) || name.includes(physical) || physical.includes(driver)));
  });

  let physicallyPresent = false;
  if (port.startsWith("USB")) physicallyPresent = deviceMatches || thermal && usbDevices.length === 1;
  else if (port.startsWith("COM")) {
    physicallyPresent = serialDevices.some(device => {
      const physical = normalizeDeviceName(`${device.FriendlyName || ""} ${device.InstanceId || ""}`);
      return physical.includes(name) || physical.includes(driver) || serialDevices.length === 1;
    });
  } else {
    physicallyPresent = printer.WorkOffline !== true;
  }

  if (!physicallyPresent) return -1;

  let score = 0;
  if (preferred && name === preferred) score += 1000;
  else if (preferredMatch) score += 500;
  if (/pos 80/.test(name) || /pos 80/.test(driver)) score += 400;
  if (thermal) score += 200;
  if (port.startsWith("USB")) score += 100;
  if (port.startsWith("COM")) score += 50;
  return score;
}

async function readWindowsPrinters() {
  const command = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$printers = @(Get-Printer | Select-Object Name, DriverName, PortName, PrinterStatus, WorkOffline)",
    "$devices = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USBPRINT\\*' -or $_.Class -eq 'Ports' } | Select-Object Class, FriendlyName, Status, InstanceId)",
    "[pscustomobject]@{ Printers = $printers; Devices = $devices } | ConvertTo-Json -Depth 4 -Compress"
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", command], {
    windowsHide: true,
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  const result = JSON.parse(String(stdout || "{}").trim() || "{}");
  return {
    printers: Array.isArray(result.Printers) ? result.Printers : result.Printers ? [result.Printers] : [],
    devices: Array.isArray(result.Devices) ? result.Devices : result.Devices ? [result.Devices] : []
  };
}

async function detectPrinter(restaurant) {
  const mode = String(restaurant.printerMode || "auto").toLowerCase();
  if (mode === "disabled") return { mode, printer: null, reason: "disabled" };

  const configuredName = String(restaurant.printerName || "").trim();
  const localName = !PRINTER_NAME || PRINTER_NAME.toUpperCase() === "AUTO" ? "" : PRINTER_NAME;
  const preferredName = mode === "manual" ? configuredName || localName : configuredName || localName || "POS-80";
  const { printers, devices } = await readWindowsPrinters();
  const ranked = printers
    .map(printer => ({ printer, score: printerScore(printer, preferredName, devices) }))
    .filter(entry => entry.score >= 0)
    .sort((left, right) => right.score - left.score);

  if (mode === "manual" && preferredName) {
    const preferred = ranked.find(entry => normalizeDeviceName(entry.printer.Name) === normalizeDeviceName(preferredName));
    return { mode, printer: preferred?.printer || null, reason: preferred ? "connected" : "preferred-not-connected" };
  }

  return { mode, printer: ranked[0]?.printer || null, reason: ranked.length ? "connected" : "usb-not-connected" };
}

async function readApplicationState() {
  const result = await pool.query("SELECT data FROM app_state WHERE id = $1", ["main"]);
  if (!result.rowCount) {
    throw new Error("A linha app_state/main ainda não existe. Abra o site publicado uma vez e tente novamente.");
  }
  return result.rows[0].data || {};
}

async function markPrinted(orderId, printedAt) {
  const result = await pool.query(
    `
      WITH target AS (
        SELECT (entry.ordinality - 1)::integer AS order_index
        FROM app_state AS current_state
        CROSS JOIN LATERAL jsonb_array_elements(current_state.data->'orders')
          WITH ORDINALITY AS entry(order_data, ordinality)
        WHERE current_state.id = $1
          AND entry.order_data->>'id' = $2
        LIMIT 1
      )
      UPDATE app_state AS current_state
      SET data = jsonb_set(
            current_state.data,
            ARRAY['orders', target.order_index::text],
            (current_state.data->'orders'->target.order_index)
              || jsonb_build_object(
                'printedAt', $3::text,
                'printError', '',
                'printedBy', 'windows-local-agent'
              ),
            false
          ),
          updated_at = NOW()
      FROM target
      WHERE current_state.id = $1
      RETURNING current_state.id
    `,
    ["main", String(orderId), printedAt]
  );

  if (!result.rowCount) {
    throw new Error(`Pedido #${orderId} não foi encontrado para confirmar a impressão.`);
  }
}

async function updateAgentHeartbeat(detection) {
  const printer = detection.printer;
  const heartbeat = {
    lastSeenAt: new Date().toISOString(),
    status: detection.reason,
    mode: detection.mode,
    detectedPrinter: printer?.Name || "",
    driverName: printer?.DriverName || "",
    portName: printer?.PortName || ""
  };
  await pool.query(
    `
      UPDATE app_state
      SET data = jsonb_set(data, '{restaurant,printerAgent}', $2::jsonb, true),
          updated_at = NOW()
      WHERE id = $1
    `,
    ["main", JSON.stringify(heartbeat)]
  );
}

const agentState = DETECT_ONLY
  ? { version: 1, startedAt: new Date().toISOString(), printedOrderIds: [], lastPrintedAt: "" }
  : loadState();
const printedOrderIds = new Set(agentState.printedOrderIds);
let polling = false;
let connectedMessageShown = false;
let lastDetectionKey = "";
let lastHeartbeatAt = 0;

async function poll() {
  if (polling) return;
  polling = true;

  try {
    const db = await readApplicationState();
    const restaurant = db.restaurant || {};
    const detection = await detectPrinter(restaurant);
    const detectedPrinter = detection.printer;
    const detectionKey = `${detection.mode}:${detection.reason}:${detectedPrinter?.Name || ""}:${detectedPrinter?.PortName || ""}`;
    if (detectionKey !== lastDetectionKey || Date.now() - lastHeartbeatAt >= 30000) {
      await updateAgentHeartbeat(detection);
      lastHeartbeatAt = Date.now();
    }
    if (detectionKey !== lastDetectionKey) {
      if (detection.reason === "disabled") console.log("Impressão automática desativada pelo painel Admin.");
      else if (detectedPrinter) console.log(`Impressora conectada: ${detectedPrinter.Name} em ${detectedPrinter.PortName}.`);
      else console.log("Aguardando a impressora térmica ser conectada ao USB.");
      lastDetectionKey = detectionKey;
    }
    const startedAt = Date.parse(agentState.startedAt);
    const candidates = (Array.isArray(db.orders) ? db.orders : [])
      .filter(order => order?.status !== "cancelado")
      .filter(order => !order?.printedAt)
      .filter(order => orderTime(order) >= startedAt)
      .sort((left, right) => orderTime(left) - orderTime(right));

    if (!connectedMessageShown) {
      console.log("Conectado ao Neon. Aguardando pedidos novos.");
      console.log(`Pedidos anteriores a ${agentState.startedAt} não serão impressos automaticamente.`);
      if (DRY_RUN) console.log("MODO DE TESTE ATIVO: nenhum papel será impresso.");
      connectedMessageShown = true;
    }

    if (!detectedPrinter || detection.reason === "disabled") return;

    for (const order of candidates) {
      const id = String(order.id || "");
      if (!id) continue;

      if (printedOrderIds.has(id)) {
        if (!DRY_RUN) await markPrinted(id, agentState.lastPrintedAt || new Date().toISOString());
        continue;
      }

      console.log(`${DRY_RUN ? "[TESTE] " : ""}Pedido #${id} recebido.`);
      if (DRY_RUN) continue;

      try {
        await printReceipt(order, detectedPrinter.Name, restaurant, "kitchen");
        const printedAt = new Date().toISOString();
        printedOrderIds.add(id);
        agentState.printedOrderIds = Array.from(printedOrderIds);
        agentState.lastPrintedAt = printedAt;
        saveState(agentState);
        await markPrinted(id, printedAt);
        console.log(`Pedido #${id} impresso e confirmado no Neon.`);
      } catch (error) {
        console.error(`Falha ao imprimir o pedido #${id}: ${error.message}`);
        break;
      }
    }
  } catch (error) {
    console.error(`Agente aguardando conexão: ${error.message}`);
  } finally {
    polling = false;
  }
}

async function shutdown() {
  console.log("Encerrando o agente de impressão...");
  if (timer) clearInterval(timer);
  if (pool) await pool.end().catch(() => {});
  process.exit(0);
}

let timer;
if (DETECT_ONLY) {
  detectPrinter({ printerMode: "auto", printerName: PRINTER_NAME === "AUTO" ? "POS-80" : PRINTER_NAME })
    .then(detection => {
      if (detection.printer) {
        console.log(`Impressora detectada: ${detection.printer.Name} (${detection.printer.PortName})`);
        process.exit(0);
      }
      console.log("Nenhuma impressora térmica conectada ao USB foi detectada.");
      process.exit(2);
    })
    .catch(error => {
      console.error(`Falha na detecção: ${error.message}`);
      process.exit(1);
    });
} else {
  console.log("Agente de impressão Mari Mais Sabor iniciado.");
  console.log(`Detecção automática USB | consulta a cada ${POLL_INTERVAL_MS / 1000}s`);
  poll();
  timer = setInterval(poll, POLL_INTERVAL_MS);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
