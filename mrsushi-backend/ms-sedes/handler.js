const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, ScanCommand } = require("@aws-sdk/lib-dynamodb");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET",
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: headers(),
    body: JSON.stringify(body),
  };
}

function publicSede(sede) {
  return {
    sedeId: sede.sedeId,
    nombre: sede.nombre,
    direccion: sede.direccion,
    telefono: sede.telefono,
    lat: sede.lat,
    lng: sede.lng,
    coverageRadius: sede.coverageRadius,
    activo: sede.activo !== false,
  };
}

module.exports.listarSedes = async () => {
  const result = await dynamo.send(new ScanCommand({
    TableName: process.env.SEDES_TABLE,
  }));

  const items = (result.Items || [])
    .filter((sede) => sede.activo !== false)
    .map(publicSede)
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return response(200, { items, count: items.length });
};
