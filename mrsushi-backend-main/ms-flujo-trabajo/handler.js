const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} = require("@aws-sdk/lib-dynamodb");
const { SFNClient, SendTaskSuccessCommand } = require("@aws-sdk/client-sfn");
const jwt = require("jsonwebtoken");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());
const sfn = new SFNClient();

const STEP_TO_ROLE = {
  COOKING: "COCINERO",
  PACKING: "DESPACHADOR",
  DELIVERING: "REPARTIDOR",
  READY_FOR_PICKUP: "DESPACHADOR",
};

const NEXT_STATUS = {
  COOKING: "PACKING",
  PACKING: "DELIVERING",
  DELIVERING: "DONE",
  READY_FOR_PICKUP: "DONE",
};

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

function pedidoIdFrom(input = {}) {
  return input.pedidoId || input.orderId;
}

function workflowKey(pedidoId, step) {
  return { pedidoId, step };
}

function pedidoKey(sedeId, pedidoId) {
  return { sedeId, pedidoId };
}

function requireStaffAuth(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  try {
    const user = jwt.verify(token, process.env.JWT_SECRET);
    return user.sedeId ? user : null;
  } catch {
    return null;
  }
}

function canComplete(user, step) {
  if (user.rol === "ADMIN") return true;
  return user.rol === STEP_TO_ROLE[step];
}

// Invocada directamente por el Step Function (waitForTaskToken), no por un
// usuario HTTP: el evento es el propio payload, sin envoltura de API Gateway.
module.exports.guardarTaskToken = async (event) => {
  const pedidoId = pedidoIdFrom(event);
  const sedeId = event.sedeId;
  const { step, taskToken } = event;
  const startedAt = new Date().toISOString();

  await dynamo.send(new PutCommand({
    TableName: process.env.FLUJO_TABLE,
    Item: {
      ...workflowKey(pedidoId, step),
      orderId: pedidoId,
      sedeId,
      etapa: step,
      taskToken,
      status: "PENDING",
      startedAt,
    },
  }));

  await dynamo.send(new UpdateCommand({
    TableName: process.env.PEDIDOS_TABLE,
    Key: pedidoKey(sedeId, pedidoId),
    UpdateExpression: "SET #s = :status, estado = :status, updatedAt = :updatedAt",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":status": step,
      ":updatedAt": startedAt,
    },
  }));

  return { pedidoId, orderId: pedidoId, sedeId, step };
};

module.exports.completarEtapa = async (event) => {
  const user = requireStaffAuth(event);
  if (!user) return response(401, { message: "No autorizado" });

  const body = parseBody(event);
  const pedidoId = pedidoIdFrom(body);
  const step = body.step || body.etapa;
  const assignedTo = body.assignedTo || body.responsable || user.nombre;
  const completedAt = new Date().toISOString();

  if (!pedidoId || !step) {
    return response(400, { message: "pedidoId/orderId y step son requeridos" });
  }

  if (!canComplete(user, step)) {
    return response(403, { message: `Tu rol no puede completar la etapa ${step}` });
  }

  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.FLUJO_TABLE,
    KeyConditionExpression: "pedidoId = :pedidoId AND #s = :step",
    ExpressionAttributeNames: { "#s": "step" },
    ExpressionAttributeValues: {
      ":pedidoId": pedidoId,
      ":step": step,
    },
  }));

  const workflowItem = result.Items?.[0];
  if (!workflowItem || workflowItem.sedeId !== user.sedeId) {
    return response(404, { message: "Etapa no encontrada" });
  }

  await sfn.send(new SendTaskSuccessCommand({
    taskToken: workflowItem.taskToken,
    output: JSON.stringify({ pedidoId, orderId: pedidoId, step, assignedTo, sedeId: user.sedeId }),
  }));

  await dynamo.send(new UpdateCommand({
    TableName: process.env.FLUJO_TABLE,
    Key: workflowKey(pedidoId, step),
    UpdateExpression: "SET #s = :status, completedAt = :completedAt, assignedTo = :assignedTo",
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: {
      ":status": "DONE",
      ":completedAt": completedAt,
      ":assignedTo": assignedTo || "Sin asignar",
    },
  }));

  let nextStatus = NEXT_STATUS[step] || "DONE";
  if (step === "PACKING") {
    const pedidoResult = await dynamo.send(new GetCommand({
      TableName: process.env.PEDIDOS_TABLE,
      Key: pedidoKey(user.sedeId, pedidoId),
    }));
    const fulfillment = pedidoResult.Item?.fulfillment;
    nextStatus = fulfillment?.type === "pickup" ? "READY_FOR_PICKUP" : "DELIVERING";
  }

  const expressionValues = {
    ":status": nextStatus,
    ":updatedAt": completedAt,
  };

  let updateExpression = "SET #s = :status, estado = :status, updatedAt = :updatedAt";
  if (nextStatus === "DONE") {
    updateExpression += ", completedAt = :completedAt";
    expressionValues[":completedAt"] = completedAt;
  }

  await dynamo.send(new UpdateCommand({
    TableName: process.env.PEDIDOS_TABLE,
    Key: pedidoKey(user.sedeId, pedidoId),
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: { "#s": "status" },
    ExpressionAttributeValues: expressionValues,
  }));

  return response(200, {
    message: "Etapa completada",
    pedidoId,
    orderId: pedidoId,
    step,
    nextStatus,
  });
};

module.exports.obtenerFlujo = async (event) => {
  const user = requireStaffAuth(event);
  if (!user) return response(401, { message: "No autorizado" });

  const pedidoId = event.pathParameters?.pedidoId || event.pathParameters?.orderId;

  const pedido = await dynamo.send(new GetCommand({
    TableName: process.env.PEDIDOS_TABLE,
    Key: pedidoKey(user.sedeId, pedidoId),
  }));

  if (!pedido.Item) {
    return response(404, { message: "Pedido no encontrado" });
  }

  const result = await dynamo.send(new QueryCommand({
    TableName: process.env.FLUJO_TABLE,
    KeyConditionExpression: "pedidoId = :pedidoId",
    ExpressionAttributeValues: {
      ":pedidoId": pedidoId,
    },
  }));

  const items = (result.Items || []).sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));

  return response(200, { items, count: items.length });
};
