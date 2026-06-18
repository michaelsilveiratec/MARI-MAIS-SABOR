const app = document.querySelector("#app");
const CART_KEY = "mari_mais_sabor_cart";
const AUTO_PRINT_KEY = "mari_mais_sabor_auto_print";
const AUTO_PRINT_DEFAULT_KEY = "mari_mais_sabor_auto_print_default_v2";
const KITCHEN_VOICE_KEY = "mari_mais_sabor_kitchen_voice";
const KITCHEN_VOICE_DEFAULT_KEY = "mari_mais_sabor_kitchen_voice_default_v1";

const statusLabels = {
  novo: "Novo",
  em_preparo: "Em preparo",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado"
};

const customerStatusLabels = {
  novo: "Pedido recebido",
  em_preparo: "Em preparo",
  saiu_para_entrega: "A caminho",
  entregue: "Entregue",
  cancelado: "Cancelado"
};

const customerSteps = ["novo", "em_preparo", "saiu_para_entrega", "entregue"];
const statusRefreshIntervals = [8000, 8000, 8000, 12000];
const deliveryEstimateText = "35 a 45 minutos";
const deliveryEstimateMin = 35;
const deliveryEstimateMax = 45;
const pixMerchantCity = "OSASCO";

const dayLabels = {
  segunda: "Segunda",
  terca: "Terça",
  quarta: "Quarta",
  quinta: "Quinta",
  sexta: "Sexta",
  sabado: "Sábado"
};

const weekdayKeys = {
  Mon: "segunda",
  Tue: "terca",
  Wed: "quarta",
  Thu: "quinta",
  Fri: "sexta",
  Sat: "sabado",
  Sun: "domingo"
};

const paymentStatusLabels = {
  "aguardando pagamento": "Aguardando pagamento",
  "pagar na entrega": "Pagar na entrega",
  pago: "Pago"
};

const categoryLabels = {
  "Cardapio do dia": "Cardápio do dia"
};

let state = {
  restaurant: {},
  products: [],
  orders: [],
  uploads: [],
  cart: loadCart(),
  adminTab: "pedidos",
  orderTab: "novo",
  reportPeriod: "today",
  editingProduct: null,
  flash: "",
  flashType: "success",
  autoPrintKitchen: loadAutoPrintKitchen(),
  kitchenVoice: loadKitchenVoice(),
  kitchenAudioUnlocked: false,
  seenKitchenOrders: new Set(),
  kitchenInitialized: false,
  lastSeenKitchenOrder: null,
  statusRefresh: {
    orderId: null,
    attempts: 0,
    timer: null,
    clockTimer: null
  }
};

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) || [];
  } catch {
    return [];
  }
}

function saveCart() {
  localStorage.setItem(CART_KEY, JSON.stringify(state.cart));
}

function loadAutoPrintKitchen() {
  if (localStorage.getItem(AUTO_PRINT_DEFAULT_KEY) !== "1") {
    localStorage.setItem(AUTO_PRINT_DEFAULT_KEY, "1");
    localStorage.setItem(AUTO_PRINT_KEY, "1");
    return true;
  }
  const stored = localStorage.getItem(AUTO_PRINT_KEY);
  return stored === null ? true : stored === "1";
}

function saveAutoPrintKitchen() {
  localStorage.setItem(AUTO_PRINT_DEFAULT_KEY, "1");
  localStorage.setItem(AUTO_PRINT_KEY, state.autoPrintKitchen ? "1" : "0");
}

function loadKitchenVoice() {
  if (localStorage.getItem(KITCHEN_VOICE_DEFAULT_KEY) !== "1") {
    localStorage.setItem(KITCHEN_VOICE_DEFAULT_KEY, "1");
    localStorage.setItem(KITCHEN_VOICE_KEY, "1");
    return true;
  }
  const stored = localStorage.getItem(KITCHEN_VOICE_KEY);
  return stored === null ? true : stored === "1";
}

function saveKitchenVoice() {
  localStorage.setItem(KITCHEN_VOICE_DEFAULT_KEY, "1");
  localStorage.setItem(KITCHEN_VOICE_KEY, state.kitchenVoice ? "1" : "0");
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function categoryLabel(category) {
  return categoryLabels[category] || category || "";
}

function paymentStatusLabel(status) {
  return paymentStatusLabels[status] || status || "Não informado";
}

function paymentMethodLabel(method) {
  if (method === "Cartao na entrega" || method === "Cartão na entrega") return "Cartão na entrega";
  return method || "Não informado";
}

function plainText(value, max = 99) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 $%*+\-./:]/g, "")
    .trim()
    .slice(0, max);
}

function emv(id, value) {
  const text = String(value || "");
  return `${id}${String(text.length).padStart(2, "0")}${text}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function pixPayload(order) {
  const pixKey = String(state.restaurant.pixKey || "").trim();
  const pixName = plainText(state.restaurant.pixName || state.restaurant.name || "Mari Mais Sabor", 25).toUpperCase();
  const city = plainText(pixMerchantCity, 15).toUpperCase();
  const amount = Number(order.totals?.total || 0).toFixed(2);
  const merchantAccount = emv("00", "br.gov.bcb.pix") + emv("01", pixKey);
  const additionalData = emv("05", `PED${order.id}`.slice(0, 25));
  const payload = [
    emv("00", "01"),
    emv("26", merchantAccount),
    emv("52", "0000"),
    emv("53", "986"),
    emv("54", amount),
    emv("58", "BR"),
    emv("59", pixName),
    emv("60", city),
    emv("62", additionalData)
  ].join("");
  const payloadWithCrc = `${payload}6304`;
  return `${payloadWithCrc}${crc16(payloadWithCrc)}`;
}

function pixQrUrl(payload) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=8&data=${encodeURIComponent(payload)}`;
}

function dateTime(value) {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function localDateKey(value) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function todayWeekdayKey() {
  const shortDay = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short"
  }).format(new Date());
  return weekdayKeys[shortDay] || "";
}

function soldToday(productId) {
  const dateKey = todayKey();
  return state.orders
    .filter(order => order.status !== "cancelado" && localDateKey(order.createdAt) === dateKey)
    .flatMap(order => order.items || [])
    .filter(item => item.productId === productId)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function remainingToday(product) {
  if (!Number(product.dailyStock || 0)) return Infinity;
  return Math.max(0, Number(product.dailyStock) - soldToday(product.id));
}

function isProductForToday(product) {
  return !product.dayOfWeek || product.dayOfWeek === todayWeekdayKey();
}

function isSoldOut(product) {
  return Number(product.dailyStock || 0) > 0 && remainingToday(product) <= 0;
}

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Erro no sistema.");
    return data;
  });
}

async function refresh() {
  const data = await api("/api/state");
  state.restaurant = data.restaurant;
  state.products = data.products;
  state.orders = data.orders;
  state.uploads = data.uploads || [];
}

function restaurantLogoUrl() {
  return String(state.restaurant.logoUrl || "").trim();
}

function logoWithFallback(imageClass, fallbackClass = "brand-mark") {
  const logo = restaurantLogoUrl();
  return `
    ${logo ? `<img class="${imageClass}" src="${logo}" alt="${state.restaurant.name || "Mari Mais Sabor"}" onerror="this.hidden=true;this.nextElementSibling.hidden=false">` : ""}
    <span class="${fallbackClass}" ${logo ? "hidden" : ""}>MS</span>
  `;
}

function route() {
  const path = window.location.pathname;
  const tab = new URLSearchParams(window.location.search).get("tab");
  if (tab && ["pedidos", "cardapios", "cardapio", "marca", "relatorios"].includes(tab)) {
    state.adminTab = tab;
  }
  if (path.startsWith("/admin")) {
    clearStatusRefresh();
    return renderAdmin();
  }
  if (path.startsWith("/cozinha")) {
    clearStatusRefresh();
    return renderKitchen();
  }
  if (path.startsWith("/pedido/")) return renderStatus(path.split("/").filter(Boolean)[1]);
  clearStatusRefresh();
  return renderMenu();
}

