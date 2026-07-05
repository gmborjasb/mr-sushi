const STORAGE_KEY = "mrsushi_offline_cart";
const ORDER_CONTEXT_KEY = "mrsushi_order_context";
const ORDER_TIME_KEY = "mrsushi_order_time";
const AUTH_SESSION_KEY = "mrsushi_auth_session";
const NEKI_POINTS_KEY = "mrsushi_neki_points_balance";
const PAID_ORDERS_KEY = "mrsushi_paid_orders";
const API_BASE_URL = window.MR_SUSHI_API_BASE_URL || "/api";
const CLIENTES_API_BASE_URL = window.MR_SUSHI_CLIENTES_API_URL || "https://yxhdbn9005.execute-api.us-east-1.amazonaws.com";
const PEDIDOS_API_BASE_URL = window.MR_SUSHI_PEDIDOS_API_URL || "https://sjpoxrretc.execute-api.us-east-1.amazonaws.com";

const formatCurrency = (value) => `S/ ${Number(value || 0).toFixed(2)}`;

const readJson = (key, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
};

const cart = readJson(STORAGE_KEY, []);
const orderContext = readJson(ORDER_CONTEXT_KEY, null);
const orderTime = readJson(ORDER_TIME_KEY, { label: "20 min", value: "asap" });
const authSession = readJson(AUTH_SESSION_KEY, null);
let nekiPointsBalance = Number(localStorage.getItem(NEKI_POINTS_KEY) || authSession?.nekiPoints || 0);
let selectedContactMode = authSession ? "saved" : "new";
let newContactDraft = { name: "", email: "", phone: "" };
let selectedPaymentMethod = {
  key: "kushki",
  label: "Paga con tarjeta de crédito o débito.",
  logo: "tarjeta de credito y debito.png",
  description: "Paga con tarjeta de crédito o débito."
};
let selectedNekiDiscount = null;
let isNekiWalletOpen = false;

const nekiDiscountOptions = [
  { discount: 5, points: 20 },
  { discount: 15, points: 50 },
  { discount: 35, points: 100 },
  { discount: 60, points: 150 },
  { discount: 90, points: 200 }
];

const cartOriginalTotal = (items) =>
  items.reduce((sum, item) => sum + item.quantity * (item.originalPrice || item.price), 0);

const cartTotal = (items) =>
  items.reduce((sum, item) => sum + item.quantity * item.price, 0);

const calculateNekiPoints = (paidTotal) => (Math.round(((paidTotal / 20) * 10)) / 10).toFixed(1);

function getSavedContact() {
  const identity = String(authSession?.identity || "").trim();
  const email = String(authSession?.email || (identity.includes("@") ? identity : "") || "").trim();
  const name = String(authSession?.name || (email ? email.split("@")[0] : "Cliente Mr. Sushi")).trim();
  const phone = String(authSession?.phone || "").trim();
  return { name, email, phone, customerId: authSession?.customerId || authSession?.clienteId || null };
}

function getTypedContact() {
  const nameNode = document.getElementById("checkout-contact-name");
  const emailNode = document.getElementById("checkout-contact-email");
  const phoneNode = document.getElementById("checkout-contact-phone");
  if (!nameNode && !emailNode && !phoneNode) return newContactDraft;

  return {
    name: nameNode?.value.trim() || "",
    email: emailNode?.value.trim() || "",
    phone: phoneNode?.value.trim() || ""
  };
}

function getSelectedContact() {
  return selectedContactMode === "saved" ? getSavedContact() : getTypedContact();
}

function isContactComplete(contact) {
  return Boolean(contact.name && contact.email && contact.phone);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function savePaidOrder(order) {
  const previousOrders = readJson(PAID_ORDERS_KEY, []);
  const grandTotal = Math.max(cartTotal(cart) - (selectedNekiDiscount?.discount || 0), 0);
  const paidOrder = {
    id: order?.orderId || order?.id || `MS-${Date.now()}`,
    numero_turno: order?.numero_turno || null,
    createdAt: new Date().toISOString(),
    status: order?.estado || order?.status || "RECEIVED",
    items: cart,
    cart,
    total: grandTotal,
    paymentMethod: selectedPaymentMethod.label,
    fulfillment: orderContext,
    requestedTime: orderTime,
    totals: {
      products: cartOriginalTotal(cart),
      discounts: Math.max(cartOriginalTotal(cart) - grandTotal, 0),
      subtotal: grandTotal
    }
  };

  localStorage.setItem(PAID_ORDERS_KEY, JSON.stringify([paidOrder, ...previousOrders].slice(0, 20)));
}

async function createOrder(payload) {
  const response = await fetch(`${PEDIDOS_API_BASE_URL}/pedidos`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(authSession?.token ? { Authorization: `Bearer ${authSession.token}` } : {})
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `API /pedidos respondió ${response.status}`);
  return data;
}

async function creditNekiPoints(delta) {
  const clienteId = authSession?.customerId || authSession?.clienteId;
  if (!clienteId || !delta) return;
  try {
    await fetch(`${CLIENTES_API_BASE_URL}/clientes/${clienteId}/neki-puntos`, {
      method: "PATCH",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(authSession?.token ? { Authorization: `Bearer ${authSession.token}` } : {})
      },
      body: JSON.stringify({ delta })
    });
  } catch {
    // El saldo se sincroniza en el próximo refreshNekiPoints().
  }
}

