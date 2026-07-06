const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
} = require("@aws-sdk/lib-dynamodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const dynamo = DynamoDBDocumentClient.from(new DynamoDBClient());

const ROLES = new Set(["ADMIN", "COCINERO", "DESPACHADOR", "REPARTIDOR"]);

// Las 8 sedes conocidas (ver ms-sedes/seed.js, misma lista).
const SEDES_VALIDAS = new Set([
  "la-marina",
  "mall-del-sur",
  "espinar",
  "mega-plaza",
  "minka",
  "rambla-brena",
  "surquillo",
  "plaza-norte",
]);

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

function usuarioKey(sedeId, email) {
  return { sedeId, email: String(email || "").trim().toLowerCase() };
}

function emailLockKey(email) {
  return { email: String(email || "").trim().toLowerCase() };
}

function publicUser(user) {
  if (!user) return null;
  return {
    usuarioId: user.usuarioId,
    sedeId: user.sedeId,
    nombre: user.nombre,
    email: user.email,
    rol: user.rol,
    activo: user.activo,
    createdAt: user.createdAt,
  };
}

function signUser(user) {
  return jwt.sign(publicUser(user), process.env.JWT_SECRET, { expiresIn: "12h" });
}

function requireAuth(event) {
  const auth = event.headers?.authorization || event.headers?.Authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) throw new Error("No autorizado");
  return jwt.verify(token, process.env.JWT_SECRET);
}

module.exports.registrar = async (event) => {
  const body = parseBody(event);
  const sedeId = String(body.sedeId || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const rol = String(body.rol || "COCINERO").toUpperCase();

  if (!email || !password || !body.nombre) {
    return response(400, { message: "Nombre, email y password son requeridos" });
  }

  if (!SEDES_VALIDAS.has(sedeId)) {
    return response(400, { message: "Sede inválida", sedesValidas: [...SEDES_VALIDAS] });
  }

  if (!ROLES.has(rol)) {
    return response(400, { message: "Rol inválido", rolesPermitidos: [...ROLES] });
  }

  const now = new Date().toISOString();
  const usuarioId = uuidv4();
  const user = {
    ...usuarioKey(sedeId, email),
    usuarioId,
    nombre: body.nombre,
    email,
    rol,
    passwordHash: await bcrypt.hash(password, 10),
    activo: true,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await dynamo.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: process.env.USUARIO_LOCKS_TABLE,
            Item: { ...emailLockKey(email), sedeId, usuarioId },
            ConditionExpression: "attribute_not_exists(email)",
          },
        },
        {
          Put: {
            TableName: process.env.USUARIOS_TABLE,
            Item: user,
          },
        },
      ],
    }));
  } catch (err) {
    if (err.name === "TransactionCanceledException") {
      return response(409, { message: "El usuario ya existe" });
    }
    throw err;
  }

  return response(201, {
    message: "Usuario registrado",
    user: publicUser(user),
    token: signUser(user),
  });
};

module.exports.login = async (event) => {
  const body = parseBody(event);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !password) {
    return response(400, { message: "Email y password son requeridos" });
  }

  const lock = await dynamo.send(new GetCommand({
    TableName: process.env.USUARIO_LOCKS_TABLE,
    Key: emailLockKey(email),
    ConsistentRead: true,
  }));

  if (!lock.Item) {
    return response(401, { message: "Credenciales inválidas" });
  }

  const result = await dynamo.send(new GetCommand({
    TableName: process.env.USUARIOS_TABLE,
    Key: usuarioKey(lock.Item.sedeId, email),
    ConsistentRead: true,
  }));

  const user = result.Item;
  if (!user || !user.activo || !(await bcrypt.compare(password, user.passwordHash))) {
    return response(401, { message: "Credenciales inválidas" });
  }

  return response(200, {
    message: "Login correcto",
    user: publicUser(user),
    token: signUser(user),
  });
};

module.exports.perfil = async (event) => {
  try {
    const user = requireAuth(event);
    return response(200, { user });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};

module.exports.trabajadores = async (event) => {
  try {
    const authUser = requireAuth(event);
    if (authUser.rol !== "ADMIN") {
      return response(403, { message: "Solo ADMIN puede listar trabajadores" });
    }

    const result = await dynamo.send(new QueryCommand({
      TableName: process.env.USUARIOS_TABLE,
      KeyConditionExpression: "sedeId = :sedeId",
      ExpressionAttributeValues: {
        ":sedeId": authUser.sedeId,
      },
    }));

    return response(200, {
      items: (result.Items || []).map(publicUser),
    });
  } catch {
    return response(401, { message: "No autorizado" });
  }
};
