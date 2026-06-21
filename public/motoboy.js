const app = document.querySelector("#motoboy-app");
const SESSION_KEY = "mari_motoboy_session";
const PHONE_KEY = "mari_motoboy_phone";
const pathParts = window.location.pathname.split("/").filter(Boolean);
const requestedDelivery = pathParts[0] === "motoboy" && pathParts[1] ? decodeURIComponent(pathParts[1]) : "";

let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let confirmingDelivery = "";
let installPrompt = null;
let loading = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  return fetch(path, { ...options, headers }).then(async response => {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== "/api/motoboy/login") {
      logout("Sua sessão expirou. Entre novamente.");
      throw new Error(data.error || "Sessão expirada.");
    }
    if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
    return data;
  });
}

function driverHeader() {
  return `
    <header class="driver-header">
      <div class="driver-brand">
        <img src="/icons/delivery-moto.svg" alt="">
        <div><strong>Mari Mais Sabor</strong><span>Área do entregador</span></div>
      </div>
      <div class="header-actions">
        <button class="icon-button" type="button" data-install ${installPrompt ? "" : "hidden"}>Instalar</button>
        <button class="icon-button" type="button" data-logout title="Sair" aria-label="Sair">Sair</button>
      </div>
    </header>
  `;
}

function driverShell(content) {
  return `<div class="driver-shell">${driverHeader()}<main class="driver-page">${content}</main></div>`;
}

function renderLogin(message = "") {
  const savedPhone = localStorage.getItem(PHONE_KEY) || "";
  app.innerHTML = `
    <main class="login-wrap">
      <section class="login-card">
        <div class="login-hero">
          <img src="/icons/delivery-moto.svg" alt="">
          <h1>Área do motoboy</h1>
          <p>Entre para ver somente as entregas em rota.</p>
        </div>
        ${message ? `<div class="notice" role="alert">${escapeHtml(message)}</div>` : ""}
        <form id="driver-login">
          <div class="field">
            <label for="driver-phone">Telefone</label>
            <input id="driver-phone" name="phone" type="tel" inputmode="tel" autocomplete="username" value="${escapeHtml(savedPhone)}" placeholder="(21) 99999-9999" required>
          </div>
          <div class="field">
            <label for="driver-password">Senha</label>
            <input id="driver-password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <button class="driver-btn coral" type="submit">Entrar</button>
        </form>
        <button class="driver-btn outline install-button" type="button" data-install hidden>Instalar aplicativo</button>
      </section>
    </main>
  `;
  updateInstallButton();
}

function formatAddress(order) {
  const data = order.fulfillment || {};
  return [
    [data.address, data.number].filter(Boolean).join(", "),
    data.neighborhood,
    data.complement
  ].filter(Boolean).join(" - ");
}

function phoneHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length <= 11 ? `+55${digits}` : `+${digits}`;
}

function orderCard(order, single = false) {
  const address = formatAddress(order);
  const delivered = order.status === "entregue";
  const details = `
    <div class="delivery-details">
      <div class="detail"><span class="detail-icon">👤</span><div><small>Cliente</small><strong>${escapeHtml(order.customer?.name)}</strong></div></div>
      <div class="detail"><span class="detail-icon">📍</span><div><small>Endereço</small><strong>${escapeHtml(address)}</strong></div></div>
      <div class="detail"><span class="detail-icon">☎</span><div><small>Telefone</small><strong>${escapeHtml(order.customer?.phone)}</strong></div></div>
    </div>
  `;

  if (delivered) {
    return `
      <section class="success-card">
        <img src="/icons/order-delivered.svg" alt="">
        <h2>Entrega confirmada!</h2>
        <p>Pedido #${escapeHtml(order.id)} entregue com sucesso.</p>
        ${single ? '<a class="driver-btn coral" href="/motoboy">Ver outras entregas</a>' : ""}
      </section>
    `;
  }

  return `
    <article class="driver-card">
      <div class="card-top">
        <div><p class="eyebrow">Pedido #${escapeHtml(order.id)}</p><h2>${escapeHtml(order.customer?.name)}</h2></div>
        <span class="status-pill">A caminho</span>
      </div>
      ${details}
      <div class="driver-actions">
        <a class="driver-btn waze" href="https://www.waze.com/ul?q=${encodeURIComponent(address)}&amp;navigate=yes" target="_blank" rel="noopener">🚀 Iniciar no Waze</a>
        <a class="driver-btn" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(address)}" target="_blank" rel="noopener">🧭 Abrir Maps</a>
        <a class="driver-btn" href="tel:${phoneHref(order.customer?.phone)}">📞 Ligar</a>
        <button class="driver-btn primary" type="button" data-confirm="${escapeHtml(order.deliveryToken)}">✓ Confirmar entrega</button>
      </div>
      ${confirmingDelivery === order.deliveryToken ? `
        <form class="confirm-panel" data-delivery-form="${escapeHtml(order.deliveryToken)}">
          <p>Peça ao cliente os <strong>4 últimos dígitos do telefone</strong>.</p>
          <div class="code-row">
            <input class="code-input" name="code" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" placeholder="0000" autocomplete="one-time-code" required autofocus>
            <button class="driver-btn primary" type="submit">Validar</button>
          </div>
          <div data-form-error></div>
        </form>
      ` : ""}
    </article>
  `;
}