function showSuccessModal(order) {
  const overlay = document.createElement("div");
  overlay.className = "checkout-success-overlay";
  overlay.innerHTML = `
    <div class="checkout-success-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-success-title">
      <span class="checkout-success-icon" aria-hidden="true">✓</span>
      <h2 id="checkout-success-title">¡Pagado con éxito!</h2>
      <p>Sigue el estado de tu pedido en "Mis pedidos".</p>
      ${order?.numero_turno ? `<p class="checkout-success-ticket">Pedido #${escapeHtml(order.numero_turno)}</p>` : ""}
      <div class="checkout-success-actions">
        <button type="button" class="checkout-success-primary" data-success-action="orders">Ver mis pedidos</button>
        <button type="button" class="checkout-success-secondary" data-success-action="close">Seguir comprando</button>
      </div>
    </div>
  `;

  overlay.addEventListener("click", (event) => {
    const action = event.target.closest("[data-success-action]")?.dataset.successAction;
    if (action === "orders") {
      window.location.href = "pedir.html?openOrders=1";
      return;
    }
    if (event.target === overlay || action === "close") {
      overlay.remove();
    }
  });

  document.body.append(overlay);
}

async function refreshNekiPoints() {
  if (!authSession?.token) return;
  try {
    const response = await fetch(`${CLIENTES_API_BASE_URL}/clientes/me/neki-puntos`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${authSession.token}`
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    nekiPointsBalance = Number(data.nekiPuntos ?? data.points ?? nekiPointsBalance);
    localStorage.setItem(NEKI_POINTS_KEY, String(nekiPointsBalance));
    renderCheckout();
  } catch {
    // Mantiene saldo local si AWS todavía no responde.
  }
}

function getOrderContextLabel() {
  if (orderContext?.store?.name) return `${orderContext.store.name}, para retirar`;
  if (orderContext?.address) return orderContext.address;
  return "No has seleccionado una dirección o sede todavía.";
}

