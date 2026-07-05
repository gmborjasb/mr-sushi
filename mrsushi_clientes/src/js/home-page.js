const AUTH_SESSION_KEY = "mrsushi_auth_session";
const API_BASE_URL = window.MR_SUSHI_API_BASE_URL || "/api";
const CLIENTES_API_BASE_URL = window.MR_SUSHI_CLIENTES_API_URL || "https://yxhdbn9005.execute-api.us-east-1.amazonaws.com";
const RESTAURANT_ID = window.MR_SUSHI_RESTAURANT_ID || "mrsushi";

function readAuthSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveAuthSession(session) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({ ...session, updatedAt: new Date().toISOString() }));
}

function normalizeClientSession(data, fallback = {}) {
  const cliente = data?.cliente || data?.user || data || {};
  const email = String(cliente.email || fallback.email || "").trim();
  const name = String(cliente.nombre || cliente.name || fallback.name || (email ? email.split("@")[0] : "Cliente Mr. Sushi")).trim();
  const customerId = cliente.customerId || cliente.clienteId || data?.customerId || data?.clienteId || null;
  return {
    type: "customer",
    token: data?.token || "",
    customerId,
    clienteId: customerId,
    identity: email,
    name,
    email,
    phone: String(cliente.telefono || cliente.phone || fallback.phone || "").trim(),
    nekiPoints: Number(cliente.nekiPuntos ?? cliente.nekiPoints ?? 0)
  };
}

async function loginCustomer({ email, password }) {
  const response = await fetch(`${CLIENTES_API_BASE_URL}/clientes/login`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password, id_restaurante: RESTAURANT_ID })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "No se pudo iniciar sesión");
  return data;
}

function getAuthDisplay(session = readAuthSession()) {
  if (!session) return { name: "Cliente Mr. Sushi", email: "" };
  const identity = String(session.identity || "").trim();
  const identityIsEmail = identity.includes("@");
  const email = String(session.email || (identityIsEmail ? identity : "") || "francis.huerta.roque@gmail.com").trim();
  const inferredName = identityIsEmail
    ? identity.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
    : identity;

  return {
    name: String(session.name || inferredName || "Francis Huerta").trim(),
    email
  };
}

function loginIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
      <path d="M10 17l5-5-5-5"></path>
      <path d="M15 12H3"></path>
    </svg>
  `;
}

function userIcon() {
  return `
    <svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4"></circle>
      <path d="M4 21a8 8 0 0 1 16 0"></path>
    </svg>
  `;
}

function createProfileMenu() {
  const menu = document.createElement("section");
  menu.className = "codex-home-profile-menu";
  menu.hidden = true;
  menu.innerHTML = `
    <div class="codex-home-profile-head">
      <strong>Cliente Mr. Sushi</strong>
      <span></span>
    </div>
    <button type="button" data-home-account="points">☆ Neki Puntos</button>
    <button type="button" data-home-account="orders">▣ Mis pedidos</button>
    <button class="codex-home-profile-logout" type="button" data-home-account="logout">Cerrar sesión</button>
  `;
  document.body.append(menu);
  return menu;
}

function createAuthModal() {
  const overlay = document.createElement("div");
  overlay.className = "codex-home-auth-overlay";
  overlay.hidden = true;

  const modal = document.createElement("section");
  modal.className = "codex-home-auth-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="codex-home-auth-head">
      <h3>Inicia sesión</h3>
      <button class="codex-home-auth-close" type="button">Cerrar</button>
    </div>
    <form class="codex-home-auth-form">
      <label>
        Correo electrónico
        <input name="email" type="email" placeholder="correo@ejemplo.com" autocomplete="email" />
      </label>
      <label>
        Contraseña
        <input name="password" type="password" placeholder="Tu contraseña" autocomplete="current-password" />
      </label>
      <button class="codex-home-auth-submit" type="submit">Continuar</button>
    </form>
    <p class="codex-home-auth-status" aria-live="polite"></p>
  `;

  document.body.append(overlay, modal);
  return { overlay, modal };
}

function initHomeAccount() {
  document.querySelectorAll(".ct-redirect").forEach((node) => node.remove());
  document.querySelectorAll(".ct-slider").forEach((node) => {
    if (!node.querySelector("img, video, picture, [style*='background']")) node.remove();
  });

  const header = document.getElementById("header");
  if (!header) return;

  const profileButton = [...header.querySelectorAll("button")]
    .find((button) => !button.querySelector(".lucide-menu") && !button.querySelector(".lucide-shopping-bag") && !button.disabled);
  if (!profileButton) return;

  const menu = createProfileMenu();
  const { overlay, modal } = createAuthModal();
  const footerLogin = [...document.querySelectorAll("footer button")].find((button) =>
    button.textContent.trim().toLowerCase().includes("iniciar sesión")
  );

  const renderButton = () => {
    const session = readAuthSession();
    profileButton.classList.add("codex-home-profile-button");
    profileButton.classList.toggle("is-logged-in", Boolean(session));
    profileButton.setAttribute("aria-label", session ? "Abrir perfil" : "Iniciar sesión");
    profileButton.innerHTML = session ? userIcon() : loginIcon();
  };

  const closeMenu = () => {
    menu.hidden = true;
  };

  const openMenu = () => {
    const display = getAuthDisplay();
    const rect = profileButton.getBoundingClientRect();
    const width = menu.offsetWidth || 210;
    menu.querySelector("strong").textContent = display.name;
    menu.querySelector("span").textContent = display.email;
    menu.hidden = false;
    menu.style.top = `${rect.bottom + 9}px`;
    menu.style.left = `${Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12))}px`;
  };

  const openAuth = () => {
    overlay.hidden = false;
    modal.hidden = false;
    modal.querySelector(".codex-home-auth-status").textContent = "";
  };

  const closeAuth = () => {
    overlay.hidden = true;
    modal.hidden = true;
  };

  profileButton.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!readAuthSession()) {
      openAuth();
      return;
    }
    menu.hidden ? openMenu() : closeMenu();
  });

  footerLogin?.addEventListener("click", openAuth);
  document.addEventListener("click", closeMenu);
  menu.addEventListener("click", (event) => {
    event.stopPropagation();
    const action = event.target.closest("[data-home-account]")?.dataset.homeAccount;
    if (!action) return;
    if (action === "logout") {
      localStorage.removeItem(AUTH_SESSION_KEY);
      closeMenu();
      renderButton();
      return;
    }
    window.location.href = "pedir.html";
  });

  overlay.addEventListener("click", closeAuth);
  modal.querySelector(".codex-home-auth-close").addEventListener("click", closeAuth);
  modal.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") || "").trim();
    const password = String(formData.get("password") || "").trim();
    const status = modal.querySelector(".codex-home-auth-status");
    if (!email || !password) {
      status.textContent = "Ingresa correo y contraseña.";
      return;
    }
    status.textContent = "Conectando con Mr. Sushi...";
    try {
      const data = await loginCustomer({ email, password });
      saveAuthSession(normalizeClientSession(data, { email }));
      status.textContent = "Sesión iniciada correctamente.";
      renderButton();
      window.setTimeout(closeAuth, 350);
    } catch (error) {
      status.textContent = error.message || "No se pudo iniciar sesión.";
    }
  });

  renderButton();
}

document.addEventListener("DOMContentLoaded", initHomeAccount);
