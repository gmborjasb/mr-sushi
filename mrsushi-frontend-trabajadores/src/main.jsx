import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const pedidosApi = import.meta.env.VITE_PEDIDOS_API_URL || import.meta.env.VITE_ORDERS_API_URL;
const flujoApi = import.meta.env.VITE_FLUJO_API_URL || import.meta.env.VITE_WORKFLOW_API_URL;
const authApi = import.meta.env.VITE_AUTH_API_URL || "";
const sedesApi = import.meta.env.VITE_SEDES_API_URL || "";
const nekiIconUrl = "https://tofuu.getjusto.com/orioneat-prod/pnvkqkvkStorHDSLg-neki.png";

const roles = { COOKING: "Cocina", PACKING: "Despacho", DELIVERING: "Reparto", READY_FOR_PICKUP: "Recojo en tienda" };
const workerRoles = {
  ADMIN: "Administrador",
  COCINERO: "Cocinero",
  DESPACHADOR: "Despachador",
  REPARTIDOR: "Repartidor"
};
const roleToSteps = {
  COCINERO: ["COOKING"],
  DESPACHADOR: ["PACKING", "READY_FOR_PICKUP"],
  REPARTIDOR: ["DELIVERING"]
};
const roleMeta = {
  COOKING: { icon: "🍣", label: "Cocina", description: "Preparación y control de calidad" },
  PACKING: { icon: "🥡", label: "Despacho", description: "Empaque, bebidas y sellado" },
  DELIVERING: { icon: "🛵", label: "Reparto", description: "Salida del pedido al cliente" },
  READY_FOR_PICKUP: { icon: "🛍️", label: "Recojo en tienda", description: "Cliente pasa a recoger su pedido" }
};

const statusCopy = {
  RECEIVED: "Recibido",
  COOKING: "En cocina",
  PACKING: "En despacho",
  DELIVERING: "En reparto",
  READY_FOR_PICKUP: "Listo para recoger",
  DONE: "Finalizado"
};

const metricLabels = {
  total: { label: "Pedidos totales", icon: "plate", trend: "↗ En vivo" },
  activos: { label: "En operación", icon: "chart", trend: "Cola activa" },
  listos: { label: "Finalizados", icon: "check", trend: "Listos hoy" },
  "prom. min": { label: "Promedio min", icon: "clock", trend: "Tiempo medio" }
};

const ROLE_LABELS = { COCINERO: "Cocinero", DESPACHADOR: "Despacho", REPARTIDOR: "Repartidor" };