function shell(content, active = "cardapio") {
  const isStaffArea = active === "admin" || active === "cozinha";
  const nav = isStaffArea
    ? active === "cozinha"
      ? '<span class="readonly-badge">Somente visualização</span>'
      : `
          <a class="${active === "cardapio" ? "active" : ""}" href="/cardapio">Cardápio</a>
          <a class="${active === "admin" ? "active" : ""}" href="/admin">Administração</a>
          <a class="${active === "cozinha" ? "active" : ""}" href="/cozinha">Cozinha</a>
        `
    : `<a class="active" href="/cardapio">Cardápio</a>`;

  return `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/cardapio">
          <span class="brand-logo-wrap">${logoWithFallback("brand-logo")}</span>
          <span>Mari Mais Sabor</span>
        </a>
        <nav class="nav">
          ${nav}
        </nav>
      </header>
      ${content}
    </div>
  `;
}

function renderMenu() {
  const activeProducts = state.products.filter(product => product.active && isProductForToday(product));
  const categories = [...new Set(activeProducts.map(product => product.category))];
  const hero = `
    <section class="menu-hero">
      <div class="menu-hero-content">
        <div class="hero-logo">${logoWithFallback("hero-logo-img", "hero-logo-fallback")}</div>
        <h1>Mari Mais Sabor</h1>
        <p>Cardápio digital do dia com marmitas, bebidas e sobremesas.</p>
      </div>
    </section>
  `;

  const products = categories.map(category => `
    <section>
      <div class="section-title">
        <h2>${categoryLabel(category)}</h2>
      </div>
      <div class="grid product-grid">
        ${activeProducts.filter(product => product.category === category).map(productCard).join("")}
      </div>
    </section>
  `).join("");

  app.innerHTML = shell(`
    <main class="page">
      ${hero}
      <div class="layout">
        <div>${products}</div>
        ${cartPanel()}
      </div>
    </main>
    <div id="print-area" class="print-only"></div>
  `, "cardapio");
}

function productCard(product) {
  const remaining = remainingToday(product);
  const soldOut = isSoldOut(product);
  const image = product.image || "https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=900&q=80";
  return `
    <article class="product-card ${soldOut ? "sold-out" : ""}">
      <div class="product-image">
        <img src="${image}" alt="${product.name}">
      </div>
      <div class="product-body">
        <div class="badge-row">
          ${product.dishOfDay ? '<span class="badge">Prato do dia</span>' : ""}
          ${product.dayOfWeek ? `<span class="badge">Cardápio de ${dayLabels[product.dayOfWeek] || product.dayOfWeek}</span>` : ""}
          ${Number(product.dailyStock || 0) > 0 ? `<span class="badge ${soldOut ? "danger" : ""}">${soldOut ? "Esgotado" : `Restam ${remaining}`}</span>` : ""}
        </div>
        <div class="product-heading">
          <h3>${product.name}</h3>
          <strong class="price">${money(product.price)}</strong>
        </div>
        <p class="muted">${product.description}</p>
        <button class="btn product-action" data-add="${product.id}" ${soldOut ? "disabled" : ""}>${soldOut ? "Cardápio esgotado" : "Adicionar"}</button>
      </div>
    </article>
  `;
}

function cartPanel() {
  const totals = cartTotals();
  const lines = state.cart.length
    ? state.cart.map(item => {
        const product = state.products.find(current => current.id === item.productId);
        if (!product) return "";
        return `
          <div class="cart-line">
            <div class="row">
              <strong>${product.name}</strong>
              <strong>${money(product.price * item.quantity)}</strong>
            </div>
            <div class="row">
              <span class="qty">
                <button class="icon-btn" title="Diminuir" data-dec="${product.id}">-</button>
                <strong>${item.quantity}</strong>
                <button class="icon-btn" title="Aumentar" data-inc="${product.id}">+</button>
              </span>
              <button class="btn ghost" data-remove="${product.id}">Remover</button>
            </div>
          </div>
        `;
      }).join("")
    : '<p class="muted">Seu carrinho está vazio.</p>';

  return `
    <aside class="form-panel cart">
      <div class="row">
        <h2>Carrinho</h2>
        <strong>${state.cart.reduce((sum, item) => sum + item.quantity, 0)} itens</strong>
      </div>
      ${lines}
      <div class="stack">
        <div class="row"><span>Subtotal</span><strong>${money(totals.subtotal)}</strong></div>
        <div class="row"><span>Taxa de entrega</span><strong>${money(totals.deliveryFee)}</strong></div>
        <div class="row"><span>Total</span><strong class="price">${money(totals.total)}</strong></div>
      </div>
      ${checkoutForm()}
    </aside>
  `;
}

function checkoutForm() {
  const pixConfigured = Boolean(String(state.restaurant.pixKey || "").trim());
  return `
    <form id="checkout" class="stack">
      <h3>Finalizar pedido</h3>
      <div class="field"><label>Nome</label><input name="name" required></div>
      <div class="field"><label>Telefone</label><input name="phone" required></div>
      <div class="two">
        <div class="field"><label>Entrega ou retirada</label><select name="type"><option>Entrega</option><option>Retirada</option></select></div>
        <div class="field">
          <label>Pagamento</label>
          <select name="payment">
            ${pixConfigured ? "<option>Pix</option>" : ""}
            <option>Dinheiro na entrega</option>
            <option value="Cartao na entrega">Cartão na entrega</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Endereço</label><input name="address"></div>
      <div class="two">
        <div class="field"><label>Número</label><input name="number"></div>
        <div class="field"><label>Bairro</label><input name="neighborhood"></div>
      </div>
      <div class="field"><label>Complemento</label><input name="complement"></div>
      <div class="field" data-pix-field ${pixConfigured ? "" : "hidden"}>
        <label>Pix</label>
        <p class="hint">Após confirmar o pedido, o QR Code e a chave Pix aparecem na tela.</p>
      </div>
      <div class="field" data-cash-field ${pixConfigured ? "hidden" : ""}>
        <label>Troco para quanto</label>
        <input name="changeFor" placeholder="Ex.: R$ 50,00">
        <p class="hint">O motoboy leva o troco informado para o cliente.</p>
      </div>
      <div class="field" data-card-field hidden>
        <label>Cartão na entrega</label>
        <p class="hint">O motoboy leva a maquininha de cartão no momento da entrega.</p>
      </div>
      <div class="field"><label>Observação do pedido</label><textarea name="note" placeholder="Ex.: sem cebola"></textarea></div>
      <button class="btn secondary" ${state.cart.length ? "" : "disabled"}>Confirmar pedido</button>
    </form>
  `;
}

function cartTotals(type = "Entrega") {
  const subtotal = state.cart.reduce((sum, item) => {
    const product = state.products.find(current => current.id === item.productId);
    return sum + (product ? product.price * item.quantity : 0);
  }, 0);
  const deliveryFee = type === "Entrega" && subtotal > 0 ? Number(state.restaurant.deliveryFee || 0) : 0;
  return { subtotal, deliveryFee, total: subtotal + deliveryFee };
}

function addToCart(productId) {
  const product = state.products.find(current => current.id === productId);
  if (!product || !isProductForToday(product) || isSoldOut(product)) {
    alert("Cardápio esgotado ou indisponível para hoje.");
    return;
  }
  const item = state.cart.find(current => current.productId === productId);
  const remaining = remainingToday(product);
  if (item && Number.isFinite(remaining) && item.quantity >= remaining) {
    alert("Limite disponível deste cardápio já está no carrinho.");
    return;
  }
  if (item) item.quantity += 1;
  else state.cart.push({ productId, quantity: 1 });
  saveCart();
  renderMenu();
}

