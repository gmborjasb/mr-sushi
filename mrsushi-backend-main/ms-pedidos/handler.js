const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
} = require("@aws-sdk/lib-dynamodb");
const { SFNClient, StartExecutionCommand } = require("@aws-sdk/client-sfn");
const { v4: uuidv4 } = require("uuid");
const jwt = require("jsonwebtoken");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
const sfn = new SFNClient();

const STAFF_ROLES = new Set(["ADMIN", "COCINERO", "DESPACHADOR", "REPARTIDOR"]);

function headers() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Allow-Methods": "OPTIONS,GET,POST,PUT,PATCH,DELETE",
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: headers(),
    body: JSON.stringify(body),
  };
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch {
    return {};
  }
}

function verifyToken(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

function isClienteToken(payload) {
  return Boolean(payload) && (payload.tipo === "CLIENTE" || payload.rol === "CLIENTE");
}

function isStaffToken(payload) {
  return Boolean(payload) && STAFF_ROLES.has(payload.rol) && Boolean(payload.sedeId);
}

function pedidoKey(sedeId, pedidoId) {
  return { sedeId, pedidoId };
}

function normalizePedido(item) {
  if (!item) return null;
  return {
    ...item,
    orderId: item.orderId || item.pedidoId,
    status: item.status || item.estado,
    estado: item.estado || item.status,
  };
}

const EARTH_RADIUS_M = 6371000;

function haversineDistance(a, b) {
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function getSede(sedeId) {
  const result = await dynamo.send(new GetCommand({
    TableName: process.env.SEDES_TABLE,
    Key: { sedeId },
  }));
  return result.Item;
}

async function listActiveSedes() {
  const result = await dynamo.send(new ScanCommand({ TableName: process.env.SEDES_TABLE }));
  return (result.Items || []).filter((sede) => sede.activo !== false);
}

// Resuelve y valida a qué sede pertenece un pedido. Nunca confía en un sedeId
// mandado por el cliente: para pickup valida la sede elegida contra la tabla
// de sedes, y para delivery calcula la sede más cercana en el propio backend.
async function resolveSede(fulfillment) {
  if (!fulfillment || !fulfillment.type) {
    return { error: "Falta seleccionar sede o dirección de entrega" };
  }

  if (fulfillment.type === "pickup") {
    const storeId = fulfillment.store?.id;
    if (!storeId) return { error: "Falta seleccionar la sede de recojo" };
    const sede = await getSede(storeId);
    if (!sede || sede.activo === false) return { error: "La sede seleccionada no existe o no está activa" };
    return { sedeId: storeId };
  }

  if (fulfillment.type === "delivery") {
    const lat = Number(fulfillment.coordinates?.latitude ?? fulfillment.coordinates?.lat);
    const lng = Number(fulfillment.coordinates?.longitude ?? fulfillment.coordinates?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { error: "Falta la ubicación para calcular la sede que atiende tu entrega" };
    }

    const sedes = await listActiveSedes();
    let closest = null;
    let closestDistance = Infinity;
    for (const sede of sedes) {
      const distance = haversineDistance({ lat, lng }, { lat: sede.lat, lng: sede.lng });
      if (distance < closestDistance) {
        closestDistance = distance;
        closest = sede;
      }
    }

    if (!closest || closestDistance > closest.coverageRadius) {
      return { error: "Tu dirección está fuera de la cobertura de todas nuestras sedes" };
    }

    return { sedeId: closest.sedeId };
  }

  return { error: "Tipo de entrega inválido" };
}

async function nextNumeroTurno(sedeId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await dynamo.send(new UpdateCommand({
    TableName: process.env.CONTADORES_TABLE,
    Key: { sedeId, fecha: today },
    UpdateExpression: "ADD contador :inc",
    ExpressionAttributeValues: { ":inc": 1 },
    ReturnValues: "UPDATED_NEW",
  }));
  return result.Attributes.contador;
}

module.exports.crearPedido = async (event) => {
  const body = parseBody(event);
  const auth = verifyToken(event);
  const items = Array.isArray(body.items) ? body.items : Array.isArray(body.cart) ? body.cart : [];
  const total = Number(body.total ?? body.totals?.subtotal ?? body.totals?.total ?? 0);
  const contact = body.contact || body.contacto || null;
  const fulfillment = body.fulfillment || body.entrega || null;

  if (!Array.isArray(items) || items.length === 0) {
    return response(400, { message: "El pedido debe tener productos" });
  }

  const customerId = isClienteToken(auth)
    ? (auth.clienteId || auth.customerId)
    : (body.customerId || body.clienteId || body.id_cliente || contact?.clienteId || null);

  const { sedeId, error } = await resolveSede(fulfillment);
  if (error) {
    return response(400, { message: error });
  }

  const pedidoId = uuidv4();
  const createdAt = new Date().toISOString();
  const numero_turno = body.numero_turno || await nextNumeroTurno(sedeId);
  const esRecojo = fulfillment.type === "pickup";

  const item = normalizePedido({
    ...pedidoKey(sedeId, pedidoId),
    orderId: pedidoId,
    // clienteId es la clave de la GSI ClienteIndex: solo se incluye cuando hay
    // un cliente real, porque DynamoDB rechaza escribir NULL en un atributo de GSI.
    ...(customerId ? { clienteId: customerId } : {}),
    customerId,
    origin: body.origin || body.origen || "WEB",
    status: "RECEIVED",
    items,
    total,
    contact,
    fulfillment,
    paymentMethod: body.paymentMethod || null,
    nekiDiscount: body.nekiDiscount || null,
    requestedTime: body.requestedTime || null,
    totals: body.totals || null,
    numero_turno,
    createdAt,
    updatedAt: createdAt,
  });

  await dynamo.send(new PutCommand({
    TableName: process.env.PEDIDOS_TABLE,
    Item: item,
  }));

  await sfn.send(new StartExecutionCommand({
    stateMachineArn: process.env.STATE_MACHINE_ARN,
    name: `pedido-${pedidoId}`,
    input: JSON.stringify({
      pedidoId,
      orderId: pedidoId,
      sedeId,
      origin: item.origin,
      esRecojo,
    }),
  }));

  return response(201, {
    message: "Pedido creado",
    pedidoId,
    orderId: pedidoId,
    sedeId,
    numero_turno,
    estado: item.estado,
  });
};

module.exports.obtenerPedido = async (event) => {
  const auth = verifyToken(event);
  if (!isStaffToken(auth)) {
    return response(401, { message: "No autorizado" });
  }

  const pedidoId = event.pathParameters?.pedidoId || event.pathParameters?.orderId;
  const result = await dynamo.send(new GetCommand({
    TableName: process.env.PEDIDOS_TABLE,
    Key: pedidoKey(auth.sedeId, pedidoId),
  }));

  if (!result.Item) {
    return response(404, { message: "Pedido no encontrado" });
  }

  return response(200, normalizePedido(result.Item));
};

module.exports.listarPedidos = async (event = {}) => {
  const auth = verifyToken(event);
  const params = event.queryStringParameters || {};
  const status = params.status || params.estado;

  let items;

  if (isClienteToken(auth)) {
    const clienteId = auth.clienteId || auth.customerId;
    const result = await dynamo.send(new QueryCommand({
      TableName: process.env.PEDIDOS_TABLE,
      IndexName: "ClienteIndex",
      KeyConditionExpression: "clienteId = :clienteId",
      ExpressionAttributeValues: { ":clienteId": clienteId },
    }));
    items = result.Items || [];
  } else if (isStaffToken(auth)) {
    const result = await dynamo.send(new QueryCommand({
      TableName: process.env.PEDIDOS_TABLE,
      IndexName: "SedeCreatedIndex",
      KeyConditionExpression: "sedeId = :sedeId",
      ExpressionAttributeValues: { ":sedeId": auth.sedeId },
    }));
    items = result.Items || [];
  } else {
    return response(401, { message: "No autorizado" });
  }

  items = items.map(normalizePedido);
  if (status) {
    items = items.filter((pedido) => pedido.status === status || pedido.estado === status);
  }

  return response(200, { items, count: items.length });
};