function renderCheckout() {
  const itemsNode = document.getElementById("checkout-items");
  const contactNode = document.getElementById("checkout-contact");
  const fulfillmentNode = document.getElementById("checkout-fulfillment");
  const productsTotalNode = document.getElementById("checkout-products-total");
  const discountTotalNode = document.getElementById("checkout-discount-total");
  const grandTotalNode = document.getElementById("checkout-grand-total");
  const pointsNode = document.getElementById("checkout-points");
  const statusNode = document.getElementById("checkout-status");
  const nekiWalletToggle = document.getElementById("checkout-neki-wallet-toggle");
  const nekiWalletSummaryNode = document.getElementById("checkout-neki-wallet-summary");
  const nekiWalletPanel = document.getElementById("checkout-neki-wallet-panel");
  const nekiWalletOverlay = document.getElementById("checkout-neki-wallet-overlay");
  const nekiBalanceNode = document.getElementById("checkout-neki-balance");
  const nekiOptionsNode = document.getElementById("checkout-neki-options");
  const paymentSelectedTitleNode = document.getElementById("checkout-payment-selected-title");
  const paymentSelectedDescriptionNode = document.getElementById("checkout-payment-selected-description");
  const paymentSelectedLogoNode = document.getElementById("checkout-payment-selected-logo");

  const productsTotal = cartOriginalTotal(cart);
  const subtotal = cartTotal(cart);
  const nekiDiscount = selectedNekiDiscount?.discount || 0;
  const grandTotal = Math.max(subtotal - nekiDiscount, 0);
  const discount = Math.max(productsTotal - grandTotal, 0);
  const savedContact = getSavedContact();
  const hasSavedContact = Boolean(authSession && isContactComplete(savedContact));
  if (selectedContactMode === "saved" && !hasSavedContact) selectedContactMode = "new";

  contactNode.innerHTML = `
    <div class="checkout-contact-options">
      <button class="checkout-contact-option ${selectedContactMode === "saved" ? "is-active" : ""}" type="button" data-contact-mode="saved" ${!hasSavedContact ? "disabled" : ""}>
        <strong>Usar contacto guardado</strong>
        <span>${hasSavedContact ? `${escapeHtml(savedContact.name)} · ${escapeHtml(savedContact.email)} · ${escapeHtml(savedContact.phone)}` : "Faltan datos guardados. Ingresa un contacto nuevo."}</span>
      </button>
      <button class="checkout-contact-option ${selectedContactMode === "new" ? "is-active" : ""}" type="button" data-contact-mode="new">
        <strong>Ingresar nuevo contacto</strong>
        <span>Usar otro nombre, correo o teléfono solo para este pedido.</span>
      </button>
    </div>
    <div class="checkout-contact-form" ${selectedContactMode === "new" ? "" : "hidden"}>
      <label class="checkout-field">
        Nombre de contacto
        <input id="checkout-contact-name" type="text" placeholder="Nombre completo" autocomplete="name" value="${selectedContactMode === "new" ? escapeHtml(newContactDraft.name) : escapeHtml(savedContact.name)}" />
      </label>
      <label class="checkout-field">
        Email
        <input id="checkout-contact-email" type="email" placeholder="correo@ejemplo.com" autocomplete="email" value="${selectedContactMode === "new" ? escapeHtml(newContactDraft.email) : escapeHtml(savedContact.email)}" />
      </label>
      <label class="checkout-field">
        Teléfono
        <input id="checkout-contact-phone" type="tel" placeholder="9XXXXXXXX" autocomplete="tel" value="${selectedContactMode === "new" ? escapeHtml(newContactDraft.phone) : escapeHtml(savedContact.phone)}" />
      </label>
    </div>
  `;

  itemsNode.innerHTML = cart.length
    ? cart.map((item) => `
        <article class="checkout-item">
          <img class="checkout-item__image" src="${item.image || ""}" alt="${item.name}" loading="lazy" />
          <div class="checkout-item__content">
            <h3>${item.name}</h3>
            <p>${item.description || item.name}</p>
          </div>
          <div class="checkout-item__prices">
            <strong>${formatCurrency(item.price * item.quantity)}</strong>
            ${(item.originalPrice || item.price) > item.price ? `<span>${formatCurrency(item.originalPrice * item.quantity)}</span>` : ""}
          </div>
        </article>
      `).join("")
    : `<div class="checkout-empty">Tu carrito está vacío.</div>`;

  fulfillmentNode.innerHTML = `
    <div class="checkout-fulfillment-box">
      <strong>${orderContext?.type === "pickup" ? "Para llevar" : "Delivery"}</strong>
      <p>${getOrderContextLabel()}</p>
      <span>${orderTime?.label || "20 min"}</span>
    </div>
  `;

  nekiBalanceNode.textContent = nekiPointsBalance > 0
    ? `Tienes ${nekiPointsBalance} Neki Puntos disponibles.`
    : "Aún no tienes Neki Puntos. Sigue comprando para obtener Neki Puntos y canjear descuentos.";
  nekiWalletSummaryNode.textContent = selectedNekiDiscount
    ? `${formatCurrency(selectedNekiDiscount.discount)} aplicado`
    : `${nekiPointsBalance} Neki Puntos`;
  nekiWalletPanel.hidden = !isNekiWalletOpen;
  nekiWalletOverlay.hidden = !isNekiWalletOpen;
  nekiWalletToggle.setAttribute("aria-expanded", String(isNekiWalletOpen));

  nekiOptionsNode.innerHTML = nekiDiscountOptions
    .map((option) => {
      const isDisabled = nekiPointsBalance < option.points;
      const isActive = selectedNekiDiscount?.points === option.points;
      return `
        <button
          class="checkout-neki-option ${isActive ? "is-active" : ""}"
          type="button"
          data-neki-points="${option.points}"
          data-neki-discount="${option.discount}"
          ${isDisabled ? "disabled" : ""}
        >
          <strong>${formatCurrency(option.discount)}</strong>
          <span>${option.points} puntos</span>
        </button>
      `;
    })
    .join("");

  productsTotalNode.textContent = formatCurrency(productsTotal);
  discountTotalNode.textContent = `- ${formatCurrency(discount)}`;
  grandTotalNode.textContent = formatCurrency(grandTotal);
  pointsNode.textContent = `Con esta compra acumularás ${calculateNekiPoints(grandTotal)} Neki Puntos`;
  paymentSelectedTitleNode.textContent = selectedPaymentMethod.label;
  paymentSelectedDescriptionNode.textContent = selectedPaymentMethod.description;
  paymentSelectedLogoNode.src = selectedPaymentMethod.logo;
  paymentSelectedLogoNode.alt = selectedPaymentMethod.label;
  paymentSelectedDescriptionNode.hidden =
    !selectedPaymentMethod.description ||
    selectedPaymentMethod.description.trim().toLowerCase() === selectedPaymentMethod.label.trim().toLowerCase();

  if (!cart.length) {
    statusNode.textContent = "Tu carrito está vacío. Regresa a pedir para continuar.";
  } else if (!isContactComplete(getSelectedContact())) {
    statusNode.textContent = "Por favor completa los campos requeridos en: Contacto";
  } else {
    statusNode.textContent = "Revisa tu entrega y continúa con el pago.";
  }
}

