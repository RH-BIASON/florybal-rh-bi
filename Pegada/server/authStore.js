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

export function isAuthConfigured() {
  return process.env.DISABLE_AUTH !== "true" && isSupabaseConfigured();
}

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.name || user.email,
    role: user.user_metadata?.role || "user",
    tenant: user.user_metadata?.tenant || "",
    createdAt: user.created_at,
    lastSignInAt: user.last_sign_in_at || null,
  };
}

export async function listUsers() {
  if (!isAuthConfigured()) return [];
  const payload = await authJson("/auth/v1/admin/users?page=1&per_page=100", { method: "GET" });
  return (payload?.users || []).filter((user) => user.user_metadata?.tenant === TENANT);
}

export async function hasUsers() {
  const users = await listUsers();
  return users.length > 0;
}

export async function createUser({ name, email, password, role = "user" }) {
  if (!isAuthConfigured()) throw new Error("Autenticacao Supabase nao configurada.");
  return authJson("/auth/v1/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
        role: role === "admin" ? "admin" : "user",
        tenant: TENANT,
      },
    }),
  });
}

export async function loginUser({ email, password }) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
    },
    body: JSON.stringify({ email, password }),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const detail = payload?.msg || payload?.message || payload?.error_description || payload?.error || "Login invalido.";
    throw new Error(detail);
  }
  if (payload?.user?.user_metadata?.tenant !== TENANT) {
    throw new Error("Este acesso nao pertence ao BI da Pegada.");
  }
  return payload;
}

export async function userFromToken(token) {
  const user = await authJson("/auth/v1/user", {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (user?.user_metadata?.tenant !== TENANT) throw new Error("Acesso de outro ambiente.");
  return user;
}

export async function deleteUser(userId) {
  if (!isAuthConfigured()) throw new Error("Autenticacao Supabase nao configurada.");
  return authJson(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE" });
}
