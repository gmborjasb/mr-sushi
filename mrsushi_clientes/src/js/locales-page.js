import { stores, haversineDistance, sortStoresByDistance } from "../data/stores.js";

const mapElement = document.getElementById("stores-map");
const cardsElement = document.getElementById("stores-list");
const addressForm = document.getElementById("address-form");
const addressInput = document.getElementById("address-input");
const statusElement = document.getElementById("address-status");
const locationButton = document.getElementById("detect-location");
const resetButton = document.getElementById("reset-locations");
const menuToggle = document.getElementById("mobile-menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");

const initialCenter = [-12.0665, -77.0432];
const markerById = new Map();
let userLocationMarker = null;
let userCoverageCircle = null;
let map;

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toFixed(1)} km`;
}

function markerHtml(label) {
  return `
    <div class="store-pin">
      <span class="store-pin__dot"></span>
      <span class="store-pin__label">${label}</span>
    </div>
  `;
}

function storePopup(store) {
  return `
    <div class="popup-card">
      <strong>${store.name}</strong>
      <p>${store.address}</p>
      <a href="tel:${store.phone}">${store.phone}</a>
    </div>
  `;
}

function renderStores(list, userLocation) {
  cardsElement.innerHTML = list
    .map((store) => {
      const distance = userLocation
        ? formatDistance(haversineDistance(userLocation, store))
        : "";
      const hours = store.hours.map((item) => `<li>${item}</li>`).join("");
      const distanceBadge = distance
        ? `<div class="store-card__eyebrow">${distance}</div>`
        : "";

      return `
        <article class="store-card" data-store-id="${store.id}">
          ${distanceBadge}
          <h3>${store.name}</h3>
          <p class="store-card__address">${store.address}</p>
          <a class="store-card__phone" href="tel:${store.phone}">${store.phone}</a>
          <ul class="store-card__hours">${hours}</ul>
          <button class="store-card__button" type="button" data-map-target="${store.id}">
            Ver en mapa
          </button>
        </article>
      `;
    })
    .join("");
}

function focusStore(storeId) {
  const marker = markerById.get(storeId);
  const store = stores.find((item) => item.id === storeId);

  if (!marker || !store) {
    return;
  }

  map.flyTo([store.lat, store.lng], 14, { duration: 0.8 });
  marker.openPopup();
}

function updateActiveCard(storeId) {
  document.querySelectorAll(".store-card").forEach((card) => {
    card.classList.toggle("is-active", card.dataset.storeId === storeId);
  });
}

function applyOrdering(userLocation) {
  const orderedStores = userLocation
    ? sortStoresByDistance(userLocation, stores)
    : stores;

  renderStores(orderedStores, userLocation);
}

function showUserLocation(userLocation, label) {
  if (userLocationMarker) {
    userLocationMarker.remove();
  }

  if (userCoverageCircle) {
    userCoverageCircle.remove();
  }

  userLocationMarker = L.circleMarker([userLocation.lat, userLocation.lng], {
    radius: 8,
    color: "#ffffff",
    weight: 2,
    fillColor: "#fb2301",
    fillOpacity: 1
  })
    .addTo(map)
    .bindPopup(label);

  userCoverageCircle = L.circle([userLocation.lat, userLocation.lng], {
    radius: 650,
    color: "#fb2301",
    weight: 1.5,
    fillColor: "#fb2301",
    fillOpacity: 0.08
  }).addTo(map);
}

async function geocodeAddress(query) {
  const endpoint = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=pe&q=${encodeURIComponent(query)}`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("No se pudo consultar la dirección.");
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error("No encontramos esa dirección. Intenta con más detalle.");
  }

  return {
    lat: Number(results[0].lat),
    lng: Number(results[0].lon),
    label: results[0].display_name
  };
}

function initMap() {
  map = L.map(mapElement, {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView(initialCenter, 11);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors"
  }).addTo(map);

  stores.forEach((store, index) => {
    const marker = L.marker([store.lat, store.lng], {
      icon: L.divIcon({
        className: "store-marker",
        html: markerHtml(index + 1),
        iconSize: [42, 42],
        iconAnchor: [21, 42],
        popupAnchor: [0, -32]
      })
    })
      .addTo(map)
      .bindPopup(storePopup(store));

    marker.on("click", () => updateActiveCard(store.id));

    markerById.set(store.id, marker);

    L.circle([store.lat, store.lng], {
      radius: store.coverageRadius,
      color: "#000000",
      weight: 2,
      fillColor: "#111111",
      fillOpacity: 0.22
    }).addTo(map);
  });
}

cardsElement.addEventListener("click", (event) => {
  const trigger = event.target.closest("[data-map-target]");

  if (!trigger) {
    return;
  }

  const { mapTarget } = trigger.dataset;
  focusStore(mapTarget);
  updateActiveCard(mapTarget);
});

addressForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = addressInput.value.trim();

  if (!query) {
    statusElement.textContent = "Ingresa una dirección para buscar el local más cercano.";
    return;
  }

  statusElement.textContent = "Buscando dirección en Lima...";

  try {
    const result = await geocodeAddress(query);
    const userLocation = { lat: result.lat, lng: result.lng };
    const nearest = sortStoresByDistance(userLocation, stores)[0];

    applyOrdering(userLocation);
    showUserLocation(userLocation, result.label);
    map.flyTo([userLocation.lat, userLocation.lng], 13, { duration: 0.8 });
    statusElement.textContent = `Tu local más cercano es ${nearest.name}.`;
    updateActiveCard(nearest.id);
  } catch (error) {
    statusElement.textContent = error.message;
  }
});

locationButton.addEventListener("click", () => {
  if (!navigator.geolocation) {
    statusElement.textContent = "Tu navegador no permite detectar ubicación.";
    return;
  }

  statusElement.textContent = "Detectando tu ubicación...";

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const userLocation = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      const nearest = sortStoresByDistance(userLocation, stores)[0];

      applyOrdering(userLocation);
      showUserLocation(userLocation, "Tu ubicación aproximada");
      map.flyTo([userLocation.lat, userLocation.lng], 13, { duration: 0.8 });
      statusElement.textContent = `Tu local más cercano es ${nearest.name}.`;
      updateActiveCard(nearest.id);
    },
    () => {
      statusElement.textContent = "No pudimos acceder a tu ubicación. Puedes escribir tu dirección.";
    },
    {
      enableHighAccuracy: true,
      timeout: 10000
    }
  );
});

resetButton.addEventListener("click", () => {
  addressInput.value = "";
  statusElement.textContent = "Mostrando todos los locales disponibles.";
  applyOrdering(null);
  updateActiveCard("");

  if (userLocationMarker) {
    userLocationMarker.remove();
    userLocationMarker = null;
  }

  if (userCoverageCircle) {
    userCoverageCircle.remove();
    userCoverageCircle = null;
  }

  map.flyTo(initialCenter, 11, { duration: 0.8 });
});

if (menuToggle && mobileMenu) {
  menuToggle.addEventListener("click", () => {
    const isOpen = menuToggle.getAttribute("aria-expanded") === "true";
    menuToggle.setAttribute("aria-expanded", String(!isOpen));
    mobileMenu.hidden = isOpen;
  });
}

initMap();
applyOrdering(null);