document.getElementById("checkout-pay-button")?.addEventListener("click", async () => {
  const statusNode = document.getElementById("checkout-status");
  const payButton = document.getElementById("checkout-pay-button");

  if (!cart.length) {
    statusNode.textContent = "Tu carrito está vacío.";
    return;
  }

  if (!orderContext) {
    statusNode.textContent = "Falta seleccionar entrega o sede antes de pagar.";
    return;
  }

  if (orderContext.type === "delivery" && !(orderContext.coordinates?.latitude && orderContext.coordinates?.longitude)) {
    statusNode.textContent = "Aún no pudimos ubicar tu dirección. Comparte tu ubicación o espera a que se confirme antes de pagar.";
    return;
  }

  const contact = getSelectedContact();
  if (!isContactComplete(contact)) {
    statusNode.textContent = "Por favor completa nombre, email y teléfono en Contacto.";
    return;
  }

  payButton.disabled = true;
  payButton.textContent = "Procesando...";
  statusNode.textContent = "Conectando con AWS...";

  const grandTotal = Math.max(cartTotal(cart) - (selectedNekiDiscount?.discount || 0), 0);

  try {
    const order = await createOrder({
      customerId: authSession?.customerId || authSession?.clienteId || contact.customerId || null,
      clienteId: authSession?.clienteId || authSession?.customerId || contact.customerId || null,
      origin: "WEB",
      channel: "web",
      currency: "PEN",
      paymentMethod: selectedPaymentMethod.key,
      contact,
      items: cart,
      cart,
      total: grandTotal,
      totals: {
        products: cartOriginalTotal(cart),
        discounts: Math.max(cartOriginalTotal(cart) - grandTotal, 0),
        subtotal: grandTotal
      },
      nekiDiscount: selectedNekiDiscount,
      fulfillment: orderContext,
      requestedTime: orderTime
    });

    savePaidOrder(order);

    const earnedPoints = Number(calculateNekiPoints(grandTotal));
    const redeemedPoints = selectedNekiDiscount?.points || 0;
    await creditNekiPoints(earnedPoints - redeemedPoints);

    statusNode.textContent = `Pedido creado${order.orderId ? `: ${order.orderId}` : " correctamente"}.`;
    payButton.textContent = "Pedido enviado";
    showSuccessModal(order);
  } catch {
    statusNode.textContent = "No se pudo crear el pedido. Revisa /pedidos en AWS.";
    payButton.disabled = false;
    payButton.textContent = "Pagar ahora";
  }
});

document.getElementById("checkout-payment-methods")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-payment-method]");
  if (!button) return;

  document.querySelectorAll(".checkout-payment-method").forEach((node) => {
    node.classList.toggle("is-active", node === button);
  });

  selectedPaymentMethod = {
    key: button.dataset.paymentMethod,
    label: button.querySelector("strong")?.textContent?.trim() || button.dataset.paymentMethod,
    logo: button.querySelector("img")?.getAttribute("src") || "",
    description: button.dataset.paymentDescription || ""
  };

  renderCheckout();
});

document.getElementById("checkout-contact")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-contact-mode]");
  if (!button || button.disabled) return;
  newContactDraft = getTypedContact();
  selectedContactMode = button.dataset.contactMode;
  renderCheckout();
});

document.getElementById("checkout-contact")?.addEventListener("input", () => {
  newContactDraft = getTypedContact();
});

document.getElementById("checkout-neki-options")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-neki-points]");
  if (!button || button.disabled) return;

  const option = {
    points: Number(button.dataset.nekiPoints),
    discount: Number(button.dataset.nekiDiscount)
  };

  selectedNekiDiscount =
    selectedNekiDiscount?.points === option.points
      ? null
      : option;

  renderCheckout();
});

document.getElementById("checkout-neki-wallet-toggle")?.addEventListener("click", () => {
  isNekiWalletOpen = true;
  renderCheckout();
});

document.getElementById("checkout-neki-wallet-close")?.addEventListener("click", () => {
  isNekiWalletOpen = false;
  renderCheckout();
});

document.getElementById("checkout-neki-wallet-overlay")?.addEventListener("click", () => {
  isNekiWalletOpen = false;
  renderCheckout();
});

renderCheckout();
refreshNekiPoints();
