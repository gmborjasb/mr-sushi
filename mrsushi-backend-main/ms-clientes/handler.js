const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  PutCommand,
  UpdateCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());

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

function emailLockKey(email) {
  return { email: String(email || "").trim().toLowerCase() };
}

function perfilKey(clienteId) {
  return { clienteId, itemType: "PERFIL" };
}

function direccionKey(clienteId, direccionId) {
  return { clienteId, itemType: `DIRECCION#${direccionId}` };
}

function publicCliente(cliente) {
  if (!cliente) return null;
  return {
    clienteId: cliente.clienteId,
    customerId: cliente.clienteId,
    nombre: cliente.nombre,
    email: cliente.email,
    telefono: cliente.telefono,
    nekiPuntos: Number(cliente.nekiPuntos || 0),
    createdAt: cliente.createdAt,
    updatedAt: cliente.updatedAt,
  };
}

function signCliente(cliente) {
  return jwt.sign(
    { ...publicCliente(cliente), tipo: "CLIENTE", rol: "CLIENTE" },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function requireCliente(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("No autorizado");
  const user = jwt.verify(token, process.env.JWT_SECRET);
  if (user.tipo !== "CLIENTE" && user.rol !== "CLIENTE") throw new Error("No autorizado");
  return user;
}

async function getClienteById(clienteId) {
  const result = await dynamo.send(new GetCommand({
    TableName: process.env.CLIENTES_TABLE,
    Key: perfilKey(clienteId),
  }));
  return result.Item;
}

module.exports.registrarCliente = async (event) => {
  const body = parseBody(event);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const nombre = String(body.nombre || body.name || "").trim();
  const telefono = String(body.telefono || body.phone || "").trim();

  if (!nombre || !email || !password) {
    return response(400, { message: "Nombre, email y password son requeridos" });
  }

  const now = new Date().toISOString();
  const clienteId = uuidv4();
  const cliente = {
    ...perfilKey(clienteId),
    clienteId,
    customerId: clienteId,
    nombre,
    email,
    telefono,
    passwordHash: await bcrypt.hash(password, 10),
    nekiPuntos: 0,
    activo: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamo.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: process.env.CLIENTE_LOCKS_TABLE,
            Item: { ...emailLockKey(email), clienteId },
            ConditionExpression: "attribute_not_exists(email)",
          },
        },
        {
          Put: {
            TableName: process.env.CLIENTES_TABLE,
            Item: cliente,
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      return response(409, { message: "El cliente ya existe" });
    }
    throw err;
  }

  return response(201, {
    message: "Cliente registrado",
    cliente: publicCliente(cliente),
    token: signCliente(cliente),
  });
};

module.exports.loginCliente = async (event) => {
  const body = parseBody(event);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return response(400, { message: "Email y password son requeridos" });
  }

  const lock = await dynamo.send(new GetCommand({
    TableName: process.env.CLIENTE_LOCKS_TABLE,
    Key: emailLockKey(email),
    ConsistentRead: true,
  }));

  if (!lock.Item) {
    return response(401, { message: "Credenciales inválidas" });
  }

  const cliente = await getClienteById(lock.Item.clienteId);
  if (!cliente || !cliente.activo || !(await bcrypt.compare(password, cliente.passwordHash))) {
    return response(401, { message: "Credenciales inválidas" });
  }

  return response(200, {
    message: "Login correcto",
    cliente: publicCliente(cliente),
    token: signCliente(cliente),
  });
};

module.exports.obtenerPerfil = async (event) => {
  try {
    const auth = requireCliente(event);
    const cliente = await getClienteById(auth.clienteId || auth.customerId);
    if (!cliente) return response(404, { message: "Cliente no encontrado" });
    return response(200, { cliente: publicCliente(cliente) });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.actualizarPerfil = async (event) => {
  try {
    const auth = requireCliente(event);
    const body = parseBody(event);
    const updatedAt = new Date().toISOString();
    const values = {
      ":updatedAt": updatedAt,
    };
    const sets = ["updatedAt = :updatedAt"];

    if (body.nombre || body.name) {
      values[":nombre"] = body.nombre || body.name;
      sets.push("nombre = :nombre");
    }
    if (body.telefono || body.phone) {
      values[":telefono"] = body.telefono || body.phone;
      sets.push("telefono = :telefono");
    }

    await dynamo.send(new UpdateCommand({
      TableName: process.env.CLIENTES_TABLE,
      Key: perfilKey(auth.clienteId || auth.customerId),
      UpdateExpression: `SET ${sets.join(", ")}`,
      ExpressionAttributeValues: values,
    }));

    const cliente = await getClienteById(auth.clienteId || auth.customerId);
    return response(200, { cliente: publicCliente(cliente) });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.agregarDireccion = async (event) => {
  try {
    const auth = requireCliente(event);
    const body = parseBody(event);
    const clienteId = auth.clienteId || auth.customerId;
    const direccionId = uuidv4();
    const now = new Date().toISOString();

    if (!body.direccion && !body.address) {
      return response(400, { message: "La dirección es requerida" });
    }

    const item = {
      ...direccionKey(clienteId, direccionId),
      direccionId,
      clienteId,
      direccion: body.direccion || body.address,
      distrito: body.distrito || body.district || "",
      referencia: body.referencia || body.reference || "",
      lat: body.lat ?? null,
      lng: body.lng ?? null,
      createdAt: now,
      updatedAt: now,
    };

    await dynamo.send(new PutCommand({ TableName: process.env.CLIENTES_TABLE, Item: item }));
    return response(201, { message: "Dirección guardada", direccion: item });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.listarDirecciones = async (event) => {
  try {
    const auth = requireCliente(event);
    const clienteId = auth.clienteId || auth.customerId;
    const result = await dynamo.send(new QueryCommand({
      TableName: process.env.CLIENTES_TABLE,
      KeyConditionExpression: "clienteId = :clienteId AND begins_with(itemType, :prefix)",
      ExpressionAttributeValues: {
        ":clienteId": clienteId,
        ":prefix": "DIRECCION#",
      },
    }));

    return response(200, { items: result.Items || [], count: result.Items?.length || 0 });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.obtenerPuntos = async (event) => {
  try {
    const auth = requireCliente(event);
    const cliente = await getClienteById(auth.clienteId || auth.customerId);
    return response(200, { nekiPuntos: Number(cliente?.nekiPuntos || 0) });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.ajustarPuntos = async (event) => {
  let auth;
  try {
    auth = requireCliente(event);
  } catch {
    return response(401, { message: "No autorizado" });
  }

  const clienteId = auth.clienteId || auth.customerId;
  const solicitado = event.pathParameters?.clienteId;

  if (solicitado && solicitado !== clienteId) {
    return response(403, { message: "No puedes ajustar los puntos de otro cliente" });
  }

  const body = parseBody(event);
  const delta = Number(body.delta || 0);
  const now = new Date().toISOString();

  if (!Number.isFinite(delta)) {
    return response(400, { message: "delta es requerido" });
  }

  try {
    const result = await dynamo.send(new UpdateCommand({
      TableName: process.env.CLIENTES_TABLE,
      Key: perfilKey(clienteId),
      UpdateExpression: "ADD nekiPuntos :delta SET updatedAt = :updatedAt",
      ExpressionAttributeValues: {
        ":delta": delta,
        ":updatedAt": now,
      },
      ReturnValues: "ALL_NEW",
    }));

    return response(200, { cliente: publicCliente(result.Attributes) });
  } catch {
    return response(500, { message: "No se pudo actualizar Neki Puntos" });
  }
};