async function submitOrder(form) {
  if (!state.cart.length) return;
  const data = Object.fromEntries(new FormData(form).entries());
  const totals = cartTotals(data.type);
  const order = await api("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      customer: {
        name: data.name,
        phone: data.phone
      },
      fulfillment: {
        type: data.type,
        address: data.address,
        number: data.number,
        neighborhood: data.neighborhood,
        complement: data.complement
      },
      payment: {
        method: data.payment,
        changeFor: data.payment === "Dinheiro na entrega" ? data.changeFor : "",
        pixProof: data.payment === "Pix" ? data.pixProof : ""
      },
      note: data.note,
      items: state.cart.map(item => {
        const product = state.products.find(current => current.id === item.productId);
        return {
          productId: item.productId,
          name: product.name,
          quantity: item.quantity,
          price: product.price
        };
      }),
      totals
    })
  });
  state.cart = [];
  saveCart();
  await refresh();
  history.pushState({}, "", `/pedido/${order.id}`);
  renderStatus(order.id);
}

function renderAdmin() {
  app.innerHTML = shell(`
    <main class="page">
      <div class="section-title">
        <div>
          <h1>Painel administrativo</h1>
          <p class="muted">Produtos, pedidos, impressão e relatórios.</p>
        </div>
      </div>
      ${state.flash ? `<div class="notice ${state.flashType === "error" ? "error" : ""}">${state.flash}</div>` : ""}
      <div class="tabs">
        ${["pedidos", "cardapios", "cardapio", "marca", "relatorios"].map(tab => `<button type="button" class="pill ${state.adminTab === tab ? "active" : ""}" data-admin-tab="${tab}">${tabLabel(tab)}</button>`).join("")}
      </div>
      ${state.adminTab === "pedidos" ? ordersAdmin() : ""}
      ${state.adminTab === "cardapios" ? dailyMenusAdmin() : ""}
      ${state.adminTab === "cardapio" ? productsAdmin() : ""}
      ${state.adminTab === "marca" ? brandAdmin() : ""}
      ${state.adminTab === "relatorios" ? reportsAdmin() : ""}
    </main>
    <div id="print-area" class="print-only"></div>
  `, "admin");
}

function tabLabel(tab) {
  return { pedidos: "Pedidos", cardapios: "Cardápios do dia", cardapio: "Produtos", marca: "Marca", relatorios: "Relatórios" }[tab] || tab;
}

function ordersAdmin() {
  const tabs = Object.keys(statusLabels);
  const orders = state.orders.filter(order => order.status === state.orderTab);
  return `
    <div class="tabs">
      ${tabs.map(tab => `<button type="button" class="pill ${state.orderTab === tab ? "active" : ""}" data-order-tab="${tab}">${statusLabels[tab]}</button>`).join("")}
    </div>
    <div class="grid">
      ${orders.length ? orders.map(orderCard).join("") : '<p class="muted">Nenhum pedido nesta aba.</p>'}
    </div>
  `;
}

function orderCard(order) {
  const pixAwaiting = order.payment?.method === "Pix" && order.paymentStatus !== "pago";
  const actions = orderActions(order);
  return `
    <article class="order-card status ${order.status}">
      <div class="row">
        <div>
          <h3>Pedido #${order.id}</h3>
          <p class="muted">${dateTime(order.createdAt)} - ${order.customer.name} - ${order.customer.phone}</p>
        </div>
        <strong class="price">${money(order.totals.total)}</strong>
      </div>
      <div>${order.items.map(item => `<p>${item.quantity}x ${item.name}</p>`).join("")}</div>
      <p><strong>Observação:</strong> ${order.note || "Sem observação"}</p>
      <p><strong>Entrega:</strong> ${formatAddress(order)}</p>
      <p><strong>Pagamento:</strong> ${formatPayment(order)} - ${paymentStatusLabel(order.paymentStatus)}</p>
      ${pixAwaiting ? `
        <div class="payment-confirm">
          <span>Pix recebido?</span>
          <button type="button" class="btn secondary" data-confirm-payment="${order.id}">Confirmar pagamento Pix</button>
        </div>
      ` : ""}
      <div class="actions">
        ${actions || '<span class="hint">Pedido finalizado.</span>'}
      </div>
    </article>
  `;
}

function orderActions(order) {
  const actions = [];
  if (order.status === "novo") {
    actions.push(`<button type="button" class="btn secondary" data-status="${order.id}:em_preparo">Aceitar pedido</button>`);
  }
  if (["novo", "em_preparo"].includes(order.status)) {
    actions.push(`<button type="button" class="btn" data-status="${order.id}:saiu_para_entrega">Saiu para entrega</button>`);
  }
  if (!["entregue", "cancelado"].includes(order.status)) {
    actions.push(`<button type="button" class="btn secondary" data-status="${order.id}:entregue">Marcar como entregue</button>`);
    actions.push(`<button type="button" class="btn danger" data-status="${order.id}:cancelado">Cancelar</button>`);
  }
  return actions.join("");
}

function dailyMenusAdmin() {
  const dailyProducts = state.products.filter(product => product.dayOfWeek || product.category === "Cardapio do dia");
  const groups = [["todos", "Todos os dias"], ...Object.entries(dayLabels)];
  return `
    <div class="section-title">
      <div>
        <h2>Cardápios do dia</h2>
        <p class="muted">Cadastre um prato por dia, coloque a quantidade disponível e exclua quando precisar.</p>
      </div>
    </div>
    ${dailyMenuQuickForm()}
    <div class="grid">
      ${groups.map(([day, label]) => {
        const products = day === "todos"
          ? dailyProducts.filter(product => !product.dayOfWeek)
          : dailyProducts.filter(product => product.dayOfWeek === day);
        return `
          <section class="day-section">
            <div class="row">
              <h3>${label}</h3>
              <span class="badge">${products.length} cardápio${products.length === 1 ? "" : "s"}</span>
            </div>
            <div class="grid product-grid">
              ${products.length ? products.map(dailyMenuCard).join("") : '<p class="muted">Nenhum cardápio cadastrado para este dia.</p>'}
            </div>
          </section>
        `;
      }).join("")}
    </div>
  `;
}

function dailyMenuQuickForm() {
  return `
    <form id="daily-menu-form" class="form-panel stack">
      <h3>Criar cardápio do dia</h3>
      <div class="two">
        <div class="field"><label>Nome do cardápio</label><input name="name" placeholder="Ex.: Frango grelhado" required></div>
        <div class="field"><label>Preço</label><input name="price" type="number" step="0.01" min="0" placeholder="Ex.: 25" required></div>
      </div>
      <div class="two">
        <div class="field">
          <label>Dia</label>
          <select name="dayOfWeek">
            <option value="">Todos os dias</option>
            ${Object.entries(dayLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label>Quantidade disponível</label>
          <input name="dailyStock" type="number" min="0" step="1" placeholder="Ex.: 40">
          <p class="hint">Use 0 ou deixe vazio para não limitar.</p>
        </div>
      </div>
      <div class="field"><label>Descrição</label><textarea name="description" placeholder="Ex.: arroz, feijão, salada e frango"></textarea></div>
      ${productImageFields({})}
      <div class="actions">
        <button type="button" class="btn secondary" data-save-daily-menu="1">Salvar cardápio do dia</button>
      </div>
    </form>
  `;
}

function dailyMenuCard(product) {
  const sold = soldToday(product.id);
  const stock = Number(product.dailyStock || 0);
  const remaining = remainingToday(product);
  const exhausted = stock > 0 && remaining <= 0;
  const image = product.image || "https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=900&q=80";
  return `
    <article class="product-card ${exhausted ? "sold-out" : ""}">
      <div class="product-image">
        <img src="${image}" alt="${product.name}">
      </div>
      <div class="product-body">
        <div class="badge-row">
          <span class="badge">${product.active ? "Ativo" : "Inativo"}</span>
          <span class="badge ${exhausted ? "danger" : ""}">${exhausted ? "Esgotado" : stock ? `Restam ${remaining}` : "Sem limite"}</span>
        </div>
        <div class="product-heading"><h3>${product.name}</h3><strong class="price">${money(product.price)}</strong></div>
        <p class="muted">${product.description}</p>
        <p class="hint">Quantidade do dia: ${stock || "sem limite"} | Vendido hoje: ${sold}</p>
        <div class="actions">
          <button type="button" class="btn ghost" data-edit-product="${product.id}">Editar</button>
          <button type="button" class="btn ghost" data-toggle-product="${product.id}">${product.active ? "Desativar" : "Ativar"}</button>
          <button type="button" class="btn danger" data-delete-product="${product.id}">Excluir</button>
        </div>
      </div>
    </article>
  `;
}

