const app = document.querySelector("#app");
const CART_KEY = "mari_mais_sabor_cart";

const statusLabels = {
  novo: "Novo",
  em_preparo: "Em preparo",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado"
};

const customerSteps = ["novo", "em_preparo", "saiu_para_entrega", "entregue"];
const statusRefreshIntervals = [300000, 180000, 120000, 60000];

const dayLabels = {
  segunda: "Segunda",
  terca: "Terca",
  quarta: "Quarta",
  quinta: "Quinta",
  sexta: "Sexta",
  sabado: "Sabado"
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
  lastSeenKitchenOrder: null,
  statusRefresh: {
    orderId: null,
    attempts: 0,
    timer: null
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

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

function route() {
  const path = window.location.pathname;
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
  return `
    <div class="shell">
      <header class="topbar">
        <a class="brand" href="/cardapio">
          <span class="brand-mark">MS</span>
          <span>Mari Mais Sabor</span>
        </a>
        <nav class="nav">
          <a class="${active === "cardapio" ? "active" : ""}" href="/cardapio">Cardapio</a>
          <a class="${active === "admin" ? "active" : ""}" href="/admin">Administracao</a>
          <a class="${active === "cozinha" ? "active" : ""}" href="/cozinha">Cozinha</a>
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
      <div>
        <h1>Mari Mais Sabor</h1>
        <p>Cardapio digital do dia com marmitas, bebidas e sobremesas.</p>
      </div>
    </section>
  `;

  const products = categories.map(category => `
    <section>
      <div class="section-title">
        <h2>${category}</h2>
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
          ${product.dayOfWeek ? `<span class="badge">Cardapio de ${dayLabels[product.dayOfWeek] || product.dayOfWeek}</span>` : ""}
          ${Number(product.dailyStock || 0) > 0 ? `<span class="badge ${soldOut ? "danger" : ""}">${soldOut ? "Esgotado" : `Restam ${remaining}`}</span>` : ""}
        </div>
        <div class="product-heading">
          <h3>${product.name}</h3>
          <strong class="price">${money(product.price)}</strong>
        </div>
        <p class="muted">${product.description}</p>
        <button class="btn product-action" data-add="${product.id}" ${soldOut ? "disabled" : ""}>${soldOut ? "Cardapio esgotado" : "Adicionar"}</button>
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
    : '<p class="muted">Seu carrinho esta vazio.</p>';

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
            <option>Pix</option>
            <option>Dinheiro na entrega</option>
            <option>Cartao na entrega</option>
          </select>
        </div>
      </div>
      <div class="field"><label>Endereco</label><input name="address"></div>
      <div class="two">
        <div class="field"><label>Numero</label><input name="number"></div>
        <div class="field"><label>Bairro</label><input name="neighborhood"></div>
      </div>
      <div class="field"><label>Complemento</label><input name="complement"></div>
      <div class="field" data-pix-field>
        <label>Comprovante Pix</label>
        <input name="pixProof" placeholder="Opcional">
        <p class="hint">Pedido fica aguardando pagamento ate o Pix ser confirmado.</p>
      </div>
      <div class="field" data-cash-field hidden>
        <label>Troco para quanto</label>
        <input name="changeFor" placeholder="Ex.: R$ 50,00">
        <p class="hint">O motoboy leva o troco informado para o cliente.</p>
      </div>
      <div class="field" data-card-field hidden>
        <label>Cartao na entrega</label>
        <p class="hint">O motoboy leva a maquininha de cartao no momento da entrega.</p>
      </div>
      <div class="field"><label>Observacao do pedido</label><textarea name="note" placeholder="Ex.: sem cebola"></textarea></div>
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
    alert("Cardapio esgotado ou indisponivel para hoje.");
    return;
  }
  const item = state.cart.find(current => current.productId === productId);
  const remaining = remainingToday(product);
  if (item && Number.isFinite(remaining) && item.quantity >= remaining) {
    alert("Limite disponivel deste cardapio ja esta no carrinho.");
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
  const link = whatsappLink(order);
  window.open(link, "_blank", "noopener,noreferrer");
  history.pushState({}, "", `/pedido/${order.id}`);
  renderStatus(order.id, link);
}

function whatsappLink(order) {
  const phone = String(state.restaurant.whatsapp || "").replace(/\D/g, "");
  return `https://wa.me/${phone}?text=${encodeURIComponent(orderMessage(order))}`;
}

function orderMessage(order) {
  const items = order.items.map(item => `${item.quantity}x ${item.name} - ${money(item.price * item.quantity)}`).join("\n");
  const address = order.fulfillment.type === "Retirada"
    ? "Retirada no restaurante"
    : `${order.fulfillment.address || ""}, ${order.fulfillment.number || ""} - ${order.fulfillment.neighborhood || ""} ${order.fulfillment.complement || ""}`.trim();
  return `NOVO PEDIDO - MARI MAIS SABOR

Pedido: #${order.id}
Cliente: ${order.customer.name}
Telefone: ${order.customer.phone}

Itens:
${items}

Observacao:
${order.note || "Sem observacao"}

Entrega:
${address}

Pagamento:
${formatPayment(order)}

Total:
${money(order.totals.total)}`;
}

function renderAdmin() {
  app.innerHTML = shell(`
    <main class="page">
      <div class="section-title">
        <div>
          <h1>Painel administrativo</h1>
          <p class="muted">Produtos, pedidos, impressao e relatorios.</p>
        </div>
      </div>
      ${state.flash ? `<div class="notice ${state.flashType === "error" ? "error" : ""}">${state.flash}</div>` : ""}
      <div class="tabs">
        ${["pedidos", "cardapios", "cardapio", "relatorios"].map(tab => `<button type="button" class="pill ${state.adminTab === tab ? "active" : ""}" data-admin-tab="${tab}">${tabLabel(tab)}</button>`).join("")}
      </div>
      ${state.adminTab === "pedidos" ? ordersAdmin() : ""}
      ${state.adminTab === "cardapios" ? dailyMenusAdmin() : ""}
      ${state.adminTab === "cardapio" ? productsAdmin() : ""}
      ${state.adminTab === "relatorios" ? reportsAdmin() : ""}
    </main>
    <div id="print-area" class="print-only"></div>
  `, "admin");
}

function tabLabel(tab) {
  return { pedidos: "Pedidos", cardapios: "Cardapios do dia", cardapio: "Produtos", relatorios: "Relatorios" }[tab] || tab;
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
      <p><strong>Observacao:</strong> ${order.note || "Sem observacao"}</p>
      <p><strong>Entrega:</strong> ${formatAddress(order)}</p>
      <p><strong>Pagamento:</strong> ${formatPayment(order)} - ${order.paymentStatus}</p>
      <div class="actions">
        ${order.status === "novo" ? `<button type="button" class="btn secondary" data-status="${order.id}:em_preparo">Aceitar pedido</button>` : ""}
        <button type="button" class="btn ghost" data-print="${order.id}">Imprimir</button>
        <button type="button" class="btn" data-status="${order.id}:em_preparo">Em preparo</button>
        <button type="button" class="btn" data-status="${order.id}:saiu_para_entrega">Saiu para entrega</button>
        <button type="button" class="btn secondary" data-status="${order.id}:entregue">Entregue</button>
        <button type="button" class="btn danger" data-status="${order.id}:cancelado">Cancelar</button>
      </div>
    </article>
  `;
}

function dailyMenusAdmin() {
  const dailyProducts = state.products.filter(product => product.dayOfWeek || product.category === "Cardapio do dia");
  const groups = [["todos", "Todos os dias"], ...Object.entries(dayLabels)];
  return `
    <div class="section-title">
      <div>
        <h2>Cardapios do dia</h2>
        <p class="muted">Cadastre um prato por dia, coloque a quantidade disponivel e exclua quando precisar.</p>
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
              <span class="badge">${products.length} cardapio${products.length === 1 ? "" : "s"}</span>
            </div>
            <div class="grid product-grid">
              ${products.length ? products.map(dailyMenuCard).join("") : '<p class="muted">Nenhum cardapio cadastrado para este dia.</p>'}
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
      <h3>Criar cardapio do dia</h3>
      <div class="two">
        <div class="field"><label>Nome do cardapio</label><input name="name" placeholder="Ex.: Frango grelhado" required></div>
        <div class="field"><label>Preco</label><input name="price" type="number" step="0.01" min="0" placeholder="Ex.: 25" required></div>
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
          <label>Quantidade disponivel</label>
          <input name="dailyStock" type="number" min="0" step="1" placeholder="Ex.: 40">
          <p class="hint">Use 0 ou deixe vazio para nao limitar.</p>
        </div>
      </div>
      <div class="field"><label>Descricao</label><textarea name="description" placeholder="Ex.: arroz, feijao, salada e frango"></textarea></div>
      ${productImageFields({})}
      <div class="actions">
        <button type="submit" class="btn secondary" data-save-daily-menu="1">Salvar cardapio do dia</button>
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
          <div class="field"><label>Categoria</label><select name="category">${categories.map(category => `<option ${product.category === category ? "selected" : ""}>${category}</option>`).join("")}</select></div>
          <div class="field"><label>Preco</label><input name="price" type="number" step="0.01" value="${product.price || ""}" required></div>
        </div>
        <div class="two">
          <div class="field">
            <label>Dia do cardapio</label>
            <select name="dayOfWeek">
              <option value="">Todos os dias</option>
              ${Object.entries(dayLabels).map(([value, label]) => `<option value="${value}" ${product.dayOfWeek === value ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
          <div class="field">
            <label>Quantidade do dia</label>
            <input name="dailyStock" type="number" min="0" step="1" value="${product.dailyStock || ""}" placeholder="Ex.: 40">
            <p class="hint">Use 0 ou deixe vazio para nao limitar.</p>
          </div>
        </div>
        ${productImageFields(product)}
        <div class="field"><label>Descricao</label><textarea name="description">${product.description || ""}</textarea></div>
        <div class="two">
          <label><input type="checkbox" name="active" ${product.active !== false ? "checked" : ""}> Produto ativo</label>
          <label><input type="checkbox" name="dishOfDay" ${product.dishOfDay ? "checked" : ""}> Prato do dia</label>
        </div>
        <div class="actions">
          <button type="button" class="btn secondary" data-save-product="1">Salvar produto</button>
          ${product.id ? '<button type="button" class="btn ghost" data-cancel-edit="1">Cancelar edicao</button>' : ""}
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
              <p class="muted">${product.category}</p>
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
      <input name="imageUpload" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
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
  if (!response.ok) throw new Error(data.error || "Nao foi possivel enviar a foto.");
  return data.url;
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
    state.flash = "Cardapio do dia salvo com sucesso.";
    form.reset();
    await refresh();
    renderAdmin();
  } catch (error) {
    state.flashType = "error";
    state.flash = `Erro ao salvar cardapio: ${error.message}`;
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
    reader.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
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
  const payments = countBy(sold, order => order.payment.method);
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
        <h2>Relatorios</h2>
        <p class="muted">${period.label} - ${dateOnly(period.start)} ate ${dateOnly(period.end)}</p>
      </div>
    </div>
    <div class="tabs">
      ${[
        ["today", "Hoje"],
        ["week", "Semana"],
        ["month", "Mes"],
        ["year", "Ano"]
      ].map(([value, label]) => `<button type="button" class="pill ${state.reportPeriod === value ? "active" : ""}" data-report-period="${value}">${label}</button>`).join("")}
    </div>
    <div class="stats">
      <div class="stat"><span>Total vendido</span><strong>${money(total)}</strong></div>
      <div class="stat"><span>Quantidade de pedidos</span><strong>${periodOrders.length}</strong></div>
      <div class="stat"><span>Pedidos cancelados</span><strong>${canceled}</strong></div>
      <div class="stat"><span>Ticket medio</span><strong>${money(sold.length ? total / sold.length : 0)}</strong></div>
    </div>
    <div class="two" style="margin-top:16px">
      <section class="form-panel">
        <h2>Produtos mais vendidos</h2>
        ${topProducts.length ? topProducts.map(([name, qty]) => `<p>${qty}x ${name}</p>`).join("") : '<p class="muted">Sem vendas no periodo.</p>'}
      </section>
      <section class="form-panel">
        <h2>Formas de pagamento</h2>
        ${Object.entries(payments).length ? Object.entries(payments).map(([name, qty]) => `<p>${name}: ${qty}</p>`).join("") : '<p class="muted">Sem pagamentos no periodo.</p>'}
      </section>
      <section class="form-panel">
        <h2>Entrega e retirada</h2>
        ${Object.entries(fulfillments).length ? Object.entries(fulfillments).map(([name, qty]) => `<p>${name}: ${qty}</p>`).join("") : '<p class="muted">Sem pedidos no periodo.</p>'}
      </section>
      <section class="form-panel">
        <h2>Pedidos do periodo</h2>
        ${ordersList.length ? ordersList.map(order => `<p>#${order.id} - ${dateTime(order.createdAt)} - ${order.customer.name} - ${money(order.totals.total)} - ${statusLabels[order.status]}</p>`).join("") : '<p class="muted">Nenhum pedido no periodo.</p>'}
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
    return { label: "Mes atual", start, end };
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
  const newest = orders[0]?.id;
  if (newest && state.lastSeenKitchenOrder && newest !== state.lastSeenKitchenOrder) beep();
  state.lastSeenKitchenOrder = newest || state.lastSeenKitchenOrder;

  app.innerHTML = shell(`
    <main class="page">
      <div class="section-title">
        <div>
          <h1>Painel da cozinha</h1>
          <p class="muted">Pedidos novos e em preparo.</p>
        </div>
        <button class="btn ghost" data-refresh="1">Atualizar</button>
      </div>
      <div class="kitchen-grid">
        ${orders.length ? orders.map(order => `
          <article class="kitchen-card">
            <div class="row">
              <h2>#${order.id}</h2>
              <strong>${dateTime(order.createdAt).split(" ").pop()}</strong>
            </div>
            <p><strong>${order.customer.name}</strong></p>
            ${order.items.map(item => `<p>${item.quantity}x ${item.name}</p>`).join("")}
            <p><strong>Obs.:</strong> ${order.note || "Sem observacao"}</p>
            <div class="actions">
              <button class="btn ghost" data-print="${order.id}">Imprimir</button>
              <button class="btn secondary" data-status="${order.id}:em_preparo">Em preparo</button>
              <button class="btn" data-status="${order.id}:saiu_para_entrega">Saiu para entrega</button>
            </div>
          </article>
        `).join("") : '<p class="muted">Nenhum pedido aberto.</p>'}
      </div>
    </main>
    <div id="print-area" class="print-only"></div>
  `, "cozinha");
}

function renderStatus(id, whatsapp = "") {
  const order = state.orders.find(current => current.id === id);
  if (!order) {
    clearStatusRefresh();
    app.innerHTML = shell(`<main class="page"><h1>Pedido nao encontrado</h1></main>`, "cardapio");
    return;
  }
  scheduleStatusRefresh(order);
  app.innerHTML = shell(`
    <main class="page">
      <section class="form-panel">
        <div class="row">
          <div>
            <h1>Pedido #${order.id}</h1>
            <p class="muted">${dateTime(order.createdAt)} - ${order.customer.name}</p>
          </div>
          <strong class="price">${money(order.totals.total)}</strong>
        </div>
        <div class="timeline">
          ${customerSteps.map(step => `
            <div class="step ${customerSteps.indexOf(order.status) >= customerSteps.indexOf(step) ? "done" : ""}">
              <span class="dot"></span>
              <strong>${statusLabels[step]}</strong>
            </div>
          `).join("")}
        </div>
        <div class="actions">
          ${whatsapp ? `<a class="btn secondary" href="${whatsapp}" target="_blank" rel="noreferrer">Enviar para WhatsApp</a>` : ""}
          <a class="btn ghost" href="/cardapio">Novo pedido</a>
        </div>
      </section>
    </main>
  `, "cardapio");
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
  state.statusRefresh = {
    orderId: null,
    attempts: 0,
    timer: null
  };
}

function formatAddress(order) {
  if (order.fulfillment.type === "Retirada") return "Retirada no restaurante";
  return `${order.fulfillment.address || ""}, ${order.fulfillment.number || ""} - ${order.fulfillment.neighborhood || ""} ${order.fulfillment.complement || ""}`.trim();
}

function printOrder(id) {
  const order = state.orders.find(current => current.id === id);
  if (!order) return;
  document.querySelector("#print-area").innerHTML = `
    <pre>
PEDIDO #${order.id}
MARI MAIS SABOR

Cliente: ${order.customer.name}
Telefone: ${order.customer.phone}
Horario: ${dateTime(order.createdAt)}

Itens:
${order.items.map(item => `${item.quantity}x ${item.name}`).join("\n")}

Observacao:
${order.note || "Sem observacao"}

Endereco:
${formatAddress(order)}

Pagamento:
${formatPayment(order)}

Total:
${money(order.totals.total)}
    </pre>
  `;
  window.print();
}

function formatPayment(order) {
  if (order.payment.method === "Dinheiro na entrega") {
    return `Dinheiro na entrega${order.payment.changeFor ? ` - troco para ${order.payment.changeFor}` : " - levar troco"}`;
  }
  if (order.payment.method === "Cartao na entrega") {
    return "Cartao na entrega - levar maquininha";
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

document.addEventListener("click", async event => {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.dataset.add) addToCart(target.dataset.add);
  if (target.dataset.inc) {
    const product = state.products.find(current => current.id === target.dataset.inc);
    const item = state.cart.find(current => current.productId === target.dataset.inc);
    const remaining = product ? remainingToday(product) : 0;
    if (!product || !isProductForToday(product) || isSoldOut(product) || (Number.isFinite(remaining) && item.quantity >= remaining)) {
      alert("Limite disponivel deste cardapio ja esta no carrinho.");
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
  if (target.dataset.status) {
    const [id, status] = target.dataset.status.split(":");
    await api(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    await refresh();
    route();
  }
  if (target.dataset.print) printOrder(target.dataset.print);
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