function renderOrders(orders) {
  if (!orders.length) {
    app.innerHTML = driverShell(`
      <section class="empty-card">
        <img src="/icons/delivery-moto.svg" alt="">
        <h2>Nenhuma entrega em rota</h2>
        <p>Quando um pedido mudar para “Saiu para entrega”, ele aparecerá aqui.</p>
        <button class="driver-btn coral" type="button" data-refresh>Atualizar</button>
      </section>
      <p class="footer-note">Esta tela atualiza automaticamente.</p>
    `);
    return;
  }
  app.innerHTML = driverShell(`
    <h1>Pedidos em rota</h1>
    <p class="lead">${orders.length} ${orders.length === 1 ? "entrega aguardando" : "entregas aguardando"} confirmação.</p>
    <div class="delivery-list">${orders.map(order => orderCard(order)).join("")}</div>
    <p class="footer-note">Esta tela atualiza automaticamente.</p>
  `);
}

function renderSingleOrder(order) {
  app.innerHTML = driverShell(`
    <h1>${order.status === "entregue" ? "Pedido entregue" : "Entrega em rota"}</h1>
    <p class="lead">Confira os dados antes de seguir para o endereço.</p>
    <div class="delivery-list">${orderCard(order, true)}</div>
  `);
}

async function loadDeliveries(showLoading = true) {
  if (!sessionToken || loading) return;
  loading = true;
  if (showLoading) {
    app.innerHTML = `<main class="driver-loading"><img src="/icons/delivery-moto.svg" alt=""><p>Buscando entregas...</p></main>`;
  }
  try {
    if (requestedDelivery) {
      const order = await api(`/api/motoboy/orders/${encodeURIComponent(requestedDelivery)}`);
      renderSingleOrder(order);
    } else {
      renderOrders(await api("/api/motoboy/orders"));
    }
  } catch (error) {
    if (sessionToken) {
      app.innerHTML = driverShell(`
        <section class="empty-card">
          <h2>Não foi possível carregar</h2>
          <p>${escapeHtml(error.message)}</p>
          <button class="driver-btn coral" type="button" data-refresh>Tentar novamente</button>
        </section>
      `);
    }
  } finally {
    loading = false;
  }
}

function logout(message = "") {
  sessionToken = "";
  localStorage.removeItem(SESSION_KEY);
  renderLogin(message);
}

function updateInstallButton() {
  const button = document.querySelector("[data-install]");
  if (button) button.hidden = !installPrompt;
}

document.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id === "driver-login") {
    const button = event.target.querySelector("button[type=submit]");
    button.disabled = true;
    button.textContent = "Entrando...";
    const formData = new FormData(event.target);
    try {
      const phone = String(formData.get("phone") || "");
      const result = await api("/api/motoboy/login", {
        method: "POST",
        body: JSON.stringify({ phone, password: formData.get("password") })
      });
      sessionToken = result.token;
      localStorage.setItem(SESSION_KEY, sessionToken);
      localStorage.setItem(PHONE_KEY, phone);
      await loadDeliveries();
    } catch (error) {
      renderLogin(error.message);
    }
    return;
  }

  if (event.target.matches("[data-delivery-form]")) {
    const deliveryToken = event.target.dataset.deliveryForm;
    const button = event.target.querySelector("button[type=submit]");
    const errorBox = event.target.querySelector("[data-form-error]");
    button.disabled = true;
    button.textContent = "Validando...";
    errorBox.innerHTML = "";
    try {
      const code = new FormData(event.target).get("code");
      const order = await api(`/api/motoboy/orders/${encodeURIComponent(deliveryToken)}/confirm-delivery`, {
        method: "POST",
        body: JSON.stringify({ code })
      });
      confirmingDelivery = "";
      if (requestedDelivery) renderSingleOrder(order);
      else await loadDeliveries(false);
    } catch (error) {
      errorBox.innerHTML = `<div class="notice" role="alert" style="margin-top:10px">${escapeHtml(error.message)}</div>`;
      button.disabled = false;
      button.textContent = "Validar";
    }
  }
});

document.addEventListener("click", async event => {
  const target = event.target.closest("button, a");
  if (!target) return;
  if (target.matches("[data-logout]")) logout();
  if (target.matches("[data-refresh]")) loadDeliveries();
  if (target.matches("[data-confirm]")) {
    confirmingDelivery = target.dataset.confirm;
    await loadDeliveries(false);
    requestAnimationFrame(() => document.querySelector(".code-input")?.focus());
  }
  if (target.matches("[data-install]") && installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    updateInstallButton();
  }
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  installPrompt = event;
  updateInstallButton();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/motoboy-sw.js").catch(() => {}));
}

setInterval(() => {
  if (sessionToken && !document.querySelector(".confirm-panel") && document.visibilityState === "visible") {
    loadDeliveries(false);
  }
}, 15000);

if (sessionToken) loadDeliveries();
else renderLogin();
