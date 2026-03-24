const fs = require("node:fs");
const path = require("node:path");

let initialized = false;

function loadDotEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function initTestEnv() {
  if (initialized) return;

  loadDotEnvFile(path.resolve(process.cwd(), ".env"));

  if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
    process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
  }

  if (!process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
    process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
  }

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.VITE_SUPABASE_SERVICE_ROLE_KEY
  ) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
  }

  initialized = true;
}

function getRequiredEnv() {
  initTestEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

  const missing = [];
  if (!supabaseUrl) missing.push("SUPABASE_URL");
  if (!supabaseAnonKey) missing.push("SUPABASE_ANON_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Variáveis ausentes para integração: ${missing.join(
        ", "
      )}. Defina no ambiente ou no arquivo .env.`,
    );
  }

  return { supabaseUrl, supabaseAnonKey };
}

function getOptionalEnv() {
  initTestEnv();

  const supabaseServiceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    null;
  const superadminEmail = process.env.SUPERADMIN_EMAIL ?? null;
  const superadminPassword = process.env.SUPERADMIN_PASSWORD ?? null;

  return { supabaseServiceRoleKey, superadminEmail, superadminPassword };
}

module.exports = {
  initTestEnv,
  getRequiredEnv,
  getOptionalEnv,
};
