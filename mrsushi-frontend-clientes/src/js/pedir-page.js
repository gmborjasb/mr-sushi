import { stores, haversineDistance, sortStoresByDistance } from "../data/stores.js";

const STORAGE_KEY = "mrsushi_offline_cart";
const ORDER_CONTEXT_KEY = "mrsushi_order_context";
const ORDER_TIME_KEY = "mrsushi_order_time";
const AUTH_SESSION_KEY = "mrsushi_auth_session";
const NEKI_POINTS_KEY = "mrsushi_neki_points_balance";
const PAID_ORDERS_KEY = "mrsushi_paid_orders";
const API_BASE_URL = window.MR_SUSHI_API_BASE_URL || "/api";
const CLIENTES_API_BASE_URL = window.MR_SUSHI_CLIENTES_API_URL || "https://yxhdbn9005.execute-api.us-east-1.amazonaws.com";
const PEDIDOS_API_BASE_URL = window.MR_SUSHI_PEDIDOS_API_URL || "https://sjpoxrretc.execute-api.us-east-1.amazonaws.com";

const formatCurrency = (value) => `S/ ${value.toFixed(2)}`;

const NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org";

const pickDistrict = (address = {}) =>
  address.suburb || address.city_district || address.town || address.city || address.county || "";

const locationApi = {
  listStores: async () => stores,

  nearestStores: async ({ latitude, longitude }) => {
    const userLocation = { lat: latitude, lng: longitude };
    const withDistance = sortStoresByDistance(userLocation).map((store) => ({
      ...store,
      distance: Math.round(haversineDistance(userLocation, store))
    }));
    return {
      stores: withDistance,
      inCoverage: withDistance.filter((store) => store.distance <= store.coverageRadius),
      nearest: withDistance[0]
    };
  },

  reverse: async ({ latitude, longitude }) => {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: latitude,
      lon: longitude,
      addressdetails: "1",
      "accept-language": "es"
    });
    const response = await fetch(`${NOMINATIM_BASE_URL}/reverse?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("No se pudo obtener la dirección");
    const data = await response.json();
    return {
      address: data.display_name,
      district: pickDistrict(data.address),
      latitude,
      longitude
    };
  },

  autocomplete: async ({ query, district }) => {
    const params = new URLSearchParams({
      format: "jsonv2",
      q: district ? `${query}, ${district}, Perú` : `${query}, Perú`,
      countrycodes: "pe",
      addressdetails: "1",
      limit: "5",
      "accept-language": "es"
    });
    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params.toString()}`, {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error("No se pudo consultar direcciones");
    const data = await response.json();
    return data.map((item) => ({
      label: item.display_name,
      address: item.display_name,
      district: pickDistrict(item.address),
      lat: item.lat,
      lng: item.lon
    }));
  }
};

const orderApi = {
  createOrder: (payload) =>
    apiRequest("/pedidos", {
      method: "POST",
      body: JSON.stringify(payload)
    }, PEDIDOS_API_BASE_URL)
};

async function apiRequest(path, options = {}, baseUrl = API_BASE_URL) {
  const session = readAuthSession();
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.message || `API ${path} respondió ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return data;
}

function saveOrderContext(context) {
  localStorage.setItem(ORDER_CONTEXT_KEY, JSON.stringify({ ...context, updatedAt: new Date().toISOString() }));
}

function readOrderContext() {
  try {
    return JSON.parse(localStorage.getItem(ORDER_CONTEXT_KEY) || "null");
  } catch {
    return null;
  }
}

function readOrderTime() {
  try {
    return JSON.parse(localStorage.getItem(ORDER_TIME_KEY) || "null") || { label: "20 min", value: "asap" };
  } catch {
    return { label: "20 min", value: "asap" };
  }
}

function saveOrderTime(time) {
  localStorage.setItem(ORDER_TIME_KEY, JSON.stringify({ ...time, updatedAt: new Date().toISOString() }));
}

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
  const email = String(cliente.email || fallback.email || fallback.identity || "").trim();
  const name = String(cliente.nombre || cliente.name || fallback.name || (email ? email.split("@")[0] : "Cliente Mr. Sushi")).trim();
  const phone = String(cliente.telefono || cliente.phone || fallback.phone || "").trim();
  const customerId = cliente.customerId || cliente.clienteId || data?.customerId || data?.clienteId || fallback.customerId || null;
  const nekiPoints = Number(cliente.nekiPuntos ?? cliente.nekiPoints ?? fallback.nekiPoints ?? 0);

  return {
    type: "customer",
    token: data?.token || fallback.token || "",
    customerId,
    clienteId: customerId,
    identity: email,
    name,
    email,
    phone,
    nekiPoints
  };
}

const customerApi = {
  login: ({ email, password }) =>
    apiRequest("/clientes/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    }, CLIENTES_API_BASE_URL),
  register: ({ name, email, phone, password }) =>
    apiRequest("/clientes/register", {
      method: "POST",
      body: JSON.stringify({ nombre: name, email, telefono: phone, password })
    }, CLIENTES_API_BASE_URL),
  points: () => apiRequest("/clientes/me/neki-puntos", {}, CLIENTES_API_BASE_URL),
  orders: () => apiRequest("/pedidos", {}, PEDIDOS_API_BASE_URL)
};

function readPaidOrders() {
  try {
    return JSON.parse(localStorage.getItem(PAID_ORDERS_KEY) || "[]");
  } catch {
    return [];
  }
}

function getNekiPointsBalance(session = readAuthSession()) {
  return Number(localStorage.getItem(NEKI_POINTS_KEY) || session?.nekiPoints || 0);
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

function getOrderContextLabel() {
  const orderContext = readOrderContext();
  if (orderContext?.store?.name) return `${orderContext.store.name}, para retirar`;
  if (orderContext?.address) return orderContext.address;
  return "¿Dónde quieres pedir?";
}

function getOrderTimeLabel() {
  return readOrderTime()?.label || "20 min";
}

function syncOrderUI() {
  const orderLabel = getOrderContextLabel();
  const timeLabel = getOrderTimeLabel();

  const orderTriggerText = document.querySelector(".codex-order-trigger-text");
  if (orderTriggerText) orderTriggerText.textContent = orderLabel;

  const orderTriggerTime = document.querySelector(".codex-order-trigger-time");
  if (orderTriggerTime) orderTriggerTime.textContent = timeLabel;

  const cartOrderLabel = document.querySelector(".codex-cart-order-label");
  if (cartOrderLabel) cartOrderLabel.textContent = orderLabel;

  const cartTimeLabel = document.querySelector(".codex-cart-time-label");
  if (cartTimeLabel) cartTimeLabel.textContent = timeLabel;
}

function debounce(callback, wait = 300) {
  let timeout;
  return (...args) => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => callback(...args), wait);
  };
}

function readCart() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeCart(cart) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
}

function parsePrice(text) {
  const match = text.replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function extractProducts() {
  return [...document.querySelectorAll(".product-card")].map((card) => {
    const link = card.querySelector("a[href]");
    const category =
      card.closest(".categoryContainer")?.querySelector(".categoryTitle")?.textContent?.trim() || "";
    const image = card.querySelector("img")?.getAttribute("src") || "";
    const name = card.querySelector(".orderProductName")?.textContent?.trim() || "Producto";
    const description = card.querySelector("p")?.textContent?.trim() || "";
    const priceNodes = [...card.querySelectorAll(".flex.gap-x-2.text-sm.flex-row div")];
    const priceText = priceNodes[0]?.textContent || "0";
    const originalPriceText =
      priceNodes.find((node) => node.className.includes("line-through"))?.textContent || priceText;
    const price = parsePrice(priceText);
    const originalPrice = Math.max(parsePrice(originalPriceText), price);
    const productKey = `${category}-${name}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return {
      card,
      id: productKey || name,
      href: link?.getAttribute("href") || "#",
      image,
      name,
      category,
      description,
      price,
      originalPrice
    };
  });
}

function normalizeProductForModal(product) {
  const normalizedProduct = { ...product };
  const category = (normalizedProduct.category || "").trim();

  if (normalizedProduct.name?.trim() === "Ebi Furai" && category === "Entradas Calientes") {
    normalizedProduct.description =
      "Langostinos empanizados al panko, crujientes y dorados, acompañados de nuestra salsa acevichada.";
  }

  if (normalizedProduct.name?.trim() === "Gyozas de Pescado" && category === "Entradas Calientes") {
    normalizedProduct.description =
      "Empanaditas rellenas de pescado fresco y verduras, servidas con nuestra salsa oriental.";
  }

  if (normalizedProduct.name?.trim() === "25 makis" && category === "Boxes") {
    normalizedProduct.description =
      "2 sabores de makis a elección (20 cortes) y un tercer sabor extra de 5 cortes. Todo acompañado con sus salsas aparte respectivas.";
  }

  if (normalizedProduct.name?.trim() === "Box Especial (los favoritos de Neki)" && category === "Boxes") {
    normalizedProduct.description =
      "5 cortes de cada favorito. Neki ya los probó, ahora es tu turno 🍣🧡";
  }

  if (normalizedProduct.name?.trim() === "Box familiar" && category === "Boxes") {
    normalizedProduct.description =
      "5 sabores de makis a elección (50 cortes). Acompañadas con sus salsas aparte respectivas.";
  }

  if (normalizedProduct.name?.trim() === "Maki box" && category === "Boxes") {
    normalizedProduct.description =
      "2 sabores de makis a elección (20 cortes). Todo acompañado con sus salsas aparte respectivas.";
  }

  if (normalizedProduct.name?.trim() === "Super maki box" && category === "Boxes") {
    normalizedProduct.description =
      "3 sabores de makis a elección (30 cortes). Acompañadas con sus salsas aparte respectivas.";
  }

  if (normalizedProduct.name?.trim() === "TNT box" && category === "Boxes") {
    normalizedProduct.description =
      "8 gunkans sushi variados, mezclados con nuestra salsa acevichada, cubitos de palta en algunos y un toque de togarashi.";
  }

  if (normalizedProduct.name?.trim() === "Combo Neki Giri") {
    normalizedProduct.description =
      "Este producto está agotado\nOnigiri de mr. sushi + gaseosa (300ml) 🍙🥤";
  }

  if (normalizedProduct.name?.trim() === "Neki Giri" && (normalizedProduct.category || "").trim() === "Promociones") {
    normalizedProduct.description =
      "Onigiri de mr. sushi, arroz de sushi en forma triangular, relleno y envuelto en alga crocante. 🍙";
  }

  return normalizedProduct;
}