function productsAdmin() {
  const product = state.editingProduct || {};
  const categories = ["Cardapio do dia", "Marmitas", "Bebidas", "Sobremesas"];
  return `
    <div class="layout">
      <form id="product-form" class="form-panel stack">
        <h2>${product.id ? "Editar produto" : "Cadastrar produto"}</h2>
        <input type="hidden" name="id" value="${product.id || ""}">
        <div class="field"><label>Nome</label><input name="name" value="${product.name || ""}" required></div>
        <div class="two">
          <div class="field"><label>Categoria</label><select name="category">${categories.map(category => `<option value="${category}" ${product.category === category ? "selected" : ""}>${categoryLabel(category)}</option>`).join("")}</select></div>
          <div class="field"><label>Preço</label><input name="price" type="number" step="0.01" value="${product.price || ""}" required></div>
        </div>
        <div class="two">
          <div class="field">
            <label>Dia do cardápio</label>
            <select name="dayOfWeek">
              <option value="">Todos os dias</option>
              ${Object.entries(dayLabels).map(([value, label]) => `<option value="${value}" ${product.dayOfWeek === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Quantidade do dia</label>
            <input name="dailyStock" type="number" min="0" step="1" value="${product.dailyStock || ""}" placeholder="Ex.: 40">
            <p class="hint">Use 0 ou deixe vazio para não limitar.</p>
          </div>
        </div>
        ${productImageFields(product)}
        <div class="field"><label>Descrição</label><textarea name="description">${product.description || ""}</textarea></div>
        <div class="two">
          <label><input type="checkbox" name="active" ${product.active !== false ? "checked" : ""}> Produto ativo</label>
          <label><input type="checkbox" name="dishOfDay" ${product.dishOfDay ? "checked" : ""}> Prato do dia</label>
        </div>
        <div class="actions">
          <button type="button" class="btn secondary" data-save-product="1">Salvar produto</button>
          ${product.id ? '<button type="button" class="btn ghost" data-cancel-edit="1">Cancelar edição</button>' : ""}
        </div>
      </form>
      <div class="grid product-grid">
        <div class="section-title" style="grid-column:1/-1;margin:0">
          <div>
            <h2>Produtos cadastrados</h2>
            <p class="muted">${state.products.length} produto${state.products.length === 1 ? "" : "s"} no sistema.</p>
          </div>
        </div>
        ${state.products.map(product => `
          <article class="product-card">
            <div class="product-image">
              <img src="${product.image || "https://images.unsplash.com/photo-1543353071-10c8ba85a904?auto=format&fit=crop&w=900&q=80"}" alt="${product.name}">
            </div>
            <div class="product-body">
              <div class="badge-row">
                <span class="badge">${product.active ? "Ativo" : "Inativo"}${product.dishOfDay ? " - Prato do dia" : ""}</span>
                ${product.dayOfWeek ? `<span class="badge">${dayLabels[product.dayOfWeek] || product.dayOfWeek}</span>` : ""}
                ${Number(product.dailyStock || 0) > 0 ? `<span class="badge">Limite ${product.dailyStock} - vendido hoje ${soldToday(product.id)}</span>` : ""}
              </div>
              <div class="product-heading"><h3>${product.name}</h3><strong class="price">${money(product.price)}</strong></div>
              <p class="muted">${categoryLabel(product.category)}</p>
              <div class="actions">
                <button type="button" class="btn ghost" data-edit-product="${product.id}">Editar</button>
                <button type="button" class="btn ghost" data-toggle-product="${product.id}">${product.active ? "Desativar" : "Ativar"}</button>
                <button type="button" class="btn danger" data-delete-product="${product.id}">Excluir</button>
              </div>
            </div>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}

function productImageFields(product) {
  return `
    <div class="field">
      <label>Escolher foto da pasta</label>
      <select name="imageFromFolder">
        <option value="">Manter ou usar URL abaixo</option>
        ${state.uploads.map(file => `<option value="${file.url}" ${product.image === file.url ? "selected" : ""}>${file.name}</option>`).join("")}
      </select>
      <p class="hint">Fotos colocadas em public/uploads aparecem aqui.</p>
    </div>
    <div class="field">
      <label>Enviar nova foto</label>
      <input name="imageUpload" type="file" accept="image/*">
      <p class="hint">A foto enviada fica salva dentro da pasta public/uploads.</p>
    </div>
    <div class="field">
      <label>Foto URL</label>
      <input name="image" value="${product.image || ""}" placeholder="/uploads/foto.jpg ou link da internet">
    </div>
  `;
}

async function uploadProductImage(file) {
  const dataUrl = await readFileAsDataUrl(file);
  const response = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      dataUrl
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível enviar a foto.");
  return data.url;
}

function brandAdmin() {
  const logo = restaurantLogoUrl();
  return `
    <section class="form-panel brand-admin stack">
      <div class="section-title" style="margin:0">
        <div>
          <h2>Marca do restaurante</h2>
          <p class="muted">Logo usado no topo do site, no cardápio e na nota impressa pelo navegador.</p>
        </div>
      </div>
      ${logo ? "" : '<div class="notice error">Nenhum logo foi salvo ainda. Selecione a imagem do restaurante em "Enviar logo" e clique em "Salvar logo".</div>'}
      <div class="brand-admin-grid">
        <div class="brand-preview">
          ${logo ? `<img src="${logo}" alt="Logo Mari Mais Sabor">` : `<span class="hero-logo-fallback">MS</span>`}
        </div>
        <form id="brand-form" class="stack">
          <div class="field">
            <label>Enviar logo</label>
            <input name="logoUpload" type="file" accept="image/*">
            <p class="hint">Use a imagem quadrada do restaurante para melhor resultado.</p>
          </div>
          <div class="field">
            <label>Logo URL</label>
            <input name="logoUrl" value="${logo}" placeholder="/uploads/logo.jpg ou link da internet">
          </div>
          <div class="two">
            <div class="field">
              <label>Nome do Pix</label>
              <input name="pixName" value="${state.restaurant.pixName || ""}" placeholder="Nome do recebedor">
            </div>
            <div class="field">
              <label>Chave Pix</label>
              <input name="pixKey" value="${state.restaurant.pixKey || ""}" placeholder="CPF, telefone, e-mail ou chave aleatória">
            </div>
          </div>
          <div class="actions">
            <button type="button" class="btn secondary" data-save-brand="1">Salvar marca e Pix</button>
          </div>
        </form>
      </div>
    </section>
  `;
}

async function saveBrandForm(form, button = null) {
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }

  try {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const logoFile = formData.get("logoUpload");
    let logoUrl = String(formData.get("logoUrl") || "").trim();

    if (logoFile && logoFile.size > 0) {
      logoUrl = await uploadProductImage(logoFile);
    }

    await api("/api/restaurant", {
      method: "PATCH",
      body: JSON.stringify({
        logoUrl,
        pixName: data.pixName,
        pixKey: data.pixKey
      })
    });

    state.flashType = "success";
    state.flash = "Marca e Pix atualizados com sucesso.";
    await refresh();
    state.adminTab = "marca";
    renderAdmin();
  } catch (error) {
    state.flashType = "error";
    state.flash = `Erro ao salvar marca e Pix: ${error.message}`;
    renderAdmin();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function saveProductForm(form, button = null) {
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }

  try {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const imageFile = formData.get("imageUpload");
    let image = data.imageFromFolder || data.image;

    if (imageFile && imageFile.size > 0) {
      image = await uploadProductImage(imageFile);
    }

    const payload = {
      name: data.name,
      category: data.category,
      description: data.description,
      price: Number(data.price),
      image,
      active: Boolean(data.active),
      dishOfDay: Boolean(data.dishOfDay) || data.category === "Cardapio do dia",
      dayOfWeek: data.dayOfWeek,
      dailyStock: Number(data.dailyStock || 0)
    };

    if (data.id) await api(`/api/products/${data.id}`, { method: "PUT", body: JSON.stringify(payload) });
    else await api("/api/products", { method: "POST", body: JSON.stringify(payload) });

    state.editingProduct = null;
    state.adminTab = data.category === "Cardapio do dia" ? "cardapios" : "cardapio";
    state.flash = data.id ? "Produto atualizado com sucesso." : "Produto salvo com sucesso.";
    await refresh();
    renderAdmin();
  } catch (error) {
    state.flash = `Erro ao salvar produto: ${error.message}`;
    renderAdmin();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function saveDailyMenuForm(form, button = null) {
  const originalText = button ? button.textContent : "";
  if (button) {
    button.disabled = true;
    button.textContent = "Salvando...";
  }

  try {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const imageFile = formData.get("imageUpload");
    let image = data.imageFromFolder || data.image;

    if (imageFile && imageFile.size > 0) {
      image = await uploadProductImage(imageFile);
    }

    await api("/api/products", {
      method: "POST",
      body: JSON.stringify({
        name: data.name,
        category: "Cardapio do dia",
        description: data.description,
        price: Number(data.price),
        image,
        active: true,
        dishOfDay: true,
        dayOfWeek: data.dayOfWeek,
        dailyStock: Number(data.dailyStock || 0)
      })
    });

    state.adminTab = "cardapios";
    state.flashType = "success";
    state.flash = "Cardápio do dia salvo com sucesso.";
    form.reset();
    await refresh();
    renderAdmin();
  } catch (error) {
    state.flashType = "error";
    state.flash = `Erro ao salvar cardápio: ${error.message}`;
    renderAdmin();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function reportsAdmin() {
  const period = getReportPeriod(state.reportPeriod);
  const periodOrders = state.orders.filter(order => {
    const createdAt = new Date(order.createdAt);
    return createdAt >= period.start && createdAt <= period.end;
  });
  const sold = periodOrders.filter(order => order.status !== "cancelado");
  const total = sold.reduce((sum, order) => sum + order.totals.total, 0);
  const canceled = periodOrders.filter(order => order.status === "cancelado").length;
  const payments = countBy(sold, order => paymentMethodLabel(order.payment.method));
  const fulfillments = countBy(sold, order => order.fulfillment.type || "Entrega");
  const products = {};
  sold.forEach(order => order.items.forEach(item => {
    products[item.name] = (products[item.name] || 0) + item.quantity;
  }));
  const topProducts = Object.entries(products).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const ordersList = periodOrders.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return `
    <div class="section-title">
      <div>
        <h2>Relatórios</h2>
        <p class="muted">${period.label} - ${dateOnly(period.start)} até ${dateOnly(period.end)}</p>
      </div>
    </div>
    <div class="tabs">
      ${[
        ["today", "Hoje"],
        ["week", "Semana"],
        ["month", "Mês"],
        ["year", "Ano"]
      ].map(([value, label]) => `<button type="button" class="pill ${state.reportPeriod === value ? "active" : ""}" data-report-period="${value}">${label}</button>`).join("")}
    </div>
    <div class="stats">
      <div class="stat"><span>Total vendido</span><strong>${money(total)}</strong></div>
      <div class="stat"><span>Quantidade de pedidos</span><strong>${periodOrders.length}</strong></div>
      <div class="stat"><span>Pedidos cancelados</span><strong>${canceled}</strong></div>
      <div class="stat"><span>Ticket médio</span><strong>${money(sold.length ? total / sold.length : 0)}</strong></div>
    </div>
    <div class="two" style="margin-top:16px">
      <section class="form-panel">
        <h2>Produtos mais vendidos</h2>
        ${topProducts.length ? topProducts.map(([name, qty]) => `<p>${qty}x ${name}</p>`).join("") : '<p class="muted">Sem vendas no período.</p>'}
      </section>
      <section class="form-panel">
        <h2>Formas de pagamento</h2>
        ${Object.entries(payments).length ? Object.entries(payments).map(([name, qty]) => `<p>${name}: ${qty}</p>`).join("") : '<p class="muted">Sem pagamentos no período.</p>'}
      </section>
      <section class="form-panel">
        <h2>Entrega e retirada</h2>
        ${Object.entries(fulfillments).length ? Object.entries(fulfillments).map(([name, qty]) => `<p>${name}: ${qty}</p>`).join("") : '<p class="muted">Sem pedidos no período.</p>'}
      </section>
      <section class="form-panel">
        <h2>Pedidos do período</h2>
        ${ordersList.length ? ordersList.map(order => `<p>#${order.id} - ${dateTime(order.createdAt)} - ${order.customer.name} - ${money(order.totals.total)} - ${statusLabels[order.status]}</p>`).join("") : '<p class="muted">Nenhum pedido no período.</p>'}
      </section>
    </div>
  `;
}

function getReportPeriod(period) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (period === "week") {
    const day = start.getDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setDate(start.getDate() - diff);
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { label: "Semana atual", start, end };
  }

  if (period === "month") {
    start.setDate(1);
    end.setMonth(start.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
    return { label: "Mês atual", start, end };
  }

  if (period === "year") {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
    end.setHours(23, 59, 59, 999);
    return { label: "Ano atual", start, end };
  }

  return { label: "Hoje", start, end };
}

function dateOnly(value) {
  return new Date(value).toLocaleDateString("pt-BR");
}

function countBy(items, getter) {
  return items.reduce((acc, item) => {
    const key = getter(item);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function renderKitchen() {
  const orders = state.orders.filter(order => ["novo", "em_preparo"].includes(order.status));
  const updatedAt = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const newOrders = orders.filter(order => order.status === "novo").length;
  const preparingOrders = orders.filter(order => order.status === "em_preparo").length;

  app.innerHTML = shell(`
    <main class="page kitchen-page">
      <div class="section-title">
        <div>
          <h1>Monitor da cozinha</h1>
          <p class="muted">Pedidos abertos para preparo. Atualização automática a cada 6 segundos.</p>
        </div>
        <span class="readonly-badge">Somente visualização</span>
      </div>
      <div class="kitchen-summary">
        <div class="stat"><span>Pedidos abertos</span><strong>${orders.length}</strong></div>
        <div class="stat"><span>Novos</span><strong>${newOrders}</strong></div>
        <div class="stat"><span>Em preparo</span><strong>${preparingOrders}</strong></div>
        <div class="stat"><span>Atualizado às</span><strong>${updatedAt}</strong></div>
      </div>
      <div class="kitchen-grid">
        ${orders.length ? orders.map(kitchenOrderCard).join("") : `
          <div class="kitchen-empty">
            <h2>Nenhum pedido aberto</h2>
            <p class="muted">Assim que um cliente fizer um pedido, ele aparecerá aqui automaticamente.</p>
          </div>
        `}
      </div>
    </main>
    <div id="print-area" class="print-only"></div>
  `, "cozinha");

  orders.forEach(order => state.seenKitchenOrders.add(order.id));
  state.kitchenInitialized = true;
  state.lastSeenKitchenOrder = orders[0]?.id || state.lastSeenKitchenOrder;
}

function kitchenOrderCard(order) {
  return `
    <article class="kitchen-card status ${order.status}">
      <div class="kitchen-card-head">
        <div>
          <span class="badge">${statusLabels[order.status]}</span>
          <h2>#${order.id}</h2>
        </div>
        <strong>${dateTime(order.createdAt).split(" ").pop()}</strong>
      </div>
      <div class="kitchen-meta">
        <span>${order.fulfillment?.type || "Entrega"}</span>
        <span>${paymentStatusLabel(order.paymentStatus)}</span>
      </div>
      <div class="kitchen-items">
        ${order.items.map(item => `<p><strong>${item.quantity}x</strong><span>${item.name}</span></p>`).join("")}
      </div>
      <p class="kitchen-note"><strong>Observação:</strong> ${order.note || "Sem observação"}</p>
      <p class="muted"><strong>Cliente:</strong> ${order.customer.name} - ${order.customer.phone}</p>
      <p class="muted"><strong>Entrega:</strong> ${formatAddress(order)}</p>
    </article>
  `;
}

function renderStatus(id) {
  const order = state.orders.find(current => current.id === id);
  if (!order) {
    clearStatusRefresh();
    app.innerHTML = shell(`<main class="page"><h1>Pedido não encontrado</h1></main>`, "cardapio");
    return;
  }
  scheduleStatusRefresh(order);
  if (isPixAwaitingPayment(order)) {
    return renderPixPayment(order);
  }
  app.innerHTML = shell(`
    <main class="page">
      <section class="form-panel customer-status-card">
        <div class="row">
          <div>
            <span class="badge">${customerStatusLabels[order.status] || statusLabels[order.status]}</span>
            <h1>${customerStatusTitle(order)}</h1>
            <p class="muted">${customerStatusMessage(order)}</p>
            <p class="muted">Pedido #${order.id} - ${dateTime(order.createdAt)} - ${order.customer.name}</p>
            ${customerDeliveryEstimate(order)}
          </div>
          <strong class="price">${money(order.totals.total)}</strong>
        </div>
        ${customerStatusVisual(order)}
        ${customerPickupCode(order)}
        <div class="timeline">
          ${customerSteps.map(step => `
            <div class="step ${customerSteps.indexOf(order.status) >= customerSteps.indexOf(step) ? "done" : ""}">
              <span class="dot"></span>
              <strong>${customerStatusLabels[step]}</strong>
            </div>
          `).join("")}
        </div>
        <div class="actions">
          <a class="btn ghost" href="/cardapio">Novo pedido</a>
        </div>
      </section>
    </main>
  `, "cardapio");
  startCustomerEstimateClock(order);
}

function isPixAwaitingPayment(order) {
  return order.payment?.method === "Pix" && order.paymentStatus !== "pago";
}

function renderPixPayment(order) {
  clearCustomerClockOnly();
  const pixKey = String(state.restaurant.pixKey || "").trim();
  const payload = pixPayload(order);
  app.innerHTML = shell(`
    <main class="page">
      <section class="form-panel pix-payment-card">
        <div class="section-title" style="margin:0">
          <div>
            <span class="badge">Aguardando Pix</span>
            <h1>Finalize seu pagamento</h1>
            <p class="muted">Depois que o restaurante confirmar o Pix, a tela do andamento do pedido será liberada.</p>
          </div>
          <strong class="price">${money(order.totals.total)}</strong>
        </div>
        <div class="pix-payment-grid">
          <div class="pix-qr">
            <img src="${pixQrUrl(payload)}" alt="QR Code Pix">
          </div>
          <div class="stack">
            <div class="field">
              <label>Chave Pix</label>
              <div class="copy-row">
                <input readonly value="${pixKey}">
                <button type="button" class="btn ghost" data-copy-text="${pixKey}">Copiar</button>
              </div>
            </div>
            <div class="field">
              <label>Pix cópia e cola</label>
              <textarea readonly rows="5">${payload}</textarea>
              <button type="button" class="btn secondary" data-copy-text="${payload}">Copiar Pix cópia e cola</button>
            </div>
            <p class="muted">Pedido #${order.id} - ${dateTime(order.createdAt)} - ${order.customer.name}</p>
          </div>
        </div>
      </section>
    </main>
  `, "cardapio");
}

function customerStatusTitle(order) {
  if (order.status === "novo") return "Pedido recebido com sucesso!";
  if (order.status === "em_preparo") return "Sua comida está sendo preparada";
  if (order.status === "saiu_para_entrega") return "Seu pedido está a caminho";
  if (order.status === "entregue") return "Pedido entregue. Bom apetite!";
  if (order.status === "cancelado") return "Pedido cancelado";
  return `Pedido #${order.id}`;
}

function customerStatusMessage(order) {
  if (order.status === "novo") return "A cozinha já recebeu seu pedido e vai preparar tudo com carinho.";
  if (order.status === "em_preparo") return "Estamos caprichando nos detalhes. Acompanhe por aqui.";
  if (order.status === "saiu_para_entrega") return order.fulfillment.type === "Retirada"
    ? "Seu pedido já foi liberado para retirada."
    : "O pedido saiu da cozinha e está indo até você.";
  if (order.status === "entregue") return "Obrigado por pedir com a Mari Mais Sabor.";
  if (order.status === "cancelado") return "Entre em contato com o restaurante se precisar de ajuda.";
  return "Acompanhe o andamento do seu pedido por aqui.";
}

function customerDeliveryEstimate(order) {
  if (order.status === "entregue" || order.status === "cancelado") return "";
  const label = order.fulfillment.type === "Retirada" ? "Prazo estimado para retirada" : "Prazo estimado para entrega";
  const start = customerEstimateStart(order);
  if (!start) {
    return `
      <div class="delivery-estimate">
        <span>${label}</span>
        <strong>inicia após confirmar o Pix</strong>
      </div>
    `;
  }
  return `
    <div class="delivery-estimate" data-estimate-start="${start.toISOString()}">
      <span>${label}</span>
      <strong>${deliveryEstimateText}</strong>
      <em data-estimate-clock>00:00</em>
    </div>
  `;
}

function customerEstimateStart(order) {
  if (order.payment?.method === "Pix") {
    return order.paymentConfirmedAt ? new Date(order.paymentConfirmedAt) : null;
  }
  return new Date(order.createdAt);
}

function formatElapsed(value) {
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function updateCustomerEstimateClock() {
  const estimate = document.querySelector("[data-estimate-start]");
  if (!estimate) return;
  const clock = estimate.querySelector("[data-estimate-clock]");
  if (!clock) return;
  const start = new Date(estimate.dataset.estimateStart);
  clock.textContent = `Tempo: ${formatElapsed(Date.now() - start.getTime())}`;
}

function startCustomerEstimateClock(order) {
  if (state.statusRefresh.clockTimer) {
    clearInterval(state.statusRefresh.clockTimer);
    state.statusRefresh.clockTimer = null;
  }
  if (!customerEstimateStart(order) || order.status === "entregue" || order.status === "cancelado") return;
  updateCustomerEstimateClock();
  state.statusRefresh.clockTimer = setInterval(updateCustomerEstimateClock, 1000);
}

function clearCustomerClockOnly() {
  if (state.statusRefresh.clockTimer) {
    clearInterval(state.statusRefresh.clockTimer);
    state.statusRefresh.clockTimer = null;
  }
}

function orderPickupCode(order) {
  const digits = String(order.customer?.phone || "").replace(/\D/g, "");
  return digits.slice(-4).padStart(4, "0");
}

function customerPickupCode(order) {
  if (order.status !== "saiu_para_entrega") return "";
  const label = order.fulfillment.type === "Retirada" ? "Senha para retirada" : "Senha para receber o pedido";
  return `
    <div class="pickup-code">
      <span>${label}</span>
      <strong>${orderPickupCode(order)}</strong>
    </div>
  `;
}

function customerStatusVisual(order) {
  const active = order.status;
  const preparing = active === "em_preparo";
  return `
    <div class="status-visual status-${active} ${preparing ? "is-cooking" : ""}">
      <span class="mini-icon received ${customerSteps.indexOf(active) >= 0 ? "active" : ""} ${active === "novo" ? "current" : ""}"></span>
      <span class="status-line"></span>
      <span class="mini-icon cooking ${customerSteps.indexOf(active) >= 1 ? "active" : ""} ${active === "em_preparo" ? "current" : ""}">
        <span></span><span></span><span></span>
      </span>
      <span class="status-line"></span>
      <span class="mini-icon image-icon route ${customerSteps.indexOf(active) >= 2 ? "active" : ""} ${active === "saiu_para_entrega" ? "current" : ""}">
        <img src="/icons/delivery-moto.svg" alt="">
      </span>
      <span class="status-line"></span>
      <span class="mini-icon image-icon done ${customerSteps.indexOf(active) >= 3 ? "active" : ""} ${active === "entregue" ? "current" : ""}">
        <img src="/icons/order-delivered.svg" alt="">
      </span>
    </div>
  `;
}

function scheduleStatusRefresh(order) {
  if (order.status === "entregue" || order.status === "cancelado") {
    clearStatusRefresh();
    return;
  }

  if (state.statusRefresh.orderId !== order.id) {
    clearStatusRefresh();
    state.statusRefresh.orderId = order.id;
    state.statusRefresh.attempts = 0;
  }

  if (state.statusRefresh.timer) return;

  const delay = statusRefreshIntervals[state.statusRefresh.attempts] || 30000;
  state.statusRefresh.timer = setTimeout(async () => {
    state.statusRefresh.timer = null;
    state.statusRefresh.attempts += 1;
    await refresh();
    if (location.pathname === `/pedido/${order.id}`) {
      renderStatus(order.id);
    } else {
      clearStatusRefresh();
    }
  }, delay);
}

function clearStatusRefresh() {
  if (state.statusRefresh.timer) {
    clearTimeout(state.statusRefresh.timer);
  }
  if (state.statusRefresh.clockTimer) {
    clearInterval(state.statusRefresh.clockTimer);
  }
  state.statusRefresh = {
    orderId: null,
    attempts: 0,
    timer: null,
    clockTimer: null
  };
}

function formatAddress(order) {
  if (order.fulfillment.type === "Retirada") return "Retirada no restaurante";
  return `${order.fulfillment.address || ""}, ${order.fulfillment.number || ""} - ${order.fulfillment.neighborhood || ""} ${order.fulfillment.complement || ""}`.trim();
}

function receiptHeader() {
  return `${state.restaurant.name || "Mari Mais Sabor"}
Endereço: ${state.restaurant.address || "Rua Haiti 56 Rochdale-Osasco"}
Contato: ${state.restaurant.contact || "11952458505"}
CEP: ${state.restaurant.cep || "06220056"}
CNPJ: ${state.restaurant.cnpj || "46.749.934/0001-21"}`;
}

function receiptLogoHtml(logo) {
  return logo ? `<img class="receipt-logo" src="${logo}" alt="" onerror="this.hidden=true">` : "";
}

function restaurantHeaderHtml(logo) {
  return `
    <div class="receipt-header">
      ${receiptLogoHtml(logo)}
      <strong>${(state.restaurant.name || "Mari Mais Sabor").toUpperCase()}</strong>
      <span>Endereço: ${state.restaurant.address || "Rua Haiti 56 Rochdale-Osasco"}</span>
      <span>Contato: ${state.restaurant.contact || "11952458505"}</span>
      <span>CEP: ${state.restaurant.cep || "06220056"}</span>
      <span>CNPJ: ${state.restaurant.cnpj || "46.749.934/0001-21"}</span>
    </div>
  `;
}

function receiptLine(label, value) {
  return `<div class="receipt-line"><span>${label}</span><strong>${value}</strong></div>`;
}

function driverReceipt(order, logo) {
  return `
    <div class="receipt receipt-driver">
      ${restaurantHeaderHtml(logo)}
      <div class="receipt-title">NOTA DO ENTREGADOR</div>

      <section class="receipt-section">
        <h3>Cliente</h3>
        <p><strong>Nome:</strong> ${order.customer.name}</p>
        <p><strong>Telefone:</strong> ${order.customer.phone}</p>
      </section>

      <section class="receipt-section">
        <h3>Entrega</h3>
        <p>${formatAddress(order)}</p>
      </section>

      <section class="receipt-section">
        <h3>Itens do pedido</h3>
        <table class="receipt-table">
          <thead>
            <tr><th>Qtd</th><th>Item</th><th>Total</th></tr>
          </thead>
          <tbody>
            ${order.items.map(item => `
              <tr>
                <td>${item.quantity}</td>
                <td>${item.name}</td>
                <td>${money(item.price * item.quantity)}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </section>

      <section class="receipt-section">
        ${receiptLine("Itens do pedido", money(order.totals.subtotal))}
        ${receiptLine("Taxa de entrega", money(order.totals.deliveryFee))}
        ${receiptLine("Subtotal", money(order.totals.total))}
      </section>

      <section class="receipt-section">
        <h3>Pagamento</h3>
        <p>${formatPayment(order)}</p>
        <p class="receipt-total">Total: ${money(order.totals.total)}</p>
      </section>

      <section class="receipt-section">
        <h3>Observação</h3>
        <p>${order.note || "Sem observação"}</p>
        <p><strong>Cliente:</strong> ${order.customer.name}</p>
        <p><strong>Telefone:</strong> ${order.customer.phone}</p>
        <p><strong>Endereço:</strong> ${formatAddress(order)}</p>
      </section>

      <footer class="receipt-footer">
        Pedido #${order.id}<br>
        ${dateTime(order.createdAt)}
      </footer>
    </div>
  `;
}

function kitchenReceipt(order, logo) {
  return `
    <div class="receipt receipt-kitchen">
      ${restaurantHeaderHtml(logo)}
      <div class="receipt-title">COMANDA COZINHA</div>
      <div class="kitchen-order-number">Pedido: #${order.id}</div>
      <div class="receipt-center">${dateTime(order.createdAt)}</div>

      <section class="receipt-section">
        <h3>Itens</h3>
        ${order.items.map(item => `
          <div class="kitchen-item">
            <strong>${item.quantity}x</strong>
            <span>${item.name}</span>
          </div>
        `).join("")}
      </section>

      <section class="receipt-section">
        <h3>Observação</h3>
        <p>${order.note || "Sem observação"}</p>
      </section>

      <section class="receipt-section">
        <h3>Tipo</h3>
        <p>${order.fulfillment.type || "Entrega"}</p>
      </section>
    </div>
  `;
}

async function printOrder(id, type = "kitchen") {
  const order = state.orders.find(current => current.id === id);
  if (!order) return;
  const logo = restaurantLogoUrl();
  const receipt = type === "driver"
    ? driverReceipt(order, logo)
    : type === "both"
      ? kitchenReceipt(order, logo)
      : kitchenReceipt(order, logo);
  document.querySelector("#print-area").innerHTML = receipt;

  if (state.restaurant.printerName) {
    try {
      await api(`/api/orders/${id}/print?type=${type}`, { method: "POST" });
      order.printedAt = new Date().toISOString();
      order.printError = "";
      return;
    } catch (error) {
      alert(`Não foi possível imprimir direto na ${state.restaurant.printerName}. Vou abrir a janela de impressão. Detalhe: ${error.message}`);
    }
  }
  const receiptLogo = document.querySelector(".receipt-logo");
  if (receiptLogo && !receiptLogo.complete) {
    await new Promise(resolve => {
      receiptLogo.onload = resolve;
      receiptLogo.onerror = resolve;
      setTimeout(resolve, 1000);
    });
  }
  window.print();
}

function formatPayment(order) {
  if (order.payment.method === "Dinheiro na entrega") {
    return `Dinheiro na entrega${order.payment.changeFor ? ` - troco para ${order.payment.changeFor}` : " - levar troco"}`;
  }
  if (order.payment.method === "Cartao na entrega" || order.payment.method === "Cartão na entrega") {
    return "Cartão na entrega - levar maquininha";
  }
  return order.payment.pixProof ? `Pix - comprovante: ${order.payment.pixProof}` : "Pix";
}

function updatePaymentFields(form) {
  const method = form.payment.value;
  form.querySelector("[data-pix-field]").hidden = method !== "Pix";
  form.querySelector("[data-cash-field]").hidden = method !== "Dinheiro na entrega";
  form.querySelector("[data-card-field]").hidden = method !== "Cartao na entrega";
}

function beep() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.start();
  setTimeout(() => {
    oscillator.stop();
    ctx.close();
  }, 250);
}

function unlockKitchenAudio() {
  state.kitchenAudioUnlocked = true;
  if ("speechSynthesis" in window) {
    window.speechSynthesis.getVoices();
  }
}

function kitchenVoice() {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  return voices.find(voice => voice.lang === "pt-BR")
    || voices.find(voice => voice.lang?.startsWith("pt"))
    || null;
}

function announceKitchenOrder(order) {
  beep();
  setTimeout(() => speakNewOrder(order), 180);
}

function speakNewOrder(order) {
  if (!state.kitchenVoice || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const customer = String(order.customer?.name || "").trim();
  const items = (order.items || [])
    .map(item => {
      const quantity = Number(item.quantity || 1);
      const name = String(item.name || "item sem nome").trim();
      return `${quantity} ${quantity === 1 ? "unidade" : "unidades"} de ${name}`;
    })
    .join(", ");
  const orderId = order.id ? `Pedido número ${order.id}. ` : "";
  const text = customer
    ? `Olha o pedido novo do cliente ${customer}. ${orderId}Itens do pedido: ${items || "sem itens informados"}`
    : `Olha o pedido novo do cliente. ${orderId}Itens do pedido: ${items || "sem itens informados"}`;
  const message = new SpeechSynthesisUtterance(text);
  message.lang = "pt-BR";
  const voice = kitchenVoice();
  if (voice) message.voice = voice;
  message.rate = 0.95;
  message.pitch = 1;
  message.volume = 1;
  window.speechSynthesis.speak(message);
}

document.addEventListener("click", async event => {
  const target = event.target.closest("button, a");
  if (!target) return;
  unlockKitchenAudio();

  if (target.dataset.add) addToCart(target.dataset.add);
  if (target.dataset.inc) {
    const product = state.products.find(current => current.id === target.dataset.inc);
    const item = state.cart.find(current => current.productId === target.dataset.inc);
    const remaining = product ? remainingToday(product) : 0;
    if (!product || !isProductForToday(product) || isSoldOut(product) || (Number.isFinite(remaining) && item.quantity >= remaining)) {
      alert("Limite disponível deste cardápio já está no carrinho.");
      return;
    }
    item.quantity += 1;
    saveCart();
    renderMenu();
  }
  if (target.dataset.dec) {
    const item = state.cart.find(current => current.productId === target.dataset.dec);
    item.quantity -= 1;
    state.cart = state.cart.filter(current => current.quantity > 0);
    saveCart();
    renderMenu();
  }
  if (target.dataset.remove) {
    state.cart = state.cart.filter(item => item.productId !== target.dataset.remove);
    saveCart();
    renderMenu();
  }
  if (target.dataset.adminTab) {
    state.flash = "";
    state.flashType = "success";
    state.adminTab = target.dataset.adminTab;
    renderAdmin();
  }
  if (target.dataset.orderTab) {
    state.orderTab = target.dataset.orderTab;
    renderAdmin();
  }
  if (target.dataset.reportPeriod) {
    state.reportPeriod = target.dataset.reportPeriod;
    renderAdmin();
  }
  if (target.dataset.autoPrint) {
    state.autoPrintKitchen = !state.autoPrintKitchen;
    saveAutoPrintKitchen();
    state.orders
      .filter(order => ["novo", "em_preparo"].includes(order.status))
      .forEach(order => state.seenKitchenOrders.add(order.id));
    state.kitchenInitialized = true;
    renderKitchen();
  }
  if (target.dataset.kitchenVoice) {
    state.kitchenVoice = !state.kitchenVoice;
    saveKitchenVoice();
    if (!state.kitchenVoice && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    renderKitchen();
  }
  if (target.dataset.testKitchenVoice) {
    state.kitchenVoice = true;
    saveKitchenVoice();
    announceKitchenOrder({
      id: "teste",
      customer: { name: "cliente teste" },
      items: [{ quantity: 1, name: "Quarta - Cardápio do chefe" }]
    });
    renderKitchen();
  }
  if (target.dataset.status) {
    const [id, status] = target.dataset.status.split(":");
    await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refresh();
    if (status === "saiu_para_entrega") {
      route();
      return;
    }
    route();
  }
  if (target.dataset.confirmPayment) {
    await api(`/api/orders/${target.dataset.confirmPayment}`, {
      method: "PATCH",
      body: JSON.stringify({ confirmPayment: true })
    });
    await refresh();
    route();
  }
  if (target.dataset.copyText) {
    const text = target.dataset.copyText;
    try {
      await navigator.clipboard.writeText(text);
      target.textContent = "Copiado";
      setTimeout(() => {
        target.textContent = target.dataset.copyText.length > 30 ? "Copiar Pix cópia e cola" : "Copiar";
      }, 1200);
    } catch {
      const input = target.closest(".field")?.querySelector("input, textarea");
      if (input) {
        input.focus();
        input.select();
        document.execCommand("copy");
      }
    }
  }
  if (target.dataset.editProduct) {
    state.editingProduct = state.products.find(product => product.id === target.dataset.editProduct);
    state.adminTab = "cardapio";
    renderAdmin();
  }
  if (target.dataset.newDailyMenu) {
    state.editingProduct = {
      category: "Cardapio do dia",
      active: true,
      dishOfDay: true,
      dayOfWeek: todayWeekdayKey() === "domingo" ? "segunda" : todayWeekdayKey(),
      dailyStock: 40
    };
    state.adminTab = "cardapio";
    renderAdmin();
  }
  if (target.dataset.cancelEdit) {
    state.editingProduct = null;
    renderAdmin();
  }
  if (target.dataset.toggleProduct) {
    const product = state.products.find(current => current.id === target.dataset.toggleProduct);
    await api(`/api/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ active: !product.active }) });
    await refresh();
    renderAdmin();
  }
  if (target.dataset.deleteProduct && confirm("Excluir este produto?")) {
    await api(`/api/products/${target.dataset.deleteProduct}`, { method: "DELETE" });
    await refresh();
    renderAdmin();
  }
  if (target.dataset.refresh) {
    await refresh();
    route();
  }
  if (target.dataset.saveProduct) {
    const form = target.closest("#product-form");
    if (form) await saveProductForm(form, target);
  }
  if (target.dataset.saveBrand) {
    const form = target.closest("#brand-form");
    if (form) await saveBrandForm(form, target);
  }
  if (target.dataset.saveDailyMenu) {
    const form = target.closest("#daily-menu-form");
    if (form) await saveDailyMenuForm(form, target);
  }
});

