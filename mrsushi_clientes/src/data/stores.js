export const stores = [
  {
    id: "la-marina",
    name: "Mr. Sushi - La Marina",
    address: "Avenida de la Marina 2530, San Miguel, Perú",
    phone: "+51989585587",
    hours: ["Lunes a Domingo: 10:00 ― 22:30"],
    lat: -12.077449,
    lng: -77.093525,
    coverageRadius: 5200
  },
  {
    id: "mall-del-sur",
    name: "Mr. Sushi - Mall del Sur",
    address: "Avenida Pedro Miotta 1011, San Juan de Miraflores, Perú",
    phone: "+51945642599",
    hours: ["Lunes a Domingo: 11:30 ― 21:45"],
    lat: -12.1633838,
    lng: -76.9792485,
    coverageRadius: 5600
  },
  {
    id: "espinar",
    name: "Mr. Sushi - Espinar",
    address: "Avenida Comandante Espinar 320, Miraflores, Perú",
    phone: "+51989187503",
    hours: ["Lunes a Domingo: 11:00 ― 21:45"],
    lat: -12.116640090942383,
    lng: -77.03673553466797,
    coverageRadius: 5400
  },
  {
    id: "mega-plaza",
    name: "Mr. Sushi - Mega Plaza",
    address: "Avenida Alfredo Mendiola 3698, San Martín de Porres, Perú",
    phone: "+51976329072",
    hours: ["Lunes a Domingo: 11:00 ― 21:30"],
    lat: -11.99337100982666,
    lng: -77.06114959716797,
    coverageRadius: 6000
  },
  {
    id: "minka",
    name: "Mr. Sushi - Minka",
    address: "Avenida Argentina 3093, Callao, Perú",
    phone: "+51921317829",
    hours: ["Lunes a Domingo: 10:00 ― 21:45"],
    lat: -12.04807186126709,
    lng: -77.11221313476562,
    coverageRadius: 6200
  },
  {
    id: "rambla-brena",
    name: "Mr. Sushi - Rambla Breña",
    address: "Avenida Brasil 778, Lima, Perú",
    phone: "+51956385918",
    hours: ["Lunes a Domingo: 11:30 ― 21:45"],
    lat: -12.066265106201172,
    lng: -77.04737854003906,
    coverageRadius: 5600
  },
  {
    id: "surquillo",
    name: "Mr. Sushi - Surquillo",
    address: "Calle Dos 136, Lima, Perú",
    phone: "+51946840548",
    hours: [
      "Lunes, Martes, Miércoles, Jueves, Viernes y Domingo: 10:00 ― 21:45",
      "Sábado: 10:00 ― 21:45 y 11:45 ― 12:15"
    ],
    lat: -12.110722541809082,
    lng: -77.01004791259766,
    coverageRadius: 5800
  },
  {
    id: "plaza-norte",
    name: "Mr. Sushi - Plaza Norte",
    address: "Avenida Alfredo Mendiola 1400, San Martín de Porres, Perú",
    phone: "+51989187465",
    hours: ["Lunes a Domingo: 10:30 ― 21:30"],
    lat: -12.006979942321777,
    lng: -77.05873107910156,
    coverageRadius: 6000
  }
];

export function haversineDistance(from, to) {
  const earthRadius = 6371000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function sortStoresByDistance(userLocation, list = stores) {
  return [...list].sort(
    (a, b) =>
      haversineDistance(userLocation, a) - haversineDistance(userLocation, b)
  );
}
