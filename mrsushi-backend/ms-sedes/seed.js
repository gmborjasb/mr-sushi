// Script de una sola vez: siembra las 8 sedes conocidas en MrSushiSedes.
// Uso: node seed.js
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient({ region: "us-east-1" }));

const sedes = [
  { sedeId: "la-marina", nombre: "Mr. Sushi - La Marina", direccion: "Avenida de la Marina 2530, San Miguel, Perú", telefono: "+51989585587", lat: -12.077449, lng: -77.093525, coverageRadius: 5200 },
  { sedeId: "mall-del-sur", nombre: "Mr. Sushi - Mall del Sur", direccion: "Avenida Pedro Miotta 1011, San Juan de Miraflores, Perú", telefono: "+51945642599", lat: -12.1633838, lng: -76.9792485, coverageRadius: 5600 },
  { sedeId: "espinar", nombre: "Mr. Sushi - Espinar", direccion: "Avenida Comandante Espinar 320, Miraflores, Perú", telefono: "+51989187503", lat: -12.116640090942383, lng: -77.03673553466797, coverageRadius: 5400 },
  { sedeId: "mega-plaza", nombre: "Mr. Sushi - Mega Plaza", direccion: "Avenida Alfredo Mendiola 3698, San Martín de Porres, Perú", telefono: "+51976329072", lat: -11.99337100982666, lng: -77.06114959716797, coverageRadius: 6000 },
  { sedeId: "minka", nombre: "Mr. Sushi - Minka", direccion: "Avenida Argentina 3093, Callao, Perú", telefono: "+51921317829", lat: -12.04807186126709, lng: -77.11221313476562, coverageRadius: 6200 },
  { sedeId: "rambla-brena", nombre: "Mr. Sushi - Rambla Breña", direccion: "Avenida Brasil 778, Lima, Perú", telefono: "+51956385918", lat: -12.066265106201172, lng: -77.04737854003906, coverageRadius: 5600 },
  { sedeId: "surquillo", nombre: "Mr. Sushi - Surquillo", direccion: "Calle Dos 136, Lima, Perú", telefono: "+51946840548", lat: -12.110722541809082, lng: -77.01004791259766, coverageRadius: 5800 },
  { sedeId: "plaza-norte", nombre: "Mr. Sushi - Plaza Norte", direccion: "Avenida Alfredo Mendiola 1400, San Martín de Porres, Perú", telefono: "+51989187465", lat: -12.006979942321777, lng: -77.05873107910156, coverageRadius: 6000 }
];

(async () => {
  const now = new Date().toISOString();
  for (const sede of sedes) {
    await dynamo.send(new PutCommand({
      TableName: "MrSushiSedes",
      Item: { ...sede, activo: true, createdAt: now, updatedAt: now },
    }));
    console.log("seeded", sede.sedeId);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