document.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id === "checkout") {
    try {
      await submitOrder(event.target);
    } catch (error) {
      alert(error.message);
      await refresh();
      renderMenu();
    }
  }
  if (event.target.id === "product-form") {
    await saveProductForm(event.target);
  }
  if (event.target.id === "brand-form") {
    const button = event.target.querySelector("[data-save-brand]");
    await saveBrandForm(event.target, button);
  }
  if (event.target.id === "daily-menu-form") {
    const button = event.target.querySelector("[data-save-daily-menu]");
    await saveDailyMenuForm(event.target, button);
  }
});

document.addEventListener("change", event => {
  if (event.target.name === "payment" && event.target.closest("#checkout")) {
    updatePaymentFields(event.target.closest("#checkout"));
  }
  if (event.target.name === "imageFromFolder" && event.target.closest("#product-form")) {
    const form = event.target.closest("#product-form");
    if (event.target.value) form.image.value = event.target.value;
  }
  if (event.target.name === "imageFromFolder" && event.target.closest("#daily-menu-form")) {
    const form = event.target.closest("#daily-menu-form");
    if (event.target.value) form.image.value = event.target.value;
  }
});

window.addEventListener("popstate", route);

setInterval(async () => {
  if (!location.pathname.startsWith("/cozinha")) return;
  await refresh();
  renderKitchen();
}, 6000);

refresh().then(route).catch(error => {
  app.innerHTML = `<main class="page"><h1>Erro ao carregar</h1><p>${error.message}</p></main>`;
});
