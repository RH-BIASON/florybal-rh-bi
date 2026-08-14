import { isSupabaseConfigured } from "./supabaseStore.js";

const TENANT = "pegada";

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return { url, key };
}

function serviceHeaders(extra = {}) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

async function authJson(endpoint, options = {}) {
  const { url, key } = config();
  if (!url || !key) throw new Error("Autenticacao Supabase nao configurada.");
  const response = await fetch(`${url}${endpoint}`, {
    ...options,
    headers: serviceHeaders(options.headers || {}),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = payload?.msg || payload?.message || payload?.error_description || payload?.error || text || response.statusText;
    throw new Error(detail);
  }
  return payload;
}

function normalizeRole(role) {
  return role === "admin" ? "admin" : "user";
}

function tenantRoles(user) {
  const roles = { ...(user?.app_metadata?.tenants || {}) };
  const legacyTenant = user?.user_metadata?.tenant;
  const legacyRole = normalizeRole(user?.user_metadata?.role);
  if (legacyTenant && !roles[legacyTenant]) roles[legacyTenant] = legacyRole;
  if (!legacyTenant && !roles.florybal) roles.florybal = legacyRole;
  return roles;
}

function roleForTenant(user) {
  const role = tenantRoles(user)[TENANT];
  return role === "admin" || role === "user" ? role : null;
}

function withTenantRole(user) {
  const role = roleForTenant(user);
  if (!role) return null;
  return {
    ...user,
    user_metadata: {
      ...(user.user_metadata || {}),
      role,
      tenant: TENANT,
    },
  };
}

async function allUsers() {
  const payload = await authJson("/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
  return payload?.users || [];
}

async function authenticatePassword(email, password) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error("Este e-mail ja existe em outro BI. Informe a senha atual dessa conta para vincular o acesso.");
  }
}

export function isAuthConfigured() {
  return process.env.DISABLE_AUTH !== "true" && isSupabaseConfigured();
}

export function publicUser(user) {
  const scopedUser = withTenantRole(user);
  if (!scopedUser) return null;
  return {
    id: scopedUser.id,
    email: scopedUser.email,
    name: scopedUser.user_metadata?.name || scopedUser.email,
    role: scopedUser.user_metadata.role,
    tenant: TENANT,
    createdAt: scopedUser.created_at,
    lastSignInAt: scopedUser.last_sign_in_at || null,
  };
}

export async function listUsers() {
  if (!isAuthConfigured()) return [];
  return (await allUsers()).filter((user) => Boolean(roleForTenant(user)));
}

export async function hasUsers() {
  const users = await listUsers();
  return users.length > 0;
}

export async function createUser({ name, email, password, role = "user" }) {
  if (!isAuthConfigured()) throw new Error("Autenticacao Supabase nao configurada.");
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const scopedRole = normalizeRole(role);
  const existing = (await allUsers()).find((user) => String(user.email || "").toLowerCase() === normalizedEmail);

  if (existing) {
    if (roleForTenant(existing)) throw new Error("Este e-mail ja possui acesso ao BI da Pegada.");
    await authenticatePassword(normalizedEmail, password);
    const updated = await authJson(`/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_metadata: {
          ...(existing.app_metadata || {}),
          tenants: { ...tenantRoles(existing), [TENANT]: scopedRole },
        },
        user_metadata: {
          ...(existing.user_metadata || {}),
          name: existing.user_metadata?.name || name,
        },
      }),
    });
    return { ...updated, linkedExisting: true };
  }

  const created = await authJson("/auth/v1/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: normalizedEmail,
      password,
      email_confirm: true,
      app_metadata: { tenants: { [TENANT]: scopedRole } },
      user_metadata: { name, role: scopedRole, tenant: TENANT },
    }),
  });
  return { ...created, linkedExisting: false };
}

export async function loginUser({ email, password }) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: key },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = payload?.msg || payload?.message || payload?.error_description || payload?.error || "Login invalido.";
    throw new Error(detail);
  }
  const scopedUser = withTenantRole(payload?.user);
  if (!scopedUser) throw new Error("Este acesso nao pertence ao BI da Pegada.");
  return { ...payload, user: scopedUser };
}

export async function userFromToken(token) {
  const user = await authJson("/auth/v1/user", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const scopedUser = withTenantRole(user);
  if (!scopedUser) throw new Error("Acesso de outro ambiente.");
  return scopedUser;
}

export async function deleteUser(userId) {
  if (!isAuthConfigured()) throw new Error("Autenticacao Supabase nao configurada.");
  const user = await authJson(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "GET" });
  const roles = tenantRoles(user);
  delete roles[TENANT];
  if (!Object.keys(roles).length) {
    return authJson(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
  }
  const metadata = { ...(user.user_metadata || {}) };
  if (metadata.tenant === TENANT) {
    const fallbackTenant = Object.keys(roles)[0];
    metadata.tenant = fallbackTenant;
    metadata.role = roles[fallbackTenant];
  }
  return authJson(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app_metadata: { ...(user.app_metadata || {}), tenants: roles },
      user_metadata: metadata,
    }),
  });
}