function buildSmartOptionGroups(product) {
  const text = `${product.name} ${product.description} ${product.category || ""}`.toLowerCase();
  const groups = [];
  const isBeverageCategory = (product.category || "").trim() === "Bebidas";
  const isSoupCategory = (product.category || "").trim() === "Sopas (Fusionados)";
  const isSnackCategory = (product.category || "").trim() === "Bocaditos (Fusionados)";
  const isFusionCategory = (product.category || "").trim() === "Los Fusionados";
  const isSandwichCategory = (product.category || "").trim() === "Sandwich Sushi";
  const isMeshiCategory = (product.category || "").trim() === "Meshi";
  const isNekiFavoritesCategory = (product.category || "").trim() === "Los favoritos de neki";
  const isTemakiCategory = (product.category || "").trim() === "Temakis";
  const isColdStarterCategory = (product.category || "").trim() === "Entrada Frías";
  const isMakiCategory = (product.category || "").trim() === "Makis";
  const isPokeCategory = (product.category || "").trim() === "Poke";
  const isWeeklyPromoCategory = (product.category || "").trim() === "Promos de la Semana";
  const makiOptions = [
    "Acevichado Maki",
    "Furai Maki",
    "Baby Maki",
    "Hiroshima Maki",
    "California Maki",
    "Inka Maki",
    "Kani Maki",
    "Philadelphia Maki",
    "Quinua Maki",
    "Tokio Maki",
    "Yakuza Maki",
    "Tuna Crispy",
    "Huancaína Maki",
    "Lomo Saltado Maki",
    "Mr. Sushi Maki",
    "Ceviche Maki",
    "Passion Maki",
    "Monky Maki",
    "Kudamono Maki"
  ];
  const alitaOptions = [
    "Alitas Acevichadas (6 piezas)",
    "Alitas Bbq (6 piezas)",
    "Alitas Buffalo (6 piezas)",
    "Alitas Crunch (6 piezas)",
    "Alitas Maracuyá (6 piezas)",
    "Alitas Teriyaki (6 piezas)"
  ];
  const sodaOptions = ["Inca Kola 300 ml", "Coca Cola 300 ml", "Fanta 300 ml", "Sprite 300 ml"];
  const numberBefore = (pattern, fallback = null) => {
    const match = text.match(pattern);
    return match ? Number(match[1]) : fallback;
  };
  const makiFlavorLimit =
    numberBefore(/\((\d+)\s*sabores?\)/) ||
    numberBefore(/(\d+)\s*sabores?\s*de\s*makis?/) ||
    numberBefore(/(\d+)\s*sabores?\s*a\s*elecci[oó]n/) ||
    (/maki box/.test(text) ? 2 : null);
  const alitaFlavorLimit = numberBefore(/(\d+)\s*sabores?\).*alitas?/) || numberBefore(/alitas?.*?(\d+)\s*sabores?/, null);
  const drinkLimit = numberBefore(/(?:0?)(\d+)\s*gaseosas?/) || numberBefore(/(\d+)\s*bebidas?/, null);
  const isMaki = /maki|makis|box|fusionado/.test(text);
  const isAlita = /alita|alitas/.test(text);
  const isDrink = /gaseosa|bebida|inka|coca|chicha|limonada|agua/.test(text);
  const isPoke = /poke|bowl/.test(text);
  const isSandwich = /sandwich|sándwich/.test(text);
  const isHot = /furai|ebi|caliente|alita|tempura|frito|crujiente/.test(text);
  const isMerch = /merch|llavero|peluche|polo|gorra|sticker/.test(text);
  const isFood =
    !isMerch &&
    /sushi|maki|makis|box|poke|bowl|alita|alitas|sandwich|sándwich|nigiri|sashimi|temaki|entrada|ebi|furai|giri|taco|meshi|sopa|bocadito|fusionado/.test(text);

  if (/25\s*makis?\s*\+\s*0?6\s*alitas?\s*\+\s*0?2\s*gaseosas?/.test(text)) {
    return [
      {
        title: "Escoge 2 sabores de tus maki",
        type: "checkbox",
        min: 2,
        max: 2,
        options: makiOptions
      },
      {
        title: "Elige el sabor de tu 1/2 porción",
        type: "radio",
        min: 1,
        max: 1,
        options: makiOptions
      },
      {
        title: "Elige tu porción de alitas",
        type: "radio",
        min: 1,
        max: 1,
        options: alitaOptions
      },
      {
        title: "Escoge 2 bebidas",
        note: "Escoge tus bebidas favoritas",
        type: "checkbox",
        min: 2,
        max: 2,
        options: sodaOptions
      }
    ];
  }

  if (/1\s*poke\s*bowl.*1\s*bebida\s*de\s*300\s*ml/.test(text)) {
    return [
      {
        title: "Selecciona tu proteína favorita:",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Trucha Asalmonada",
          "Pollo en Salsa Teriyaki",
          "Sakana Furai",
          "Ebi Furai"
        ]
      },
      {
        title: "Escoge tus toppings favoritos:",
        type: "checkbox",
        min: 6,
        max: 6,
        options: [
          "Col Morada",
          "Zanahoria",
          "Palta",
          "Fruta de estación",
          "Kiuri Encurtido",
          "Choclo Americano",
          "Nachos",
          "Cancha Chulpi",
          "Chifles",
          "Gari"
        ]
      },
      {
        title: "Elige tus salsas favoritas",
        type: "checkbox",
        min: 2,
        max: 2,
        options: [
          "Salsa Acevichada",
          "Salsa Maracuyá",
          "Salsa passion",
          "Shoyu",
          "Taré (arma tu poke)"
        ]
      },
      {
        title: "Escoge 1 bebida",
        note: "Escoge tu bebida favorita",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Coca Cola 300 ml",
          "Sprite 300 ml",
          "Inca Kola 300 ml",
          "Fanta 300 ml"
        ]
      }
    ];
  }

  if (/box\s*familiar\s*\+\s*12\s*alitas?\s*\+\s*0?3\s*gaseosas?/.test(text)) {
    return [
      {
        title: "Escoge 5 sabores de tus maki:",
        type: "checkbox",
        min: 5,
        max: 5,
        options: makiOptions
      },
      {
        title: "Escoge el sabor de tus alitas (12unid)",
        type: "checkbox",
        min: 2,
        max: 2,
        options: [
          "Alitas Acevichadas (6 piezas)",
          "Alitas Bbq (6 piezas)",
          "Alitas Maracuyá (6 piezas)",
          "Alitas Buffalo (6 piezas)",
          "Alitas Teriyaki (6 piezas)",
          "Alitas Crunch (6 piezas)"
        ]
      },
      {
        title: "Escoge tus bebidas",
        type: "checkbox",
        min: 3,
        max: 3,
        options: [
          "Inca Kola 300 ml",
          "Coca Cola 300 ml",
          "Fanta 300 ml",
          "Sprite 300 ml",
          "Agua San Luis Sin Gas 625 ml"
        ]
      }
    ];
  }

  if (/maki\s*box\s*\+\s*ebi\s*furai\s*\(5\s*unidades\)/.test(text)) {
    return [
      {
        title: "Escoge 2 sabores de tus maki:",
        type: "checkbox",
        min: 2,
        max: 2,
        options: makiOptions
      },
      {
        title: "Selecciona tu ebi furai",
        type: "radio",
        min: 1,
        max: 1,
        options: ["Ebi Furai"]
      }
    ];
  }

  if (/mr\.\s*banqueton|mr\s*banqueton/.test(text)) {
    return [
      {
        title: "Selecciona tu ebi furai",
        type: "radio",
        min: 1,
        max: 1,
        options: ["Ebi Furai"]
      },
      {
        title: "Escoge 10 sabores de tu maki",
        type: "checkbox",
        min: 10,
        max: 10,
        options: makiOptions
      },
      {
        title: "Escoge el sabor de tus alitas (18unid)",
        type: "checkbox",
        min: 3,
        max: 3,
        options: [
          "Alitas Acevichadas (6 piezas)",
          "Alitas Bbq (6 piezas)",
          "Alitas Maracuyá (6 piezas)",
          "Alitas Buffalo (6 piezas)",
          "Alitas Teriyaki (6 piezas)",
          "Alitas Crunch (6 piezas)"
        ]
      },
      {
        title: "Escoge tus bebidas",
        type: "checkbox",
        min: 6,
        max: 6,
        options: [
          "Inca Kola 300 ml",
          "Coca Cola 300 ml",
          "Fanta 300 ml",
          "Sprite 300 ml",
          "Agua San Luis Sin Gas 625 ml"
        ]
      }
    ];
  }

  if (/mr\.\s*holiday|mr\s*holiday/.test(text)) {
    return [
      {
        title: "Escoge 5 sabores de tus maki:",
        type: "checkbox",
        min: 5,
        max: 5,
        options: makiOptions
      },
      {
        title: "Selecciona tu ebi furai",
        type: "radio",
        min: 1,
        max: 1,
        options: ["Ebi Furai"]
      },
      {
        title: "Selecciona tu yakimeshi",
        type: "radio",
        min: 1,
        max: 1,
        options: ["Yakimeshi de Pollo"]
      },
      {
        title: "Escoge el sabor de tus alitas (12unid)",
        type: "checkbox",
        min: 2,
        max: 2,
        options: [
          "Alitas Acevichadas (6 piezas)",
          "Alitas Bbq (6 piezas)",
          "Alitas Maracuyá (6 piezas)",
          "Alitas Buffalo (6 piezas)",
          "Alitas Teriyaki (6 piezas)",
          "Alitas Crunch (6 piezas)"
        ]
      },
      {
        title: "Escoge tus bebidas",
        type: "checkbox",
        min: 4,
        max: 4,
        options: [
          "Inca Kola 300 ml",
          "Coca Cola 300 ml",
          "Fanta 300 ml",
          "Sprite 300 ml",
          "Agua San Luis Sin Gas 625 ml"
        ]
      }
    ];
  }

  if (/mr\.\s*festin|mr\s*festin/.test(text)) {
    return [
      {
        title: "Escoge 3 sabores de tus maki:",
        type: "checkbox",
        min: 3,
        max: 3,
        options: makiOptions
      },
      {
        title: "Selecciona tu ebi furai",
        type: "radio",
        min: 1,
        max: 1,
        options: ["Ebi Furai"]
      },
      {
        title: "Escoge el sabor de tus alitas (12unid)",
        type: "checkbox",
        min: 2,
        max: 2,
        options: [
          "Alitas Acevichadas (6 piezas)",
          "Alitas Bbq (6 piezas)",
          "Alitas Maracuyá (6 piezas)",
          "Alitas Buffalo (6 piezas)",
          "Alitas Teriyaki (6 piezas)",
          "Alitas Crunch (6 piezas)"
        ]
      },
      {
        title: "Escoge tus bebidas",
        type: "checkbox",
        min: 3,
        max: 3,
        options: [
          "Inca Kola 300 ml",
          "Coca Cola 300 ml",
          "Fanta 300 ml",
          "Sprite 300 ml",
          "Agua San Luis Sin Gas 625 ml"
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "25 makis" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Escoge 2 sabores de tus maki:",
        type: "checkbox",
        min: 2,
        max: 2,
        options: makiOptions
      },
      {
        title: "Elige el sabor de tu 1/2 porción",
        type: "radio",
        min: 1,
        max: 1,
        options: makiOptions
      }
    ];
  }

  if ((product.name || "").trim() === "Box Especial (los favoritos de Neki)" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Selecciona tus favoritos",
        type: "checkbox",
        min: 5,
        max: 5,
        options: [
          "Acevi Maki",
          "Parrillero Maki",
          "Palta Crab maki",
          "Doragon Maki",
          "Tartar Maki"
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "Box familiar" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Escoge 5 sabores de tus maki:",
        type: "checkbox",
        min: 5,
        max: 5,
        options: makiOptions
      }
    ];
  }

  if ((product.name || "").trim() === "Maki box" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Escoge 2 sabores de tus maki:",
        type: "checkbox",
        min: 2,
        max: 2,
        options: makiOptions
      }
    ];
  }

  if ((product.name || "").trim() === "Super maki box" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Escoge 3 sabores de tus maki:",
        type: "checkbox",
        min: 3,
        max: 3,
        options: makiOptions
      }
    ];
  }

  if ((product.name || "").trim() === "TNT box" && (product.category || "").trim() === "Boxes") {
    return [
      {
        title: "Elige tu Gunkan",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Gunkan Sushi de Kani",
          "Gunkan Sushi de Trucha",
          "Gunkan Sushi de Langostinos"
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "Combo Neki Giri") {
    return [
      {
        title: "Escoge tu Neki Giri favorito",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Neki Giri Atún",
          "Neki Giri Pollo Teriyaki"
        ]
      },
      {
        title: "Escoge 1 bebida",
        note: "Escoge tu bebida favorita",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Coca Cola 300 ml",
          "Sprite 300 ml",
          "Inca Kola 300 ml",
          "Fanta 300 ml"
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "Neki Giri" && (product.category || "").trim() === "Promociones") {
    return [
      {
        title: "Escoge tu Neki Giri favorito",
        type: "radio",
        min: 1,
        max: 1,
        options: [
          "Neki Giri Atún",
          "Neki Giri Pollo Teriyaki"
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "Ebi Furai" && (product.category || "").trim() === "Entradas Calientes") {
    return [
      {
        title: "Elige la cantidad",
        type: "checkbox",
        min: 1,
        max: 1,
        options: [
          { label: "5 unidades", value: "5 unidades", price: 16.9 },
          { label: "10 unidades", value: "10 unidades", price: 29.9 }
        ]
      }
    ];
  }

  if ((product.name || "").trim() === "Gyozas de Pescado" && (product.category || "").trim() === "Entradas Calientes") {
    return [
      {
        title: "Elige la cantidad",
        type: "checkbox",
        min: 1,
        max: 1,
        options: [
          { label: "5 unidades", value: "5 unidades", price: 12.9 },
          { label: "10 unidades", value: "10 unidades", price: 19.9 }
        ]
      }
    ];
  }

  if (
    isBeverageCategory ||
    isSoupCategory ||
    isSnackCategory ||
    isFusionCategory ||
    isSandwichCategory ||
    isMeshiCategory ||
    isNekiFavoritesCategory ||
    isTemakiCategory ||
    isColdStarterCategory ||
    isMakiCategory ||
    isPokeCategory ||
    isWeeklyPromoCategory
  ) return groups;
  if (isMerch) return groups;

  if (isMaki) {
    const max = makiFlavorLimit || 2;
    groups.push({
      title: "Sabores de makis",
      type: "checkbox",
      min: max,
      max,
      options: ["Acevichado", "Acevichado crispy", "Parrillero", "Furai", "Spicy", "Acevichado clásico"]
    });
  }

  if (isAlita) {
    return [
      {
      title: "Elige tu porción de alitas",
      type: "checkbox",
      min: 1,
      max: 1,
      options: [
        { label: "6 alitas", value: "6 alitas", price: 16.9 },
        { label: "12 alitas", value: "12 alitas", price: 29.9 }
      ]
      }
    ];
  }

  if (isPoke) {
    groups.push({
      title: "Base",
      type: "radio",
      min: 1,
      max: 1,
      options: ["Arroz sushi", "Mix fresco", "Mitad arroz / mitad mix"]
    });
    groups.push({
      title: "Detalles del poke",
      type: "checkbox",
      min: 0,
      max: 3,
      options: ["Extra palta", "Salsa aparte", "Sin cebolla china", "Sin ajonjolí"]
    });
  }

  if (isSandwich) {
    groups.push({
      title: "Detalles del sándwich",
      type: "checkbox",
      min: 0,
      max: 3,
      options: ["Sin picante", "Salsa aparte", "Extra crocante", "Sin cebolla china"]
    });
  }

  if (isFood) {
    groups.push({
      title: "Preparación",
      type: "radio",
      min: 1,
      max: 1,
      options: isHot ? ["Caliente", "Salsas aparte"] : ["Regular", "Sin picante", "Salsas aparte"]
    });

    groups.push({
      title: "Complementos",
      type: "checkbox",
      min: 0,
      max: 4,
      options: ["Palitos", "Wasabi", "Gari", "Cubiertos", "Soya aparte"]
    });
  }

  return groups;
}

function renderProductOptionGroups(productModal, product) {
  const container = productModal.querySelector(".codex-product-options");
  const smartGroups = buildSmartOptionGroups(product);
  const groups = smartGroups;

  if (!groups.length) {
    container.innerHTML = "";
    return;
  }

  const optionRequirementMeta = (group) => {
    if ((group.min ?? 0) > 0) {
      return {
        primary: "Obligatorio",
        secondary: `Seleccione ${group.min}`
      };
    }

    if (group.max && group.max < 99) {
      return {
        primary: "Opcional",
        secondary: `Máximo ${group.max}`
      };
    }

    return {
      primary: "Opcional",
      secondary: ""
    };
  };

  container.innerHTML = `
    <h4 class="codex-product-options-title">Detalles del producto</h4>
    ${groups.map((group, groupIndex) => {
      const requirement = optionRequirementMeta(group);
      return `
    <fieldset class="codex-product-option-group" data-min="${group.min ?? 0}" data-max="${group.max ?? (group.type === "radio" ? 1 : 99)}">
      <legend>
        <span>${group.title}</span>
        <small>
          <strong>${requirement.primary}</strong>
          ${requirement.secondary ? `<em>${requirement.secondary}</em>` : ""}
        </small>
      </legend>
      ${group.note ? `<p class="codex-product-option-note">${group.note}</p>` : ""}
      ${group.options.map((option, optionIndex) => {
        const optionData =
          typeof option === "object" && option !== null
            ? option
            : { label: option, value: option, price: 0 };
        const priceMarkup = optionData.price ? `<small>+${formatCurrency(optionData.price)}</small>` : "";
        const inputType = (group.max ?? 99) === 1 ? "radio" : group.type;
        return `
        ${
          group.type === "checkbox" && (group.max ?? 99) > 1
            ? `<div class="codex-product-counter-option" data-option-value="${optionData.value}" data-option-price="${optionData.price || 0}">
                <span>${optionData.label}${priceMarkup}</span>
                <div class="codex-option-stepper">
                  <button type="button" data-option-action="decrease" aria-label="Quitar ${optionData.label}">−</button>
                  <strong data-option-count>0</strong>
                  <button type="button" data-option-action="increase" aria-label="Agregar ${optionData.label}">+</button>
                </div>
              </div>`
            : `<label>
                <input type="${inputType}" name="product-option-${groupIndex}" value="${optionData.value}" data-option-price="${optionData.price || 0}" />
                <span>${optionData.label}${priceMarkup}</span>
              </label>`
        }
      `;
      }).join("")}
      <p class="codex-product-limit-message" aria-live="polite"></p>
    </fieldset>
  `;
    }).join("")}
  `;
}

function upsertItem(product, delta = 1) {
  const cart = readCart();
  const existing = cart.find((item) => item.id === product.id);

  if (existing) existing.quantity += delta;
  else cart.push({ ...product, quantity: delta });

  writeCart(cart.filter((item) => item.quantity > 0));
}

function setQuantity(id, quantity) {
  const cart = readCart()
    .map((item) => (item.id === id ? { ...item, quantity } : item))
    .filter((item) => item.quantity > 0);

  writeCart(cart);
}

function cartCount(cart) {
  return cart.reduce((sum, item) => sum + item.quantity, 0);
}

function cartTotal(cart) {
  return cart.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

function cartOriginalTotal(cart) {
  return cart.reduce((sum, item) => sum + item.quantity * (item.originalPrice || item.price), 0);
}

function minutesFromTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function timeFromMinutes(value) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function roundUpToInterval(value, interval = 30) {
  return Math.ceil(value / interval) * interval;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function getSpanishWeekday(date) {
  return ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"][date.getDay()];
}

function getStoreForSchedule() {
  const context = readOrderContext();
  const fromContext = context?.store?.id ? stores.find((store) => store.id === context.store.id) : null;
  return fromContext || stores[0];
}

function lineAppliesToDate(line, date) {
  if (/lunes a domingo/i.test(line)) return true;
  const day = getSpanishWeekday(date).toLowerCase();
  return line.toLowerCase().includes(day);
}

function getStoreRangesForDate(store, date) {
  const ranges = store.hours
    .filter((line) => lineAppliesToDate(line, date))
    .flatMap((line) => [...line.matchAll(/(\d{1,2}:\d{2})\s*―\s*(\d{1,2}:\d{2})/g)])
    .map((match) => ({
      open: minutesFromTime(match[1]),
      close: minutesFromTime(match[2])
    }))
    .filter((range) => range.close > range.open);

  return ranges.length ? ranges : [{ open: minutesFromTime("11:00"), close: minutesFromTime("21:30") }];
}

function buildScheduleDays(store, daysToShow = 3) {
  const now = new Date();
  return Array.from({ length: daysToShow }, (_, offset) => {
    const date = new Date(now);
    date.setDate(now.getDate() + offset);
    const label =
      offset === 0
        ? "Hoy"
        : offset === 1
          ? "Mañana"
          : getSpanishWeekday(date).toLowerCase();

    return {
      key: dateKey(date),
      label,
      detail: `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`,
      date,
      ranges: getStoreRangesForDate(store, date)
    };
  });
}

function buildScheduleSlots(day, store) {
  const now = new Date();
  const selectedIsToday = dateKey(now) === day.key;
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const preparationMinutes = 20;
  const slots = [];

  day.ranges.forEach((range) => {
    const minStart = selectedIsToday ? currentMinutes + preparationMinutes : range.open;
    const firstSlot = Math.max(roundUpToInterval(minStart, 30), range.open);
    const canAsap = selectedIsToday && currentMinutes >= range.open && currentMinutes + preparationMinutes <= range.close;

    if (canAsap && !slots.some((slot) => slot.value === "asap")) {
      slots.push({
        label: "20 min",
        text: "Lo antes posible",
        value: "asap",
        isoDate: day.key,
        storeId: store.id
      });
    }

    for (let minutes = firstSlot; minutes <= range.close; minutes += 30) {
      slots.push({
        label: timeFromMinutes(minutes),
        text: timeFromMinutes(minutes),
        value: timeFromMinutes(minutes),
        isoDate: day.key,
        storeId: store.id
      });
    }
  });

  return slots;
}

function renderSchedulePicker(timeModal) {
  const store = getStoreForSchedule();
  const days = buildScheduleDays(store);
  const daysContainer = timeModal.querySelector(".codex-time-days");
  const slotsContainer = timeModal.querySelector(".codex-time-slots");
  const helper = timeModal.querySelector(".codex-time-helper");
  const saved = readOrderTime();
  const activeDay = days.find((day) => day.key === saved.isoDate) || days[0];

  daysContainer.innerHTML = days
    .map((day) => `
      <button class="${day.key === activeDay.key ? "is-active" : ""}" type="button" data-day="${day.key}">
        ${day.label}<br><small>${day.detail}</small>
      </button>
    `)
    .join("");

  const renderSlots = (dayKey) => {
    const day = days.find((item) => item.key === dayKey) || days[0];
    const slots = buildScheduleSlots(day, store);
    helper.textContent = `${store.name}: ${store.hours.join(" · ")}`;

    if (!slots.length) {
      slotsContainer.innerHTML = `<div class="codex-time-empty">Este local ya no tiene horarios disponibles para ${day.label.toLowerCase()}.</div>`;
      return;
    }

    slotsContainer.innerHTML = slots
      .map((slot, index) => `
        <button class="${slot.value === saved.value && slot.isoDate === saved.isoDate ? "is-active" : index === 0 ? "is-active" : ""}" type="button" data-time-label="${slot.label}" data-time-value="${slot.value}" data-iso-date="${slot.isoDate}" data-store-id="${slot.storeId}">
          ${slot.text}
        </button>
      `)
      .join("");
  };

  renderSlots(activeDay.key);
}

function createCartUI() {
  const overlay = document.createElement("div");
  overlay.className = "codex-cart-overlay";
  overlay.hidden = true;

  const drawer = document.createElement("aside");
  drawer.className = "codex-cart-drawer";
  drawer.hidden = true;
  drawer.innerHTML = `
    <div class="codex-cart-head">
      <h3>Tu Carrito <span class="codex-cart-title-count">(0)</span></h3>
      <div class="codex-cart-head-actions">
        <button class="codex-cart-time" type="button">
          <span class="codex-cart-time-label">20 min</span>
          <span aria-hidden="true">✎</span>
        </button>
        <button class="codex-cart-close" type="button" aria-label="Cerrar carrito">✕</button>
      </div>
    </div>
    <button class="codex-cart-order" type="button">
      <span class="codex-cart-order-label">¿Dónde quieres pedir?</span>
      <span aria-hidden="true">⌄</span>
    </button>
    <div class="codex-cart-view is-active" data-cart-view="cart">
      <div class="codex-cart-list"></div>
      <div class="codex-cart-footer">
        <div class="codex-cart-summary">
          <div>
            <span>Total Productos</span>
            <strong class="codex-cart-products-value">S/ 0.00</strong>
          </div>
          <div>
            <span>Descuentos</span>
            <strong class="codex-cart-discount-value">- S/ 0.00</strong>
          </div>
          <div class="codex-cart-total">
            <span>Subtotal</span>
            <strong class="codex-cart-total-value">S/ 0.00</strong>
          </div>
        </div>
        <div class="codex-cart-note">Ingresa tu dirección o selecciona un local para continuar</div>
        <button class="codex-cart-continue" type="button">Continuar</button>
      </div>
    </div>
    <div class="codex-cart-view codex-checkout-view" data-cart-view="checkout">
      <div class="codex-checkout-scroll">
        <button class="codex-checkout-back" type="button">← Volver al carrito</button>
        <section class="codex-checkout-section">
          <h4>Contacto</h4>
          <p class="codex-checkout-copy">Para que finalices tu compra sin problemas, necesitamos algunos datos que te tomará menos de un minuto completar.</p>
          <label class="codex-checkout-field">
            <span>Email</span>
            <input class="codex-checkout-email" type="email" placeholder="Tu correo electrónico" autocomplete="email" />
          </label>
          <p class="codex-checkout-error">El correo electrónico es requerido</p>
          <button class="codex-checkout-mini" type="button">Continuar</button>
        </section>

        <section class="codex-checkout-section">
          <h4>Entrega</h4>
          <p class="codex-checkout-copy">¿Cómo quieres tu pedido?</p>
          <div class="codex-checkout-delivery"></div>
          <p class="codex-checkout-login-hint">¿Ya tienes una cuenta? Inicia sesión con ella</p>
        </section>

        <section class="codex-checkout-section">
          <h4>Pago</h4>
          <div class="codex-billing-row">
            <div>
              <strong>Datos de facturación</strong>
              <p>Sin datos de facturación</p>
            </div>
            <button class="codex-billing-button" type="button">Agregar información</button>
          </div>
        </section>
      </div>

      <aside class="codex-checkout-summary">
        <div class="codex-checkout-items"></div>
        <label class="codex-checkout-field">
          <span>Código de descuento</span>
          <div class="codex-discount-row">
            <input type="text" placeholder="Aplicar" />
            <button type="button">Aplicar</button>
          </div>
        </label>
        <div class="codex-cart-summary">
          <div>
            <span>Total Productos</span>
            <strong class="codex-checkout-products-value">S/ 0.00</strong>
          </div>
          <div>
            <span>Descuentos</span>
            <strong class="codex-checkout-discount-value">- S/ 0.00</strong>
          </div>
          <div class="codex-cart-total">
            <span>Total a pagar</span>
            <strong class="codex-checkout-total-value">S/ 0.00</strong>
          </div>
        </div>
        <p class="codex-neki-points-earned">Con esta compra acumularás 0.0 Neki Puntos</p>
        <p class="codex-cart-note codex-checkout-note">Por favor completa los campos requeridos en: Contacto</p>
        <button class="codex-cart-pay" type="button">Pagar ahora</button>
      </aside>
    </div>
  `;

  document.body.append(overlay, drawer);

  const timeOverlay = document.createElement("div");
  timeOverlay.className = "codex-time-overlay";
  timeOverlay.hidden = true;

  const timeModal = document.createElement("section");
  timeModal.className = "codex-time-modal";
  timeModal.hidden = true;
  timeModal.setAttribute("role", "dialog");
  timeModal.setAttribute("aria-modal", "true");
  timeModal.innerHTML = `
    <div class="codex-time-head">
      <h3>¿Cuándo quieres tu pedido?</h3>
      <button class="codex-time-close" type="button">Cerrar</button>
    </div>
    <p class="codex-time-helper"></p>
    <div class="codex-time-days" role="group" aria-label="Día del pedido"></div>
    <div class="codex-time-slots" role="group" aria-label="Horario del pedido"></div>
  `;

  document.body.append(timeOverlay, timeModal);
  return { overlay, drawer, timeOverlay, timeModal };
}

function createProductModalUI() {
  const overlay = document.createElement("div");
  overlay.className = "codex-product-overlay";
  overlay.hidden = true;

  const modal = document.createElement("section");
  modal.className = "codex-product-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <button class="codex-product-close" type="button" aria-label="Cerrar producto">✕</button>
    <div class="codex-product-image-wrap">
      <img class="codex-product-image" src="" alt="" />
    </div>
    <div class="codex-product-body">
      <div class="codex-product-title-row">
        <div>
          <p class="codex-product-kicker">Mr. Sushi</p>
          <h3 class="codex-product-name"></h3>
        </div>
        <div class="codex-product-pricebox">
          <strong class="codex-product-price"></strong>
          <span class="codex-product-old-price"></span>
        </div>
      </div>
      <p class="codex-product-description"></p>
      <div class="codex-product-options">
      </div>
      <div class="codex-product-actions">
        <div class="codex-product-qty" aria-label="Cantidad">
          <button type="button" data-product-action="decrease">−</button>
          <span class="codex-product-qty-value">1</span>
          <button type="button" data-product-action="increase">+</button>
        </div>
        <button class="codex-product-add" type="button">Agregar</button>
      </div>
    </div>
  `;

  document.body.append(overlay, modal);
  return { productOverlay: overlay, productModal: modal };
}

function createAuthModalUI() {
  const overlay = document.createElement("div");
  overlay.className = "codex-auth-overlay";
  overlay.hidden = true;

  const modal = document.createElement("section");
  modal.className = "codex-auth-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.innerHTML = `
    <div class="codex-auth-head">
      <div>
        <p class="codex-auth-kicker">Mi cuenta</p>
        <h3>Bienvenido a Mr. Sushi</h3>
      </div>
      <button class="codex-auth-close" type="button" aria-label="Cerrar acceso">✕</button>
    </div>

    <div class="codex-auth-tabs" role="tablist" aria-label="Acceso">
      <button class="codex-auth-tab is-active" type="button" data-auth-tab="login">Iniciar sesión</button>
      <button class="codex-auth-tab" type="button" data-auth-tab="register">Crear cuenta</button>
    </div>

    <div class="codex-auth-panel is-active" data-auth-panel="login">
      <p class="codex-auth-helper">Ingresa con tu correo o celular para revisar tus pedidos, puntos y direcciones.</p>
      <form class="codex-auth-form" data-auth-form="login">
        <label>
          Correo o celular
          <input type="text" name="identity" placeholder="Correo o celular" autocomplete="username" />
        </label>
        <label>
          Contraseña
          <input type="password" name="password" placeholder="Ingresa tu contraseña" autocomplete="current-password" />
        </label>
        <button class="codex-auth-submit" type="submit">Iniciar sesión</button>
      </form>
      <button class="codex-auth-link" type="button" data-auth-switch="register">¿No tienes cuenta? Crear cuenta</button>
    </div>

    <div class="codex-auth-panel" data-auth-panel="register">
      <p class="codex-auth-helper">Crea tu cuenta para acumular Neki Puntos, guardar direcciones y pedir más rápido.</p>
      <form class="codex-auth-form" data-auth-form="register">
        <label>
          Nombre completo
          <input type="text" name="name" placeholder="Tu nombre completo" autocomplete="name" />
        </label>
        <label>
          Correo electrónico
          <input type="email" name="email" placeholder="correo@ejemplo.com" autocomplete="email" />
        </label>
        <label>
          Celular
          <input type="tel" name="phone" placeholder="9XXXXXXXX" autocomplete="tel" />
        </label>
        <label>
          Contraseña
          <input type="password" name="new-password" placeholder="Crea una contraseña" autocomplete="new-password" />
        </label>
        <button class="codex-auth-submit" type="submit">Crear cuenta</button>
      </form>
      <button class="codex-auth-link" type="button" data-auth-switch="login">Ya tengo cuenta</button>
    </div>

    <p class="codex-auth-status" aria-live="polite"></p>
  `;

  document.body.append(overlay, modal);
  return { overlay, modal };
}

function createProfileMenuUI() {
  const menu = document.createElement("section");
  menu.className = "codex-profile-menu";
  menu.hidden = true;
  menu.setAttribute("aria-label", "Menú de cuenta");
  menu.innerHTML = `
    <div class="codex-profile-menu-head">
      <strong class="codex-profile-menu-name">Cliente Mr. Sushi</strong>
      <span class="codex-profile-menu-email"></span>
    </div>
    <button type="button" data-profile-action="points">
      <span aria-hidden="true">☆</span>
      Neki Puntos
    </button>
    <button type="button" data-profile-action="orders">
      <span aria-hidden="true">▣</span>
      Mis pedidos
    </button>
    <button class="codex-profile-logout" type="button" data-profile-action="logout">Cerrar sesión</button>
  `;

  document.body.append(menu);
  return menu;
}

function createAccountPanelUI() {
  const overlay = document.createElement("div");
  overlay.className = "codex-account-overlay";
  overlay.hidden = true;

  const panel = document.createElement("section");
  panel.className = "codex-account-panel";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.innerHTML = `
    <div class="codex-account-head">
      <div>
        <p class="codex-account-kicker">Mi cuenta</p>
        <h3 class="codex-account-title">Neki Puntos</h3>
      </div>
      <button class="codex-account-close" type="button" aria-label="Cerrar panel">Cerrar</button>
    </div>
    <div class="codex-account-content"></div>
  `;

  document.body.append(overlay, panel);
  return { accountOverlay: overlay, accountPanel: panel };
}

async function renderNekiPointsPanel(panel) {
  const session = readAuthSession();
  let points = getNekiPointsBalance(session);
  const display = getAuthDisplay(session);
  const discounts = [
    { discount: 5, points: 20 },
    { discount: 15, points: 50 },
    { discount: 35, points: 100 },
    { discount: 60, points: 150 },
    { discount: 90, points: 200 }
  ];

  if (session?.token) {
    panel.querySelector(".codex-account-title").textContent = "Neki Puntos";
    panel.querySelector(".codex-account-content").innerHTML = `<div class="codex-orders-empty"><strong>Consultando Neki Puntos...</strong></div>`;
    try {
      const data = await customerApi.points();
      points = Number(data.nekiPuntos ?? data.points ?? points);
      localStorage.setItem(NEKI_POINTS_KEY, String(points));
    } catch {
      // Mantiene el saldo local si AWS aún no está disponible.
    }
  }

  panel.querySelector(".codex-account-title").textContent = "Neki Puntos";
  panel.querySelector(".codex-account-content").innerHTML = `
    <section class="codex-points-card">
      <span>${display.name}</span>
      <strong>${points.toFixed(1)} pts</strong>
      <p>${points > 0 ? "Estos puntos estarán disponibles para canjear descuentos en checkout." : "Aún no tienes Neki Puntos. Sigue comprando para canjear descuentos."}</p>
    </section>
    <div class="codex-points-grid">
      ${discounts.map((option) => `
        <article class="codex-points-option ${points >= option.points ? "is-available" : ""}">
          <strong>${formatCurrency(option.discount)}</strong>
          <span>${option.points} puntos</span>
        </article>
      `).join("")}
    </div>
  `;
}

const ORDER_STATUS_LABELS = {
  RECEIVED: "Pedido recibido",
  COOKING: "En cocina",
  PACKING: "Empacando tu pedido",
  DELIVERING: "En camino",
  READY_FOR_PICKUP: "Listo para recoger",
  DONE: "Entregado"
};

function getOrderStatusLabel(order) {
  const status = order.status || order.estado || "RECEIVED";
  if (status === "DONE") {
    return order.fulfillment?.type === "pickup" ? "Recogido en tienda" : "Entregado";
  }
  return ORDER_STATUS_LABELS[status] || status;
}

function getOrderTicketLabel(order) {
  if (order.numero_turno) return `Pedido #${order.numero_turno}`;
  const shortId = String(order.id || order.orderId || "").slice(0, 8);
  return shortId ? `Pedido #${shortId}` : "Pedido Mr. Sushi";
}

function getOrderItemsSummary(order) {
  const items = order.items || order.cart || [];
  if (!items.length) return "";
  return items
    .map((item) => (item.quantity > 1 ? `${item.quantity}× ${item.name}` : item.name))
    .join(", ");
}

async function renderOrdersPanel(panel) {
  const session = readAuthSession();
  let orders = readPaidOrders();
  panel.querySelector(".codex-account-title").textContent = "Mis pedidos";
  panel.querySelector(".codex-account-content").innerHTML = `<div class="codex-orders-empty"><strong>Consultando tus pedidos...</strong></div>`;

  if (session?.customerId || session?.clienteId) {
    try {
      const data = await customerApi.orders();
      orders = data.items || data.pedidos || data.orders || orders;
    } catch {
      // Mantiene historial local si AWS aún no está disponible.
    }
  }

  panel.querySelector(".codex-account-title").textContent = "Mis pedidos";
  panel.querySelector(".codex-account-content").innerHTML = orders.length
    ? `
      <div class="codex-orders-list">
        ${orders.map((order) => `
          <article class="codex-order-card">
            <div>
              <strong>${getOrderTicketLabel(order)}</strong>
              <span>${new Date(order.createdAt || Date.now()).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <p>${getOrderStatusLabel(order)}</p>
            ${getOrderItemsSummary(order) ? `<small class="codex-order-items">${getOrderItemsSummary(order)}</small>` : ""}
            <small>${order.fulfillment?.store?.name || order.fulfillment?.address || "Entrega pendiente"} · ${formatCurrency(order.total || order.totals?.subtotal || 0)}</small>
          </article>
        `).join("")}
      </div>
    `
    : `
      <div class="codex-orders-empty">
        <strong>Aún no tienes pedidos pagados.</strong>
        <p>Cuando un pedido se pague correctamente en la web, aparecerá aquí con su estado de seguimiento.</p>
      </div>
    `;
}

function createOrderModeUI() {
  const overlay = document.createElement("div");
  overlay.className = "codex-order-overlay";
  overlay.hidden = true;

  const modal = document.createElement("section");
  modal.className = "codex-order-modal";
  modal.hidden = true;
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "codex-order-title");
  const storeCards = stores
    .map((store) => `
      <button class="codex-store-card" type="button" data-order-store="${store.id}">
        <strong>${store.name}</strong>
        <span>${store.address}</span>
      </button>
    `)
    .join("");

  modal.innerHTML = `
    <div class="codex-order-head">
      <h3 id="codex-order-title">¿Cómo quieres tu pedido?</h3>
      <button class="codex-order-close" type="button">Cerrar</button>
    </div>
    <div class="codex-order-options" role="group" aria-label="Tipo de pedido">
      <button class="codex-order-option is-active" type="button" data-order-type="Delivery">Delivery</button>
      <button class="codex-order-option" type="button" data-order-type="Para llevar">Para llevar</button>
    </div>
    <div class="codex-order-panel is-active" data-order-panel="Delivery">
      <button class="codex-location-button" type="button">Compartir ubicación</button>
      <p class="codex-location-status" aria-live="polite"></p>
      <div class="codex-address-block">
        <label>
          Distrito
          <select class="codex-district-select">
            <option value="">Selecciona un distrito</option>
            <option value="San Miguel">San Miguel</option>
            <option value="Miraflores">Miraflores</option>
            <option value="San Juan de Miraflores">San Juan de Miraflores</option>
            <option value="San Martín de Porres">San Martín de Porres</option>
            <option value="Callao">Callao</option>
            <option value="Lima">Lima</option>
            <option value="Surquillo">Surquillo</option>
          </select>
        </label>
        <label>
          Escribe tu dirección
          <input class="codex-address-input" type="search" placeholder="Ingresa tu dirección" autocomplete="street-address" />
        </label>
        <div class="codex-address-suggestions" hidden></div>
        <button class="codex-address-save" type="button">Guardar</button>
      </div>
    </div>
    <div class="codex-order-panel" data-order-panel="Para llevar">
      <p class="codex-store-title">Selecciona una sede</p>
      <div class="codex-store-slider">
        ${storeCards}
      </div>
    </div>
  `;

  document.body.append(overlay, modal);
  return { overlay, modal };
}

function initOrderMode() {
  const orderButton = document.querySelector("#orderBar .max-w-\\[60dvw\\]");
  if (!orderButton) return;

  orderButton.classList.add("codex-order-trigger");
  orderButton.type = "button";
  orderButton.innerHTML = `
    <span class="codex-order-trigger-main">
      <span class="codex-order-trigger-text">¿Dónde quieres pedir?</span>
      <span class="codex-order-trigger-icon">⌄</span>
    </span>
    <span class="codex-order-trigger-time">20 min</span>
  `;

  const { overlay, modal } = createOrderModeUI();
  const closeButton = modal.querySelector(".codex-order-close");
  const options = modal.querySelectorAll(".codex-order-option");
  const panels = modal.querySelectorAll("[data-order-panel]");
  const storeSlider = modal.querySelector(".codex-store-slider");
  const locationButton = modal.querySelector(".codex-location-button");
  const locationStatus = modal.querySelector(".codex-location-status");
  const districtSelect = modal.querySelector(".codex-district-select");
  const addressInput = modal.querySelector(".codex-address-input");
  const suggestionsBox = modal.querySelector(".codex-address-suggestions");
  const saveAddressButton = modal.querySelector(".codex-address-save");
  const updateOrderLabel = (text) => {
    orderButton.querySelector(".codex-order-trigger-text").textContent = text;
    const cartOrderLabel = document.querySelector(".codex-cart-order-label");
    if (cartOrderLabel) cartOrderLabel.textContent = text;
    syncOrderUI();
  };

  const setStatus = (message, type = "info") => {
    locationStatus.textContent = message;
    locationStatus.dataset.status = type;
  };

  const renderStoreButtons = (storeList) => {
    storeSlider.innerHTML = storeList
      .map((store) => `
        <button class="codex-store-card" type="button" data-order-store="${store.id}">
          <strong>${store.name}</strong>
          <span>${store.address}</span>
        </button>
      `)
      .join("");
  };

  const loadStores = async () => {
    try {
      const data = await locationApi.listStores();
      const storeList = Array.isArray(data) ? data : data.stores;
      if (Array.isArray(storeList) && storeList.length) {
        renderStoreButtons(storeList);
      }
    } catch (error) {
      setStatus("No se pudieron cargar las sedes.", "error");
    }
  };

  const selectStore = (button) => {
    const storeButtons = modal.querySelectorAll(".codex-store-card");
    storeButtons.forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const selectedStore =
      stores.find((store) => store.id === button.dataset.orderStore) || {
        id: button.dataset.orderStore,
        name: button.querySelector("strong")?.textContent?.trim() || "Sede seleccionada",
        address: button.querySelector("span")?.textContent?.trim() || ""
      };

    saveOrderContext({ type: "pickup", store: selectedStore });
    updateOrderLabel(selectedStore.name);
  };

  const applyResolvedAddress = async (payload) => {
    const address = payload.address || payload.displayName || payload.label || "Dirección seleccionada";
    const district = payload.district || payload.cityDistrict || payload.city || "";
    const coordinates = payload.coordinates || (
      payload.latitude && payload.longitude
        ? { latitude: Number(payload.latitude), longitude: Number(payload.longitude) }
        : payload.lat && payload.lng
          ? { latitude: Number(payload.lat), longitude: Number(payload.lng) }
          : null
    );

    addressInput.value = address;
    if (district) {
      const districtOption = [...districtSelect.options].find((option) =>
        option.value &&
        district.toLowerCase().includes(option.value.toLowerCase())
      );
      if (districtOption) districtSelect.value = districtOption.value;
    }

    saveOrderContext({ type: "delivery", address, district, coordinates });
    updateOrderLabel(address);
    suggestionsBox.hidden = true;
    suggestionsBox.innerHTML = "";

    if (coordinates?.latitude && coordinates?.longitude) {
      try {
        const nearest = await locationApi.nearestStores(coordinates);
        saveOrderContext({ type: "delivery", address, district, coordinates, nearest });
        syncOrderUI();
      } catch {
        setStatus("Dirección guardada. No pudimos calcular la cobertura para esa ubicación.", "error");
      }
    }
  };

  const openModal = () => {
    overlay.hidden = false;
    modal.hidden = false;
    loadStores();
  };

  const closeModal = () => {
    overlay.hidden = true;
    modal.hidden = true;
  };

  orderButton.addEventListener("click", openModal);
  overlay.addEventListener("click", closeModal);
  closeButton.addEventListener("click", closeModal);

  options.forEach((button) => {
    button.addEventListener("click", () => {
      options.forEach((item) => item.classList.remove("is-active"));
      button.classList.add("is-active");
      panels.forEach((panel) => {
        panel.classList.toggle("is-active", panel.dataset.orderPanel === button.dataset.orderType);
      });
      updateOrderLabel(button.dataset.orderType);
    });
  });

  storeSlider.addEventListener("click", (event) => {
    const button = event.target.closest(".codex-store-card");
    if (button) selectStore(button);
  });

  locationButton.addEventListener("click", () => {
    if (!navigator.geolocation) {
      setStatus("Tu navegador no permite compartir ubicación.", "error");
      return;
    }

    setStatus("Solicitando permiso de ubicación...", "info");
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const coordinates = { latitude: coords.latitude, longitude: coords.longitude };
        setStatus("Ubicación recibida. Buscando dirección y cobertura...", "info");
        try {
          const resolved = await locationApi.reverse(coordinates);
          await applyResolvedAddress({ ...resolved, coordinates });
          setStatus("Ubicación conectada correctamente.", "success");
        } catch (error) {
          try {
            const nearest = await locationApi.nearestStores(coordinates);
            saveOrderContext({ type: "delivery", coordinates, nearest });
            syncOrderUI();
          } catch {
            saveOrderContext({ type: "delivery", coordinates });
            syncOrderUI();
          }
          setStatus("Recibimos tu ubicación, pero no pudimos identificar la dirección exacta. Puedes escribirla manualmente.", "error");
        }
      },
      () => {
        setStatus("No pudimos acceder a tu ubicación. Puedes escribir tu dirección.", "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  });

  addressInput.addEventListener(
    "input",
    debounce(async () => {
      const query = addressInput.value.trim();
      if (query.length < 3) {
        suggestionsBox.hidden = true;
        suggestionsBox.innerHTML = "";
        return;
      }

      suggestionsBox.hidden = false;
      suggestionsBox.innerHTML = `<div class="codex-address-loading">Buscando direcciones...</div>`;

      try {
        const data = await locationApi.autocomplete({ query, district: districtSelect.value });
        const suggestions = Array.isArray(data) ? data : data.suggestions;

        if (!Array.isArray(suggestions) || !suggestions.length) {
          suggestionsBox.innerHTML = `<div class="codex-address-loading">Sin resultados para esa dirección.</div>`;
          return;
        }

        suggestionsBox.innerHTML = suggestions
          .map((suggestion, index) => `
            <button type="button" class="codex-address-suggestion" data-suggestion-index="${index}">
              <strong>${suggestion.label || suggestion.displayName || suggestion.address}</strong>
              <span>${suggestion.district || suggestion.city || "Perú"}</span>
            </button>
          `)
          .join("");
        suggestionsBox._suggestions = suggestions;
      } catch (error) {
        suggestionsBox.innerHTML = `<div class="codex-address-loading">No se pudo consultar direcciones en este momento.</div>`;
      }
    }, 320)
  );

  suggestionsBox.addEventListener("click", async (event) => {
    const button = event.target.closest(".codex-address-suggestion");
    if (!button) return;
    const suggestion = suggestionsBox._suggestions?.[Number(button.dataset.suggestionIndex)];
    if (suggestion) {
      await applyResolvedAddress(suggestion);
      setStatus("Dirección seleccionada.", "success");
    }
  });

  saveAddressButton.addEventListener("click", async () => {
    const district = districtSelect.value.trim();
    const address = addressInput.value.trim();

    if (!district) {
      setStatus("Selecciona un distrito antes de guardar.", "error");
      return;
    }

    if (!address) {
      setStatus("Escribe tu dirección antes de guardar.", "error");
      return;
    }

    await applyResolvedAddress({
      address,
      district
    });
    setStatus("Dirección guardada correctamente.", "success");
    closeModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.hidden) {
      closeModal();
    }
  });

  syncOrderUI();
}

function initCategoryBar() {
  const categoryButtons = [...document.querySelectorAll(".orderNavigationBarCategory")];
  if (!categoryButtons.length) return;
  const categorySections = [...document.querySelectorAll(".categoryContainer[id^='cat-']")];

  const setActive = (button) => {
    categoryButtons.forEach((item) => item.classList.remove("codex-category-active"));
    button.classList.add("codex-category-active");
  };

  const categoryFromHash = () => {
    const hash = window.location.hash.replace("#cat-", "");
    if (!hash) return null;
    return document.getElementById(`cat-button-${hash}`);
  };

  const initial = categoryFromHash() || categoryButtons[0];
  if (initial) setActive(initial);

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActive(button);
      const categoryId = button.id.replace("cat-button-", "");
      const targetSection = document.getElementById(`cat-${categoryId}`);

      if (targetSection) {
        const offset = 190;
        const top = targetSection.getBoundingClientRect().top + window.scrollY - offset;
        window.history.replaceState(null, "", `#cat-${categoryId}`);
        window.scrollTo({ top, behavior: "smooth" });
      }
    });
  });

  if (categorySections.length) {
    const updateByScroll = () => {
      const offset = 220;
      let currentSection = categorySections[0];

      categorySections.forEach((section) => {
        if (window.scrollY >= section.offsetTop - offset) {
          currentSection = section;
        }
      });

      if (!currentSection) return;

      const button = document.getElementById(
        `cat-button-${currentSection.id.replace("cat-", "")}`
      );

      if (button) {
        setActive(button);
      }
    };

    window.addEventListener("scroll", updateByScroll, { passive: true });
    updateByScroll();
  }
}

function initNekiPointsBanner() {
  const promotionsSection = document.querySelector(".categoryContainer[id^='cat-']");
  const productsContainer = document.querySelector(".orderProductsContainer");
  if (!promotionsSection || !productsContainer) return;
  if (document.querySelector(".codex-neki-points-banner")) return;

  const banner = document.createElement("section");
  banner.className = "codex-neki-points-banner";
  banner.innerHTML = `
    <div class="codex-neki-points-copy">
      <h2>Acumula Neki Puntos</h2>
      <p>Regístrate, gana puntos con tus compras y canjéalos por productos y más</p>
    </div>
    <button class="codex-neki-points-button" type="button">Únete</button>
  `;

  productsContainer.insertBefore(banner, promotionsSection);
}

function initCart() {
  const profileButtons = [...document.querySelectorAll("#header button")]
    .filter((button) => !button.querySelector(".lucide-menu") && !button.querySelector(".lucide-shopping-bag"));

  profileButtons.forEach((button) => {
    button.classList.add("codex-profile-launcher");
    button.setAttribute("aria-label", "Perfil o iniciar sesión");
    button.innerHTML = `
      <svg class="codex-profile-icon" xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
        <path d="M10 17l5-5-5-5"></path>
        <path d="M15 12H3"></path>
      </svg>
    `;
  });

  const cartButtons = [
    ...document.querySelectorAll("#orderBar button"),
    ...document.querySelectorAll("#header button")
  ].filter((button) => button.querySelector(".lucide-shopping-bag"));

  if (!cartButtons.length) return;

  cartButtons.forEach((button, index) => {
    button.classList.add("codex-cart-launcher");
    button.innerHTML =
      index === 0
        ? `<span class="codex-cart-icon" aria-hidden="true">🛒</span><span>Carrito</span><span class="codex-cart-badge">0</span>`
        : `<span class="codex-cart-icon" aria-hidden="true">🛒</span><span class="codex-cart-badge">0</span>`;
  });

  const { overlay, drawer, timeOverlay, timeModal } = createCartUI();
  const { productOverlay, productModal } = createProductModalUI();
  const { overlay: authOverlay, modal: authModal } = createAuthModalUI();
  const profileMenu = createProfileMenuUI();
  const { accountOverlay, accountPanel } = createAccountPanelUI();
  const list = drawer.querySelector(".codex-cart-list");
  const cartView = drawer.querySelector('[data-cart-view="cart"]');
  const checkoutView = drawer.querySelector('[data-cart-view="checkout"]');
  const titleCount = drawer.querySelector(".codex-cart-title-count");
  const cartOrderLabel = drawer.querySelector(".codex-cart-order-label");
  const timeLabel = drawer.querySelector(".codex-cart-time-label");
  const productsValue = drawer.querySelector(".codex-cart-products-value");
  const discountValue = drawer.querySelector(".codex-cart-discount-value");
  const totalValue = drawer.querySelector(".codex-cart-total-value");
  const checkoutItems = drawer.querySelector(".codex-checkout-items");
  const checkoutProductsValue = drawer.querySelector(".codex-checkout-products-value");
  const checkoutDiscountValue = drawer.querySelector(".codex-checkout-discount-value");
  const checkoutTotalValue = drawer.querySelector(".codex-checkout-total-value");
  const checkoutPoints = drawer.querySelector(".codex-neki-points-earned");
  const checkoutNote = drawer.querySelector(".codex-checkout-note");
  const badgeNodes = document.querySelectorAll(".codex-cart-badge");
  const productState = { product: null, quantity: 1 };
  let continueAfterAuth = false;

  const setCartView = (view) => {
    cartView.classList.toggle("is-active", view === "cart");
    checkoutView.classList.toggle("is-active", view === "checkout");
  };

  const calculateNekiPoints = (paidTotal) => (Math.round(((paidTotal / 20) * 10)) / 10).toFixed(1);

  const renderProfileButtons = () => {
    const session = readAuthSession();
    profileButtons.forEach((button) => {
      button.classList.toggle("is-logged-in", Boolean(session));
      button.innerHTML = session
        ? `
          <svg class="codex-profile-icon" xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4"></circle>
            <path d="M4 21a8 8 0 0 1 16 0"></path>
          </svg>
        `
        : `
          <svg class="codex-profile-icon" xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
            <path d="M10 17l5-5-5-5"></path>
            <path d="M15 12H3"></path>
          </svg>
        `;
    });
  };

  const closeProfileMenu = () => {
    profileMenu.hidden = true;
  };

  const openProfileMenu = (button) => {
    const session = readAuthSession();
    const display = getAuthDisplay(session);
    const rect = button.getBoundingClientRect();
    profileMenu.querySelector(".codex-profile-menu-name").textContent = display.name;
    profileMenu.querySelector(".codex-profile-menu-email").textContent = display.email;
    profileMenu.hidden = false;
    const menuWidth = profileMenu.offsetWidth || 210;
    profileMenu.style.top = `${Math.min(rect.bottom + 9, window.innerHeight - 12)}px`;
    profileMenu.style.left = `${Math.max(12, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 12))}px`;
  };

  const toggleProfileMenu = (button) => {
    if (profileMenu.hidden) {
      openProfileMenu(button);
    } else {
      closeProfileMenu();
    }
  };

  const closeAccountPanel = () => {
    accountOverlay.hidden = true;
    accountPanel.hidden = true;
  };

  const openAccountPanel = async (type) => {
    closeProfileMenu();
    if (type === "orders") {
      await renderOrdersPanel(accountPanel);
    } else {
      await renderNekiPointsPanel(accountPanel);
    }
    accountOverlay.hidden = false;
    accountPanel.hidden = false;
  };

  const setAuthTab = (tab) => {
    authModal.querySelectorAll(".codex-auth-tab").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.authTab === tab);
    });
    authModal.querySelectorAll(".codex-auth-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.authPanel === tab);
    });
    authModal.querySelector(".codex-auth-status").textContent = "";
  };

  const openAuthModal = (tab = "login") => {
    setAuthTab(tab);
    authOverlay.hidden = false;
    authModal.hidden = false;
  };

  const closeAuthModal = () => {
    authOverlay.hidden = true;
    authModal.hidden = true;
  };

  const getSelectedOptionsSummary = () => {
    const selectedInputs = [...productModal.querySelectorAll(".codex-product-options input:checked")].map((input) => ({
      label: input.value,
      price: Number(input.dataset.optionPrice || 0)
    }));
    const selectedCounters = [...productModal.querySelectorAll(".codex-product-counter-option")]
      .map((option) => {
        const count = Number(option.querySelector("[data-option-count]")?.textContent || 0);
        const price = Number(option.dataset.optionPrice || 0);
        return count > 0 ? { label: `${option.dataset.optionValue} x${count}`, price: price * count } : null;
      })
      .filter(Boolean);
    return [...selectedInputs, ...selectedCounters];
  };

  const updateProductTotal = () => {
    const optionsTotal = getSelectedOptionsSummary().reduce((sum, option) => sum + option.price, 0);
    const total = ((productState.product?.price || 0) + optionsTotal) * productState.quantity;
    productModal.querySelector(".codex-product-add").textContent = `Agregar ${formatCurrency(total)}`;
  };

  const renderCart = () => {
    const cart = readCart();
    const count = cartCount(cart);
    const productsTotal = cartOriginalTotal(cart);
    const subtotal = cartTotal(cart);
    const discount = Math.max(productsTotal - subtotal, 0);

    badgeNodes.forEach((node) => {
      node.textContent = count;
    });
    titleCount.textContent = `(${count})`;
    timeLabel.textContent = getOrderTimeLabel();
    cartOrderLabel.textContent = getOrderContextLabel();
    productsValue.textContent = formatCurrency(productsTotal);
    discountValue.textContent = `- ${formatCurrency(discount)}`;
    totalValue.textContent = formatCurrency(subtotal);
    checkoutProductsValue.textContent = formatCurrency(productsTotal);
    checkoutDiscountValue.textContent = `- ${formatCurrency(discount)}`;
    checkoutTotalValue.textContent = formatCurrency(subtotal);
    checkoutPoints.textContent = `Con esta compra acumularás ${calculateNekiPoints(subtotal)} Neki Puntos`;
    syncOrderUI();

    if (!cart.length) {
      list.innerHTML = `<div class="codex-cart-empty">Tu carrito está vacío. Usa los botones + para añadir productos.</div>`;
      return;
    }

    list.innerHTML = cart
      .map(
        (item) => `
          <article class="codex-cart-item" data-cart-id="${item.id}">
            <img class="codex-cart-item-image" src="${item.image || ""}" alt="${item.name}" loading="lazy" />
            <div class="codex-cart-item-main">
              <h4>${item.name}</h4>
              <div class="codex-cart-qty">
                <button type="button" data-action="decrease" aria-label="Quitar producto">🗑</button>
                <span>${item.quantity}</span>
                <button type="button" data-action="increase" aria-label="Agregar otro">+</button>
              </div>
            </div>
            <div class="codex-cart-item-side">
              <div class="codex-cart-prices">
                <strong>${formatCurrency(item.price * item.quantity)}</strong>
                ${
                  (item.originalPrice || item.price) > item.price
                    ? `<span>${formatCurrency(item.originalPrice * item.quantity)}</span>`
                    : ""
                }
              </div>
              <button class="codex-cart-edit" type="button" data-action="edit">Editar</button>
            </div>
          </article>
        `
      )
      .join("");

    checkoutItems.innerHTML = cart
      .map(
        (item) => `
          <article class="codex-checkout-item">
            <div>
              <h5>${item.name}</h5>
              <p>${item.description || item.name}</p>
            </div>
            <div class="codex-checkout-item-prices">
              <strong>${formatCurrency(item.price * item.quantity)}</strong>
              ${
                (item.originalPrice || item.price) > item.price
                  ? `<span>${formatCurrency(item.originalPrice * item.quantity)}</span>`
                  : ""
              }
            </div>
          </article>
        `
      )
      .join("");

    const orderContext = readOrderContext();
    drawer.querySelector(".codex-checkout-delivery").innerHTML = `
      <button class="codex-cart-order" type="button">
        <span>${getOrderContextLabel()}</span>
        <span aria-hidden="true">⌄</span>
      </button>
      <p class="codex-checkout-copy">${orderContext?.type === "pickup" ? "Para llevar" : "Delivery"}</p>
    `;
  };

  const openCart = () => {
    overlay.hidden = false;
    drawer.hidden = false;
    setCartView("cart");
    renderCart();
  };

  const closeCart = () => {
    overlay.hidden = true;
    drawer.hidden = true;
  };

  const closeProductModal = () => {
    productOverlay.hidden = true;
    productModal.hidden = true;
  };

  const populateProductModal = (product) => {
    productState.product = normalizeProductForModal(product);
    productState.quantity = 1;
    productModal.querySelector(".codex-product-image").src = productState.product.image || "";
    productModal.querySelector(".codex-product-image").alt = productState.product.name;
    productModal.querySelector(".codex-product-name").textContent = productState.product.name;
    productModal.querySelector(".codex-product-description").textContent =
      productState.product.description || "Elige la cantidad antes de agregarlo al carrito.";
    productModal.querySelector(".codex-product-kicker").textContent = productState.product.category || "Mr. Sushi";
    productModal.querySelector(".codex-product-price").textContent = formatCurrency(productState.product.price);
    const oldPrice = productModal.querySelector(".codex-product-old-price");
    oldPrice.textContent =
      productState.product.originalPrice > productState.product.price
        ? formatCurrency(productState.product.originalPrice)
        : "";
    productModal.querySelector(".codex-product-qty-value").textContent = productState.quantity;
    renderProductOptionGroups(productModal, productState.product);
    updateProductTotal();
  };

  const openProductModal = (product) => {
    populateProductModal(product);
    productOverlay.hidden = false;
    productModal.hidden = false;
  };

  const updateProductQuantity = (quantity) => {
    productState.quantity = Math.max(1, quantity);
    productModal.querySelector(".codex-product-qty-value").textContent = productState.quantity;
    updateProductTotal();
  };

  const validateProductOptions = (showMessages = false) => {
    let valid = true;
    productModal.querySelectorAll(".codex-product-option-group").forEach((group) => {
      const min = Number(group.dataset.min || 0);
      const max = Number(group.dataset.max || 99);
      const checked =
        group.querySelectorAll(".codex-product-counter-option").length
          ? [...group.querySelectorAll("[data-option-count]")].reduce((sum, node) => sum + Number(node.textContent || 0), 0)
          : group.querySelectorAll("input:checked").length;
      const message = group.querySelector(".codex-product-limit-message");
      group.classList.toggle("has-error", checked < min);

      if (checked < min) {
        valid = false;
        if (showMessages) message.textContent = `Te falta escoger ${min - checked} opción${min - checked === 1 ? "" : "es"}.`;
      } else if (checked > max) {
        valid = false;
        if (showMessages) message.textContent = `Máximo ${max} opción${max === 1 ? "" : "es"}.`;
      } else {
        message.textContent = "";
      }
    });
    return valid;
  };

  renderProfileButtons();

  cartButtons.forEach((button) => button.addEventListener("click", openCart));
  profileButtons.forEach((button) => button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!readAuthSession()) {
      openAuthModal("login");
      return;
    }
    toggleProfileMenu(button);
  }));
  profileMenu.addEventListener("click", (event) => {
    event.stopPropagation();
    const actionButton = event.target.closest("[data-profile-action]");
    if (!actionButton) return;

    if (actionButton.dataset.profileAction === "logout") {
      localStorage.removeItem(AUTH_SESSION_KEY);
      closeProfileMenu();
      renderProfileButtons();
      return;
    }

    openAccountPanel(actionButton.dataset.profileAction);
  });
  document.addEventListener("click", closeProfileMenu);
  overlay.addEventListener("click", closeCart);
  productOverlay.addEventListener("click", closeProductModal);
  authOverlay.addEventListener("click", closeAuthModal);
  accountOverlay.addEventListener("click", closeAccountPanel);
  accountPanel.querySelector(".codex-account-close").addEventListener("click", closeAccountPanel);
  productModal.querySelector(".codex-product-close").addEventListener("click", closeProductModal);
  authModal.querySelector(".codex-auth-close").addEventListener("click", closeAuthModal);
  authModal.querySelector(".codex-auth-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-tab]");
    if (!button) return;
    setAuthTab(button.dataset.authTab);
  });
  authModal.querySelectorAll("[data-auth-switch]").forEach((button) => {
    button.addEventListener("click", () => setAuthTab(button.dataset.authSwitch));
  });
  authModal.querySelectorAll(".codex-auth-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const status = authModal.querySelector(".codex-auth-status");
      const formData = new FormData(form);
      const identity =
        formData.get("email") ||
        formData.get("identity") ||
        formData.get("name") ||
        "Cliente Mr. Sushi";
      const identityText = String(identity).trim();
      const fallbackName = identityText.includes("@")
        ? identityText.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
        : identityText;
      const email = String(formData.get("email") || (identityText.includes("@") ? identityText : "") || "francis.huerta.roque@gmail.com").trim();

      const password = String(formData.get("password") || formData.get("new-password") || "").trim();
      const name = String(formData.get("name") || fallbackName || "Cliente Mr. Sushi").trim();
      const phone = String(formData.get("phone") || "").trim();

      if (!email || !password) {
        status.textContent = "Ingresa correo y contraseña.";
        return;
      }

      status.textContent = "Conectando con Mr. Sushi...";

      try {
        const data = form.dataset.authForm === "register"
          ? await customerApi.register({ name, email, phone, password })
          : await customerApi.login({ email, password });
        const session = normalizeClientSession(data, { email, name, phone, nekiPoints: getNekiPointsBalance() });
        saveAuthSession(session);
        localStorage.setItem(NEKI_POINTS_KEY, String(session.nekiPoints || 0));
        renderProfileButtons();

        status.textContent =
          form.dataset.authForm === "register"
            ? "Cuenta creada correctamente."
            : "Sesión iniciada correctamente.";

        window.setTimeout(() => {
          closeAuthModal();
          if (continueAfterAuth) {
            continueAfterAuth = false;
            window.location.href = "checkout.html";
          }
        }, 350);
      } catch (error) {
        status.textContent = error.message || "No se pudo iniciar sesión.";
      }
    });
  });
  productModal.querySelector(".codex-product-options").addEventListener("change", (event) => {
    const input = event.target.closest("input");
    const group = event.target.closest(".codex-product-option-group");
    if (!input || !group) return;

    const max = Number(group.dataset.max || 99);
    const checked = group.querySelectorAll("input:checked");
    const message = group.querySelector(".codex-product-limit-message");

    if (input.type === "checkbox" && checked.length > max) {
      input.checked = false;
      message.textContent = `Solo puedes escoger ${max} opción${max === 1 ? "" : "es"} en esta sección.`;
      group.classList.add("has-error");
      return;
    }

    validateProductOptions(false);
    updateProductTotal();
  });
  productModal.querySelector(".codex-product-options").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-option-action]");
    if (!button) return;
    const option = button.closest(".codex-product-counter-option");
    const group = button.closest(".codex-product-option-group");
    const countNode = option.querySelector("[data-option-count]");
    const max = Number(group.dataset.max || 99);
    const message = group.querySelector(".codex-product-limit-message");
    const current = Number(countNode.textContent || 0);
    const total = [...group.querySelectorAll("[data-option-count]")].reduce(
      (sum, node) => sum + Number(node.textContent || 0),
      0
    );

    if (button.dataset.optionAction === "increase") {
      if (total >= max) {
        message.textContent = `Llegaste al máximo de ${max} en esta sección.`;
        group.classList.add("has-error");
        return;
      }
      countNode.textContent = current + 1;
    } else {
      countNode.textContent = Math.max(0, current - 1);
    }

    message.textContent = "";
    group.classList.remove("has-error");
    const nextTotal = [...group.querySelectorAll("[data-option-count]")].reduce(
      (sum, node) => sum + Number(node.textContent || 0),
      0
    );
    group.querySelectorAll("[data-option-action='increase']").forEach((node) => {
      node.disabled = nextTotal >= max;
    });
    validateProductOptions(false);
    updateProductTotal();
  });
  productModal.querySelector(".codex-product-qty").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-product-action]");
    if (!button) return;
    updateProductQuantity(
      button.dataset.productAction === "increase"
        ? productState.quantity + 1
        : productState.quantity - 1
    );
  });
  productModal.querySelector(".codex-product-add").addEventListener("click", () => {
    if (!productState.product) return;
    if (!validateProductOptions(true)) return;

    const selectedOptionSummaries = getSelectedOptionsSummary();
    const selectedOptions = selectedOptionSummaries.map((option) => option.label);
    const extraPrice = selectedOptionSummaries.reduce((sum, option) => sum + option.price, 0);
    const product = {
      ...productState.product,
      id: `${productState.product.id}|${selectedOptions.join(",")}`,
      price: (productState.product.price || 0) + extraPrice,
      description: [productState.product.description, selectedOptions.join(", ")].filter(Boolean).join(" · "),
      options: selectedOptions
    };

    upsertItem(product, productState.quantity);
    renderCart();
    closeProductModal();
    openCart();
  });
  drawer.querySelector(".codex-cart-close").addEventListener("click", closeCart);
  drawer.querySelector(".codex-cart-order").addEventListener("click", () => {
    closeCart();
    document.querySelector(".codex-order-trigger")?.click();
  });

  const openTimeModal = () => {
    renderSchedulePicker(timeModal);
    timeOverlay.hidden = false;
    timeModal.hidden = false;
  };

  const closeTimeModal = () => {
    timeOverlay.hidden = true;
    timeModal.hidden = true;
  };

  drawer.querySelector(".codex-cart-time").addEventListener("click", openTimeModal);
  timeOverlay.addEventListener("click", closeTimeModal);
  timeModal.querySelector(".codex-time-close").addEventListener("click", closeTimeModal);

  timeModal.querySelector(".codex-time-days").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    timeModal.querySelectorAll(".codex-time-days button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    const store = getStoreForSchedule();
    const days = buildScheduleDays(store);
    const day = days.find((item) => item.key === button.dataset.day) || days[0];
    const slots = buildScheduleSlots(day, store);
    const slotsContainer = timeModal.querySelector(".codex-time-slots");

    if (!slots.length) {
      slotsContainer.innerHTML = `<div class="codex-time-empty">Este local ya no tiene horarios disponibles para ${day.label.toLowerCase()}.</div>`;
      return;
    }

    slotsContainer.innerHTML = slots
      .map((slot, index) => `
        <button class="${index === 0 ? "is-active" : ""}" type="button" data-time-label="${slot.label}" data-time-value="${slot.value}" data-iso-date="${slot.isoDate}" data-store-id="${slot.storeId}">
          ${slot.text}
        </button>
      `)
      .join("");
  });

  timeModal.querySelector(".codex-time-slots").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    timeModal.querySelectorAll(".codex-time-slots button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    saveOrderTime({
      isoDate: button.dataset.isoDate,
      storeId: button.dataset.storeId,
      label: button.dataset.timeLabel,
      value: button.dataset.timeValue
    });
    renderCart();
    syncOrderUI();
    closeTimeModal();
  });

  drawer.querySelector(".codex-cart-continue").addEventListener("click", async () => {
    const cart = readCart();
    const orderContext = readOrderContext();
    const authSession = readAuthSession();
    const note = drawer.querySelector(".codex-cart-note");

    if (!cart.length) {
      note.textContent = "Agrega productos al carrito antes de continuar.";
      return;
    }

    if (!orderContext) {
      note.textContent = "Ingresa tu dirección o selecciona un local para continuar.";
      document.querySelector(".codex-order-trigger")?.click();
      return;
    }

    if (!authSession) {
      continueAfterAuth = true;
      openAuthModal("login");
      authModal.querySelector(".codex-auth-status").textContent =
        "Por favor, crea tu cuenta o inicia sesión para continuar.";
      return;
    }

    window.location.href = "checkout.html";
  });

  drawer.querySelector(".codex-checkout-back").addEventListener("click", () => setCartView("cart"));
  drawer.querySelector(".codex-cart-pay").addEventListener("click", async () => {
    const email = drawer.querySelector(".codex-checkout-email")?.value.trim();
    const cart = readCart();
    const orderContext = readOrderContext();
    if (!email) {
      checkoutNote.textContent = "Por favor completa los campos requeridos en: Contacto";
      return;
    }
    if (orderContext?.type === "delivery" && !(orderContext.coordinates?.latitude && orderContext.coordinates?.longitude)) {
      checkoutNote.textContent = "Aún no pudimos ubicar tu dirección. Comparte tu ubicación antes de pagar.";
      return;
    }
    checkoutNote.textContent = "Conectando con AWS...";
    try {
      const order = await orderApi.createOrder({
        customerId: readAuthSession()?.customerId || readAuthSession()?.clienteId || null,
        origin: "WEB",
        channel: "web",
        currency: "PEN",
        contact: { email },
        items: cart,
        cart,
        total: cartTotal(cart),
        totals: {
          products: cartOriginalTotal(cart),
          discounts: Math.max(cartOriginalTotal(cart) - cartTotal(cart), 0),
          subtotal: cartTotal(cart)
        },
        fulfillment: orderContext,
        requestedTime: readOrderTime()
      });
      checkoutNote.textContent = `Pedido creado${order.orderId ? `: ${order.orderId}` : " correctamente"}.`;
    } catch {
      checkoutNote.textContent = "No se pudo crear el pedido. Revisa /pedidos en AWS.";
    }
  });

  list.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    const item = event.target.closest("[data-cart-id]");
    if (!button || !item || button.dataset.action === "edit") return;

    const current = readCart().find((entry) => entry.id === item.dataset.cartId);
    if (!current) return;

    setQuantity(
      current.id,
      button.dataset.action === "increase" ? current.quantity + 1 : current.quantity - 1
    );
    renderCart();
  });

  extractProducts().forEach((product) => {
    const productLink = product.card.querySelector("a[href]");
    if (productLink) {
      productLink.href = `#producto-${encodeURIComponent(product.name.toLowerCase().replace(/\s+/g, "-"))}`;
      productLink.setAttribute("role", "button");
    }

    productLink?.addEventListener("click", (event) => {
      event.preventDefault();
      openProductModal(product);
    });

    const pulse = product.card.querySelector(".animate-pulse.bg-primary.absolute.rounded-full");
    if (!pulse) return;

    const addButton = document.createElement("button");
    addButton.type = "button";
    addButton.className = "codex-add-button";
    addButton.setAttribute("aria-label", `Agregar ${product.name} al carrito`);
    addButton.textContent = "+";
    addButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      upsertItem(product, 1);
      renderCart();
    });

    pulse.replaceWith(addButton);
  });

  document.querySelector(".codex-neki-points-button")?.addEventListener("click", () => openAuthModal("register"));

  renderCart();

  const searchParams = new URLSearchParams(window.location.search);
  if (searchParams.get("openOrders") === "1") {
    window.history.replaceState({}, "", window.location.pathname);
    openAccountPanel("orders");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initOrderMode();
  initCategoryBar();
  initNekiPointsBanner();
  initCart();
});