function isToday(value) {
  if (!value) return false;
  const d = new Date(value);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

function isPickupOrder(order) {
  return (order.fulfillment || order.entrega)?.type === "pickup";
}

function hasPassedRoleWork(order, rol) {
  const status = order.status;
  if (rol === "COCINERO") return !["RECEIVED", "COOKING"].includes(status);
  if (rol === "DESPACHADOR") return isPickupOrder(order) ? status === "DONE" : !["RECEIVED", "COOKING", "PACKING"].includes(status);
  if (rol === "REPARTIDOR") return !isPickupOrder(order) && status === "DONE";
  return false;
}

const AUTH_KEY = "mrsushi_worker_session";

function Icon({ name, className = "" }) {
  const paths = {
    plate: <><circle cx="12" cy="12" r="7" /><circle cx="12" cy="12" r="3" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
    check: <><path d="M20 7 10 17l-5-5" /><path d="M4 20h16" /></>,
    chart: <><path d="M4 19V5" /><path d="M4 19h16" /><path d="m7 15 4-4 3 3 5-7" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    warning: <><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.3 4.4 2.7 18a2 2 0 0 0 1.7 3h15.2a2 2 0 0 0 1.7-3L13.7 4.4a2 2 0 0 0-3.4 0Z" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>
  };

  return <svg className={`icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {paths[name]}
  </svg>;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(AUTH_KEY);
}

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" });
}

function minutesSince(value) {
  if (!value) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

function normalizeList(payload, keys = []) {
  if (Array.isArray(payload)) return payload;
  if (typeof payload?.body === "string") {
    try {
      return normalizeList(JSON.parse(payload.body), keys);
    } catch {
      return [];
    }
  }
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.orders)) return payload.orders;
  return [];
}

function normalizeOrder(order = {}) {
  const orderId = order.orderId || order.pedidoId;
  const createdAt = order.createdAt || order.fecha_creacion;
  const status = order.status || order.estado;
  return {
    ...order,
    orderId,
    pedidoId: order.pedidoId || orderId,
    status,
    estado: order.estado || status,
    createdAt,
    fecha_creacion: order.fecha_creacion || createdAt,
    origin: order.origin || order.origen || "WEB",
    items: Array.isArray(order.items) ? order.items : [],
    total: Number(order.total || 0)
  };
}

function normalizeStep(step = {}) {
  const stage = step.step || step.etapa;
  return {
    ...step,
    step: stage,
    etapa: step.etapa || stage,
    status: step.status || step.estado,
    startedAt: step.startedAt || step.fecha_inicio,
    assignedTo: step.assignedTo || step.responsable
  };
}

function sortByDate(list, field = "createdAt") {
  return [...list].sort((a, b) => String(a?.[field] || "").localeCompare(String(b?.[field] || "")));
}

async function request(url, options = {}, token) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Error en la solicitud");
  return data;
}

function AuthScreen({ onLogin }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ nombre: "", email: "", password: "", rol: "COCINERO", sede: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [sedes, setSedes] = useState([]);

  useEffect(() => {
    if (!sedesApi) return;
    request(`${sedesApi}/sedes`)
      .then(payload => {
        const items = payload.items || [];
        setSedes(items);
        setForm(current => current.sede ? current : { ...current, sede: items[0]?.sedeId || "" });
      })
      .catch(() => {});
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (!authApi) throw new Error("Configura VITE_AUTH_API_URL con el endpoint de ms-autenticacion");
      const path = mode === "login" ? "/auth/login" : "/auth/register";
      const payload = mode === "login"
        ? { email: form.email, password: form.password }
        : { nombre: form.nombre, email: form.email, password: form.password, rol: form.rol, sedeId: form.sede };
      const data = await request(`${authApi}${path}`, { method: "POST", body: JSON.stringify(payload) });
      const session = { token: data.token, user: data.user };
      saveSession(session);
      onLogin(session);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return <main className="auth-page">
    <section className="auth-card">
      <div className="brand-mark">
        <img src={nekiIconUrl} alt="Neki Mr. Sushi" />
        <strong>MR. SUSHI</strong>
      </div>
      <p className="eyebrow">ACCESO DE TRABAJADORES</p>
      <h1>Centro de mando.</h1>
      <p className="subtitle">Inicia sesión para operar pedidos según tu rol: cocina, despacho, reparto o administración.</p>
      {error && <div className="error auth-error" role="alert"><Icon name="warning" /><span>{error}</span><button type="button" onClick={() => setError("")}>×</button></div>}
      <form className="auth-form" onSubmit={submit}>
        {mode === "register" && <>
          <label>Nombre</label>
          <div className="input-shell"><Icon name="user" /><input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Nombre del trabajador" /></div>
          <label>Rol</label>
          <select value={form.rol} onChange={e => setForm({ ...form, rol: e.target.value })}>
            <option value="COCINERO">Cocinero</option>
            <option value="DESPACHADOR">Despachador</option>
            <option value="REPARTIDOR">Repartidor</option>
            <option value="ADMIN">Administrador</option>
          </select>
          <label>Sede</label>
          <select value={form.sede} onChange={e => setForm({ ...form, sede: e.target.value })}>
            {sedes.length === 0 && <option value="">Cargando sedes...</option>}
            {sedes.map(sede => <option key={sede.sedeId} value={sede.sedeId}>{sede.nombre}</option>)}
          </select>
        </>}
        <label>Email</label>
        <div className="input-shell"><Icon name="user" /><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="trabajador@mrsushi.pe" /></div>
        <label>Contraseña</label>
        <div className="input-shell"><Icon name="lock" /><input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} placeholder="Tu contraseña" /></div>
        <button className="auth-submit" disabled={loading}>{loading ? "Validando..." : mode === "login" ? "Iniciar sesión" : "Crear trabajador"}</button>
      </form>
      <button className="auth-switch" type="button" onClick={() => setMode(mode === "login" ? "register" : "login")}>
        {mode === "login" ? "Registrar nuevo trabajador" : "Ya tengo cuenta"}
      </button>
    </section>
  </main>;
}

function App() {
  const [session, setSession] = useState(readSession());
  const [orders, setOrders] = useState([]);
  const [role, setRole] = useState(roleToSteps[readSession()?.user?.rol]?.[0] || "COOKING");
  const [metricsRole, setMetricsRole] = useState(() => {
    const rol = readSession()?.user?.rol;
    return rol && rol !== "ADMIN" ? rol : "COCINERO";
  });
  const [selected, setSelected] = useState(null);
  const [workflow, setWorkflow] = useState([]);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [sedes, setSedes] = useState([]);

  const token = session?.token;
  const user = session?.user;
  const allowedSteps = user?.rol === "ADMIN" ? Object.keys(roles) : (roleToSteps[user?.rol] || []);
  const sedeName = sedes.find(sede => sede.sedeId === user?.sedeId)?.nombre || user?.sedeId;

  const logout = () => {
    clearSession();
    setSession(null);
    setOrders([]);
    setSelected(null);
    setWorkflow([]);
  };

  useEffect(() => {
    if (!sedesApi) return;
    request(`${sedesApi}/sedes`).then(payload => setSedes(payload.items || [])).catch(() => {});
  }, []);

  useEffect(() => {
    // Sesiones de antes de la migración a sedes no tienen sedeId: forzar logout limpio.
    if (session?.user && !session.user.sedeId) logout();
  }, [session]);

  const load = () => {
    if (!session) return Promise.resolve();
    return request(`${pedidosApi}/pedidos`, {}, token)
      .then(payload => {
        const items = normalizeList(payload, ["pedidos", "orders", "items", "data"]).map(normalizeOrder);
        setOrders(sortByDate(items, "createdAt"));
        setUpdatedAt(new Date());
      })
      .catch(e => setError(e.message));
  };

  useEffect(() => {
    if (!session) return undefined;
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [session?.token]);

  useEffect(() => {
    if (!allowedSteps.includes(role) && allowedSteps[0]) setRole(allowedSteps[0]);
  }, [user?.rol]);

  useEffect(() => {
    if (user?.rol && user.rol !== "ADMIN") setMetricsRole(user.rol);
  }, [user?.rol]);

  useEffect(() => {
    if (selected) {
      request(`${flujoApi}/flujo-trabajo/${selected.pedidoId || selected.orderId}`, {}, token)
        .then(payload => setWorkflow(normalizeList(payload, ["workflow", "steps", "items", "data"]).map(normalizeStep)))
        .catch(e => setError(e.message));
    }
  }, [selected?.orderId, token]);

  const visibleOrders = user?.rol === "ADMIN" ? orders : orders.filter(order => allowedSteps.includes(order.status));
  const queue = visibleOrders.filter(order => order.status === role);
  const metrics = useMemo(() => {
    const completed = orders.filter(o => o.status === "DONE" && o.completedAt);
    const averageMinutes = completed.length
      ? Math.round(completed.reduce((sum, o) => sum + (new Date(o.completedAt) - new Date(o.createdAt)) / 60000, 0) / completed.length)
      : 0;
    return {
      total: visibleOrders.length,
      activos: visibleOrders.filter(o => o.status !== "DONE").length,
      listos: completed.length,
      "prom. min": averageMinutes
    };
  }, [orders, visibleOrders]);

  const roleMetrics = useMemo(() => {
    const steps = roleToSteps[metricsRole] || [];
    const queueOrders = orders.filter(o => steps.includes(o.status));
    const completedToday = orders.filter(o => isToday(o.createdAt) && hasPassedRoleWork(o, metricsRole));
    const avgWait = queueOrders.length
      ? Math.round(queueOrders.reduce((sum, o) => sum + minutesSince(o.createdAt), 0) / queueOrders.length)
      : 0;
    return { queue: queueOrders.length, completedToday: completedToday.length, avgWait };
  }, [orders, metricsRole]);

  const complete = async order => {
    setError("");
    try {
      await request(`${flujoApi}/flujo-trabajo/completar`, {
        method: "POST",
        body: JSON.stringify({
          pedidoId: order.pedidoId || order.orderId,
          orderId: order.orderId,
          step: role,
          assignedTo: user?.nombre
        })
      }, token);
      await load();
      setSelected(null);
    } catch (e) {
      setError(e.message);
    }
  };

  if (!session) return <AuthScreen onLogin={setSession} />;

  return <main>
    <header className="ops-header">
      <div className="brand-block">
        <div className="brand-mark">
          <img src={nekiIconUrl} alt="Neki Mr. Sushi" />
          <strong>MR. SUSHI</strong>
        </div>
        <p className="eyebrow">OPERACIONES EN TIEMPO REAL</p>
        <h1>Centro de mando.</h1>
        <p className="subtitle">Gestiona la cola de cocina, despacho y reparto con roles conectados al backend serverless.</p>
        <div className="sync-row">
          <span className="live-dot"></span>
          <span>Sincronizando pedidos cada 8 segundos</span>
          <span className="sync-time">Última actualización: {updatedAt ? formatTime(updatedAt) : "cargando..."}</span>
        </div>
      </div>
      <div className="session-card">
        <span className="avatar">{user?.nombre?.slice(0, 1) || "M"}</span>
        <div>
          <strong>{user?.nombre}</strong>
          <small>{workerRoles[user?.rol] || user?.rol} · {sedeName} · {user?.email}</small>
        </div>
        <button type="button" onClick={logout}>Salir</button>
      </div>
    </header>
    {error && <div className="error" role="alert">
      <Icon name="warning" />
      <span>{error}</span>
      <button type="button" aria-label="Cerrar alerta" onClick={() => setError("")}>×</button>
    </div>}
    <div className="panel-title metrics-title">
      <div>
        <p className="eyebrow">Resumen del día</p>
        <h2>Logros de hoy</h2>
      </div>
    </div>
    <section className="metrics">{Object.entries(metrics).map(([key,value], index) => <article key={key} style={{ animationDelay: `${index * 0.06}s` }}>
      <div className="metric-head">
        <span>{metricLabels[key]?.label || key}</span>
        <Icon name={metricLabels[key]?.icon || "chart"} />
      </div>
      <strong key={`${key}-${value}`}>{value}</strong>
      <em>{metricLabels[key]?.trend || "Actualizado"}</em>
    </article>)}</section>
    <div className="panel-title metrics-title role-metrics-title">
      <div>
        <p className="eyebrow">Desempeño por estación</p>
        <h2>{user?.rol === "ADMIN" ? "Métricas por rol" : `Tu desempeño · ${ROLE_LABELS[metricsRole] || ""}`}</h2>
      </div>
      {user?.rol === "ADMIN" && <div className="role-picker">
        {Object.keys(ROLE_LABELS).map(rol => <button
          key={rol}
          type="button"
          className={metricsRole === rol ? "active" : ""}
          onClick={() => setMetricsRole(rol)}
        >{ROLE_LABELS[rol]}</button>)}
      </div>}
    </div>
    <section className="metrics role-metrics">
      <article>
        <div className="metric-head"><span>En cola</span><Icon name="chart" /></div>
        <strong key={`queue-${roleMetrics.queue}`}>{roleMetrics.queue}</strong>
        <em>{ROLE_LABELS[metricsRole]}</em>
      </article>
      <article style={{ animationDelay: "0.06s" }}>
        <div className="metric-head"><span>Completados hoy</span><Icon name="check" /></div>
        <strong key={`done-${roleMetrics.completedToday}`}>{roleMetrics.completedToday}</strong>
        <em>Hoy</em>
      </article>
      <article style={{ animationDelay: "0.12s" }}>
        <div className="metric-head"><span>Prom. min en cola</span><Icon name="clock" /></div>
        <strong key={`avg-${roleMetrics.avgWait}`}>{roleMetrics.avgWait}</strong>
        <em>Tiempo de espera</em>
      </article>
    </section>
    <nav className="role-tabs">{Object.entries(roleMeta).filter(([key]) => allowedSteps.includes(key)).map(([key,item], index) => <button className={role === key ? "active" : ""} onClick={() => setRole(key)} key={key} style={{ animationDelay: `${index * 0.05}s` }}>
      <span>{item.icon}</span>
      <strong>{item.label}</strong>
      <small>{orders.filter(order => order.status === key).length}</small>
    </button>)}</nav>
    <section className="layout">
      <div className="queue-panel">
        <div className="panel-title">
          <div>
            <p className="eyebrow">{roleMeta[role]?.description}</p>
            <h2>Cola de {roles[role]}</h2>
          </div>
          <span className="count-pill">{queue.length} pedidos</span>
        </div>
        <div className="queue">
          {queue.length === 0 && <div className="empty">
            <Icon name="check" />
            <strong>Cola limpia</strong>
            <span>No hay pedidos esperando en esta etapa.</span>
          </div>}
          {queue.map((order, index) => <article className={`order ${selected?.orderId === order.orderId ? "selected" : ""}`} key={order.orderId} style={{ animationDelay: `${Math.min(index, 8) * 0.05}s` }} onClick={() => setSelected(order)}>
            <div className="order-main">
              <div className="order-topline">
                <span className="status-badge">{statusCopy[order.status] || order.status}</span>
                <span>{formatTime(order.createdAt)} · hace {minutesSince(order.createdAt)} min</span>
              </div>
              <h3>Pedido #{order.numero_turno ?? String(order.orderId).slice(0,8)}</h3>
              <p>{order.origin || "Web"} · {order.items?.length || 0} productos · <strong>S/ {Number(order.total).toFixed(2)}</strong></p>
            </div>
            <button onClick={e => { e.stopPropagation(); complete(order); }}>Completar</button>
          </article>)}
        </div>
      </div>
      <aside>
        <div className="panel-title">
          <div>
            <p className="eyebrow">Seguimiento</p>
            <h2>Detalle</h2>
          </div>
        </div>
        {!selected ? <div className="detail-empty">
          <Icon name="search" />
          <p>Selecciona un pedido para revisar sus productos y recorrido.</p>
          <small>El detalle aparecerá aquí con productos, estado y responsable.</small>
        </div> : <>
          <div className="detail-head">
            <span className="status-badge">{statusCopy[selected.status] || selected.status}</span>
            <h3>#{selected.orderId}</h3>
            <p>{selected.origin || "Web"} · creado a las {formatTime(selected.createdAt)}</p>
          </div>
          <div className="items-list">{selected.items?.map((item,i) => <p key={i}>
            <span>{item.name}</span>
            <strong>S/ {Number(item.price || item.total || 0).toFixed(2)}</strong>
          </p>)}</div>
          <hr/>
          <div className="timeline">
            {sortByDate(workflow, "startedAt").map(step => <div className="step" key={step.step}>
              <strong>{roleMeta[step.step]?.icon} {roles[step.step]}</strong>
              <span>{step.status}{step.assignedTo ? ` · ${step.assignedTo}` : ""}</span>
            </div>)}
          </div>
        </>}
      </aside>
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<App />);
