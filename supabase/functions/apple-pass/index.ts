// supabase/functions/apple-pass/index.ts
/// <reference types="https://deno.land/x/deno/cli/types/dts/index.d.ts" />

import {
  type Request,
  serve,
} from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Template } from "npm:@walletpass/pass-js@6.9.1";
import { decodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { Buffer } from "node:buffer";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

type AppleStyle = "storeCard" | "coupon" | "eventTicket" | "generic";
type Density = "1x" | "2x" | "3x";

type ApiErrorCategory = "validation" | "config" | "upstream" | "internal";

type ApiErrorOptions = {
  code: string;
  status: number;
  category: ApiErrorCategory;
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
};

class ApiError extends Error {
  code: string;
  status: number;
  category: ApiErrorCategory;
  retryable: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "ApiError";
    this.code = options.code;
    this.status = options.status;
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
    this.cause = options.cause;
  }
}

const DEFAULT_LOCATION_RELEVANT_TEXT =
  "Aproveite que está por perto e venha conferir as melhores ofertas!";

function cleanString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length ? s : null;
}

function ensureHttpUrl(v: unknown): string | null {
  const s = cleanString(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function corsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  origin = "*",
  headers: HeadersInit = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(origin),
      ...headers,
    },
  });
}

function validationError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = true,
) {
  return new ApiError(message, {
    code,
    status: 422,
    category: "validation",
    retryable,
    details,
  });
}

function configError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return new ApiError(message, {
    code,
    status: 500,
    category: "config",
    retryable: false,
    details,
  });
}

function upstreamError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  retryable = true,
) {
  return new ApiError(message, {
    code,
    status: 502,
    category: "upstream",
    retryable,
    details,
  });
}

function asApiError(error: unknown) {
  if (error instanceof ApiError) return error;
  if (error instanceof Error) {
    return new ApiError(error.message || "Erro interno ao gerar passe.", {
      code: "apple_pass_internal_error",
      status: 500,
      category: "internal",
      retryable: false,
    });
  }
  return new ApiError("Erro interno ao gerar passe.", {
    code: "apple_pass_internal_error",
    status: 500,
    category: "internal",
    retryable: false,
  });
}

function errorResponse(error: unknown, requestId: string, origin = "*") {
  const apiError = asApiError(error);
  return jsonResponse(
    {
      error: apiError.code,
      message: apiError.message,
      category: apiError.category,
      retryable: apiError.retryable,
      details: apiError.details ?? null,
      requestId,
    },
    apiError.status,
    origin,
  );
}

function storagePublicUrl(path: string) {
  if (!SUPABASE_URL) {
    throw configError(
      "missing_supabase_url",
      "SUPABASE_URL não está configurada para resolver assets padrão do passe.",
    );
  }
  return `${SUPABASE_URL}/storage/v1/object/public/pass-assets/${path}`;
}

function decodePemOrBase64(
  value: string,
  name: string,
  requestId: string,
): string {
  try {
    const trimmed = value.trim();
    const pemText = trimmed.includes("BEGIN")
      ? trimmed
      : new TextDecoder().decode(decodeBase64(trimmed));
    return pemText.replace(/\r\n/g, "\n");
  } catch (e) {
    console.error(`[${requestId}] Erro ao decodificar ${name}:`, e);
    throw configError(
      "invalid_signing_material",
      `Falha ao decodificar ${name}. Verifique se o conteúdo está em PEM ou Base64 válido.`,
      { env: name },
    );
  }
}

function normalizeDefaults(input: any): any {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  if (typeof input === "object") return input;
  return {};
}

function getPath(obj: any, path: string): any {
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveIdentifier(
  defaults: any,
  key: "passTypeIdentifier" | "teamIdentifier",
): string | null {
  const paths = key === "passTypeIdentifier"
    ? [
      "passTypeIdentifier",
      "pass.passTypeIdentifier",
      "pass_type_identifier",
      "pass.pass_type_identifier",
    ]
    : [
      "teamIdentifier",
      "pass.teamIdentifier",
      "team_identifier",
      "pass.team_identifier",
    ];

  for (const p of paths) {
    const s = cleanString(getPath(defaults, p));
    if (s) return s;
  }
  return null;
}

function forcePassRequiredFields(
  pass: any,
  required: {
    description: string;
    organizationName: string;
    passTypeIdentifier: string;
    teamIdentifier: string;
  },
) {
  const { description, organizationName, passTypeIdentifier, teamIdentifier } =
    required;

  try {
    pass.description = description;
  } catch {}
  try {
    pass.organizationName = organizationName;
  } catch {}
  try {
    pass.passTypeIdentifier = passTypeIdentifier;
  } catch {}
  try {
    pass.teamIdentifier = teamIdentifier;
  } catch {}
}

function mapTemplateStyle(typeRaw: unknown): AppleStyle {
  const t = cleanString(typeRaw)?.toLowerCase() ?? "loyalty";
  if (t === "loyalty" || t === "value") return "storeCard";
  if (t === "offer") return "coupon";
  if (t === "event") return "eventTicket";
  return "generic";
}

function styleLabel(style: AppleStyle) {
  if (style === "storeCard") return "storeCard (loyalty)";
  if (style === "coupon") return "coupon (offer)";
  if (style === "eventTicket") return "eventTicket";
  return "generic";
}

function mapColors(colors: any) {
  const bg = cleanString(colors?.background) ?? "#6c5ce7";
  const fg = cleanString(colors?.text) ?? "#ffffff";
  const lb = cleanString(colors?.label) ?? "#ffffff";
  return {
    backgroundColor: bg,
    foregroundColor: fg,
    labelColor: lb,
  };
}

function formatBRDate(input: unknown): string | null {
  const s = cleanString(input);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function pickFirstPoints(fields: any): string {
  const direct = fields?.["members.member.points"];
  if (direct !== undefined && direct !== null) return String(direct);
  if (fields && typeof fields === "object") {
    for (const k of Object.keys(fields)) {
      if (k.toLowerCase().includes("points")) {
        const v = (fields as any)[k];
        if (v !== undefined && v !== null) return String(v);
      }
    }
  }
  return "0";
}

function getPassMode(typeRaw: unknown) {
  return cleanString(typeRaw)?.toLowerCase() === "value" ? "value" : "loyalty";
}

function pickBalanceCents(fields: any): number {
  const direct = fields?.balance_cents;
  if (direct !== undefined && direct !== null && direct !== "") {
    const cents = Number(direct);
    if (Number.isFinite(cents)) return Math.max(Math.trunc(cents), 0);
  }

  if (fields && typeof fields === "object") {
    for (const key of Object.keys(fields)) {
      const normalizedKey = key.toLowerCase();
      if (!normalizedKey.includes("balance") && !normalizedKey.includes("saldo")) {
        continue;
      }
      const cents = Number((fields as any)[key]);
      if (Number.isFinite(cents)) return Math.max(Math.trunc(cents), 0);
    }
  }

  return 0;
}

function formatCurrencyBRL(cents: number) {
  const normalizedCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(normalizedCents / 100);
}

type AvailableReward = {
  id: string;
  name: string;
  reward_type: "loyalty" | "value";
  points_required?: number;
  value_required_cents?: number;
  currency?: string;
};

function parsePointsValue(value: unknown): number | null {
  const raw = typeof value === "string" ? value.trim() : value;
  const points = Number(raw);
  if (!Number.isFinite(points)) return null;
  return Math.max(Math.trunc(points), 0);
}

function normalizeRewards(rows: unknown): AvailableReward[] {
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row: any) => {
      const id = cleanString(row?.id);
      const name = cleanString(row?.name);
      const rewardType = cleanString(row?.reward_type)?.toLowerCase() === "value"
        ? "value"
        : "loyalty";
      const pointsRequired = parsePointsValue(row?.points_required);
      const valueRequiredCents = parsePointsValue(row?.value_required_cents);
      const currency = cleanString(row?.currency) ?? "BRL";

      if (!id || !name) return null;
      if (rewardType === "value") {
        if (valueRequiredCents === null || valueRequiredCents <= 0) return null;
        return {
          id,
          name,
          reward_type: "value",
          value_required_cents: valueRequiredCents,
          currency,
        };
      }

      if (pointsRequired === null) return null;

      return {
        id,
        name,
        reward_type: "loyalty",
        points_required: pointsRequired,
      };
    })
    .filter((reward): reward is AvailableReward => Boolean(reward));
}

function formatRewardNames(rewards: AvailableReward[]) {
  const names = rewards.map((reward) => reward.name).filter(Boolean);
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} e ${names[names.length - 1]}`;
}

function truncateChangeMessage(message: string, maxLength = 140) {
  if (message.length <= maxLength) return message;
  return `${message.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function formatPoints(points: number) {
  return points === 1 ? "1 ponto" : `${points} pontos`;
}

function buildPointsChangeMessage(
  points: number | null,
  rewards: AvailableReward[],
) {
  const rewardNames = formatRewardNames(rewards);
  if (!rewardNames) return "Você agora tem %@ pontos";

  const pointsLabel = points === 1 ? "ponto" : "pontos";
  return truncateChangeMessage(
    `Você agora tem %@ ${pointsLabel} e pode resgatar: ${rewardNames}.`,
  );
}

function buildValueChangeMessage(rewards: AvailableReward[]) {
  const rewardNames = formatRewardNames(rewards);
  if (!rewardNames) return "Saldo atualizado: %@";
  return truncateChangeMessage(
    `Saldo atualizado: %@. Pode resgatar: ${rewardNames}.`,
  );
}

async function loadAvailableRewardsForPoints(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  points: number | null,
): Promise<AvailableReward[]> {
  if (points === null) return [];

  const { data, error } = await sb
    .from("rewards")
    .select("id, name, reward_type, points_required")
    .eq("project_id", projectId)
    .eq("status", "active")
    .eq("reward_type", "loyalty")
    .eq("points_required", points)
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(
      "[apple-pass] rewards lookup failed (ignored):",
      error.message,
    );
    return [];
  }

  return normalizeRewards(data);
}

async function loadAvailableRewardsForBalance(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  balanceCents: number,
): Promise<AvailableReward[]> {
  const { data, error } = await sb
    .from("rewards")
    .select("id, name, reward_type, value_required_cents, currency")
    .eq("project_id", projectId)
    .eq("status", "active")
    .eq("reward_type", "value")
    .lte("value_required_cents", balanceCents)
    .order("value_required_cents", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.warn(
      "[apple-pass] rewards lookup failed (ignored):",
      error.message,
    );
    return [];
  }

  return normalizeRewards(data);
}

function buildAppleFields(
  finalPassData: any,
  options: { suppressPointsNotification?: boolean } = {},
) {
  const fields = finalPassData?.fields ?? {};
  const passMode = getPassMode(finalPassData?.type);
  const points = pickFirstPoints(fields);
  const numericPoints = parsePointsValue(points);
  const balanceCents = pickBalanceCents(fields);
  const balanceDisplay = formatCurrencyBRL(balanceCents);
  const exp = formatBRDate(finalPassData?.exp_date);
  const rewardsAvailable = normalizeRewards(finalPassData?.rewards_available);

  const lastMessage = cleanString(fields?.last_message);
  const backText = lastMessage ? lastMessage : "Nenhuma mensagem ainda.";

  return {
    headerFields: [
      {
        key: "exp_date",
        label: "EXPIRA EM",
        value: exp ?? "--/--/----",
        changeMessage: "Validade do passe atualizada: %@",
      },
    ],
    auxiliaryFields: [
      {
        key: passMode === "value" ? "balance" : "points",
        label: passMode === "value" ? "SALDO" : "PONTOS",
        value: passMode === "value" ? balanceDisplay : String(points),
        ...(options.suppressPointsNotification ? {} : {
          changeMessage: passMode === "value"
            ? buildValueChangeMessage(rewardsAvailable)
            : buildPointsChangeMessage(
              numericPoints,
              rewardsAvailable,
            ),
        }),
      },
    ],
    secondaryFields: [],
    backFields: [
      {
        key: "last_message",
        label: "NOVA MENSAGEM",
        value: backText,
        changeMessage: "%@",
      },
    ],
  };
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  return null;
}

async function resolvePassIdForLocations(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  if (passId) return passId;
  if (!shortCode) return null;

  const { data, error } = await sb
    .from("passes")
    .select("id")
    .eq("project_id", projectId)
    .eq("short_code", shortCode)
    .maybeSingle();

  if (error) {
    throw upstreamError(
      "pass_lookup_failed",
      `Erro ao resolver pass_id por short_code: ${error.message}`,
    );
  }

  return cleanString((data as any)?.id);
}

async function loadPassLocationsApple(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  const resolvedPassId = await resolvePassIdForLocations(
    sb,
    projectId,
    passId,
    shortCode,
  );
  if (!resolvedPassId) return [];

  const { data: mapRows, error: mapError } = await sb
    .from("pass_locations")
    .select("location_id")
    .eq("project_id", projectId)
    .eq("pass_id", resolvedPassId)
    .limit(100);

  if (mapError) {
    throw upstreamError(
      "pass_locations_lookup_failed",
      `Erro ao buscar pass_locations: ${mapError.message}`,
    );
  }

  const locationIds = [
    ...new Set(
      (mapRows ?? []).map((row: any) => cleanString(row.location_id)).filter(
        Boolean,
      ) as string[],
    ),
  ];
  if (locationIds.length === 0) return [];

  const { data: locations, error: locationsError } = await sb
    .from("locations")
    .select("id, label, description, lat, lng")
    .eq("project_id", projectId)
    .in("id", locationIds)
    .limit(100);

  if (locationsError) {
    throw upstreamError(
      "locations_lookup_failed",
      `Erro ao buscar locations por pass_locations: ${locationsError.message}`,
    );
  }

  const order = new Map(locationIds.map((id, index) => [id, index]));

  const cleaned = (locations ?? [])
    .map((r: any) => {
      const lat = toNumber(r.lat);
      const lng = toNumber(r.lng);
      if (lat === null || lng === null) return null;
      return {
        id: cleanString(r.id),
        label: r.label ?? null,
        description: cleanString(r.description),
        lat,
        lng,
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) =>
      (order.get(a.id ?? "") ?? 999) - (order.get(b.id ?? "") ?? 999)
    )
    .slice(0, 10);

  return cleaned as Array<
    {
      id: string | null;
      label: string | null;
      description: string | null;
      lat: number;
      lng: number;
    }
  >;
}

async function loadProjectName(
  sb: ReturnType<typeof createClient>,
  projectId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw upstreamError(
      "project_lookup_failed",
      `Erro ao buscar project.name: ${error.message}`,
    );
  }

  const name = cleanString((data as any)?.name);
  return name;
}

async function loadByToken(token: string) {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw configError(
      "missing_supabase_credentials",
      "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
    );
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: up, error: eUp } = await sb
    .from("user_passes")
    .select(
      "id, pass_id, pass_token, issued_at, expires_at, pass_type, metadata",
    )
    .eq("pass_token", token)
    .maybeSingle();
  if (eUp) {
    throw upstreamError(
      "user_pass_lookup_failed",
      `Erro ao buscar user_passes: ${eUp.message}`,
    );
  }
  if (!up) {
    throw validationError(
      "invalid_token",
      "Token inválido ou não encontrado.",
      { field: "token" },
      false,
    );
  }

  const { data: passRow, error: eP } = await sb
    .from("passes")
    .select(
      "id, project_id, type, title, description, fields, design, short_code",
    )
    .eq("id", up.pass_id)
    .maybeSingle();
  if (eP) {
    throw upstreamError(
      "pass_lookup_failed",
      `Erro ao buscar passes: ${eP.message}`,
    );
  }
  if (!passRow) {
    throw validationError(
      "pass_not_found_for_token",
      "Passe não encontrado para este token.",
      { token },
      false,
    );
  }

  const { data: walletTemplateRaw, error: templateError } = await sb
    .from("wallet_templates")
    .select("defaults")
    .eq("project_id", passRow.project_id)
    .maybeSingle();
  if (templateError) {
    throw upstreamError(
      "project_template_lookup_failed",
      "Erro ao buscar template do projeto.",
    );
  }

  const { data: globalTemplateRaw, error: globalTemplateError } = await sb
    .from("wallet_templates")
    .select("defaults")
    .is("project_id", null)
    .maybeSingle();
  if (globalTemplateError) {
    throw upstreamError(
      "global_template_lookup_failed",
      "Erro ao buscar template global.",
    );
  }

  const templateDefaults = normalizeDefaults(walletTemplateRaw?.defaults);
  const globalDefaults = normalizeDefaults(globalTemplateRaw?.defaults);

  return { sb, up, passRow, templateDefaults, globalDefaults };
}

async function loadPassRowByReference(
  sb: ReturnType<typeof createClient>,
  projectId: string,
  passId: string | null,
  shortCode: string | null,
) {
  const resolvedPassId = await resolvePassIdForLocations(
    sb,
    projectId,
    passId,
    shortCode,
  );
  if (!resolvedPassId) return null;

  const { data, error } = await sb
    .from("passes")
    .select(
      "id, project_id, type, title, description, fields, design, short_code",
    )
    .eq("project_id", projectId)
    .eq("id", resolvedPassId)
    .maybeSingle();

  if (error) {
    throw upstreamError(
      "pass_lookup_failed",
      `Erro ao buscar passe por referencia: ${error.message}`,
    );
  }

  return data;
}

function readPngMetadata(bytes: Uint8Array, assetName: string) {
  if (bytes.length < 29) {
    throw validationError(
      "apple_asset_png_too_small",
      `${assetName} inválido: arquivo PNG muito pequeno.`,
    );
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < pngSignature.length; i++) {
    if (bytes[i] !== pngSignature[i]) {
      throw validationError(
        "apple_asset_invalid_format",
        `${assetName} inválido: o arquivo não é um PNG válido.`,
      );
    }
  }

  const chunkType = String.fromCharCode(
    bytes[12],
    bytes[13],
    bytes[14],
    bytes[15],
  );
  if (chunkType !== "IHDR") {
    throw validationError(
      "apple_asset_missing_ihdr",
      `${assetName} inválido: chunk IHDR não encontrado.`,
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = bytes[24];
  const colorType = bytes[25];
  const compressionMethod = bytes[26];
  const filterMethod = bytes[27];
  const interlaceMethod = bytes[28];

  if (!width || !height) {
    throw validationError(
      "apple_asset_invalid_dimensions",
      `${assetName} inválido: largura e altura precisam ser maiores que zero.`,
    );
  }

  if (
    compressionMethod !== 0 || filterMethod !== 0 ||
    (interlaceMethod !== 0 && interlaceMethod !== 1)
  ) {
    throw validationError(
      "apple_asset_invalid_properties",
      `${assetName} inválido: propriedades PNG incompatíveis com o pacote do passe.`,
      {
        compressionMethod,
        filterMethod,
        interlaceMethod,
      },
    );
  }

  return {
    width,
    height,
    bitDepth,
    colorType,
    compressionMethod,
    filterMethod,
    interlaceMethod,
  };
}

function createAssetDetails(
  assetKey: string,
  field: string,
  displayName: string,
  extras: Record<string, unknown> = {},
) {
  return {
    assetKey,
    field,
    displayName,
    ...extras,
  };
}

function detectAppleLogoDensity(width: number, height: number): Density {
  if (width <= 160 && height <= 50) return "1x";
  if (width <= 320 && height <= 100) return "2x";
  return "3x";
  if (width <= 480 && height <= 150) return "3x";

  throw validationError(
    "apple_logo_invalid_dimensions",
    `Logo Apple inválida: ${width}x${height}px. A Apple recomenda logo.png com no máximo 160x50pt; neste fluxo aceitamos até 160x50, 320x100 ou 480x150 px.`,
    createAssetDetails("appleLogo", "images.appleLogo", "Logo Apple", {
      actual: { width, height, unit: "px" },
      expected: [
        { density: "1x", maxWidth: 160, maxHeight: 50 },
        { density: "2x", maxWidth: 320, maxHeight: 100 },
        { density: "3x", maxWidth: 480, maxHeight: 150 },
      ],
      documentation:
        "Apple PassKit: logo.png is shown on all pass styles and should fit within 160x50 points.",
    }),
  );
}

async function createAppleLogoVariants(logoBytes: Uint8Array) {
  const logoOriginal = await Image.decode(logoBytes);

  let logo1xImage = logoOriginal;
  if (logoOriginal.width > 160) {
    logo1xImage = logoOriginal.resize(160, Image.RESIZE_AUTO);
  }

  let logo3xImage = logoOriginal;
  if (logoOriginal.width > 480) {
    logo3xImage = logoOriginal.resize(480, Image.RESIZE_AUTO);
  }

  return {
    logo1xBytes: new Uint8Array(await logo1xImage.encode()),
    logo3xBytes: new Uint8Array(await logo3xImage.encode()),
  };
}

function detectAppleStripDensity(
  style: AppleStyle,
  width: number,
  height: number,
): Density {
  if (style === "generic") {
    throw validationError(
      "apple_strip_unsupported_for_style",
      "O estilo generic não suporta strip.png. Remova a mídia Apple Strip ou troque o tipo do passe.",
      createAssetDetails("appleStrip", "images.appleStrip", "Apple Strip", {
        style,
        supportedStyles: ["storeCard", "coupon", "eventTicket"],
      }),
    );
  }

  // Keep backwards compatibility with the legacy flow, which accepted any
  // valid PNG strip and packaged it as a high-density asset.
  return "3x";

  const allowed = style === "eventTicket"
    ? [
      { density: "1x", width: 375, height: 98 },
      { density: "2x", width: 750, height: 196 },
      { density: "3x", width: 1125, height: 294 },
    ]
    : [
      { density: "1x", width: 375, height: 144 },
      { density: "2x", width: 750, height: 288 },
      { density: "3x", width: 1125, height: 432 },
    ];

  const matched = allowed.find((size) =>
    size.width === width && size.height === height
  );
  if (matched) return matched.density as Density;

  throw validationError(
    "apple_strip_invalid_dimensions",
    `Apple Strip inválida para ${
      styleLabel(style)
    }: ${width}x${height}px. Reenvie um PNG exatamente em um dos tamanhos suportados.`,
    createAssetDetails("appleStrip", "images.appleStrip", "Apple Strip", {
      style,
      actual: { width, height, unit: "px" },
      expected: allowed,
      documentation:
        "Use strip.png apenas nos estilos suportados, no tamanho correto para o layout do passe.",
    }),
  );
}

function assertPassHasRequiredFields(params: {
  description: string | null;
  organizationName: string | null;
  passTypeIdentifier: string | null;
  teamIdentifier: string | null;
}) {
  if (!params.description) {
    throw validationError(
      "missing_description",
      "description é obrigatório para criar o passe Apple.",
      { field: "description" },
    );
  }

  if (!params.organizationName) {
    throw validationError(
      "missing_organization_name",
      "organizationName é obrigatório para criar o passe Apple.",
      { field: "organizationName" },
      false,
    );
  }

  if (!params.passTypeIdentifier) {
    throw configError(
      "missing_pass_type_identifier",
      "passTypeIdentifier não encontrado (wallet_templates.defaults ou env APPLE_PASS_TYPE_IDENTIFIER).",
      { field: "passTypeIdentifier" },
    );
  }

  if (!params.teamIdentifier) {
    throw configError(
      "missing_team_identifier",
      "teamIdentifier não encontrado (wallet_templates.defaults ou env APPLE_TEAM_ID).",
      { field: "teamIdentifier" },
    );
  }
}

type ResolvedAsset = {
  key: "icon" | "appleLogo" | "appleStrip";
  field: string;
  displayName: string;
  url: string;
  bytes: Uint8Array;
  metadata: ReturnType<typeof readPngMetadata>;
  density?: Density;
  isFallback: boolean;
};

async function fetchValidatedPngAsset(params: {
  key: "icon" | "appleLogo" | "appleStrip";
  field: string;
  displayName: string;
  url: string;
  isFallback: boolean;
}) {
  const response = await fetch(params.url);

  if (!response.ok) {
    const details = createAssetDetails(
      params.key,
      params.field,
      params.displayName,
      {
        url: params.url,
        httpStatus: response.status,
      },
    );

    if (params.isFallback) {
      throw configError(
        "apple_default_asset_unavailable",
        `Não foi possível baixar o asset padrão \"${params.displayName}\" (HTTP ${response.status}).`,
        details,
      );
    }

    throw validationError(
      "apple_asset_download_failed",
      `Não foi possível baixar \"${params.displayName}\" a partir da URL configurada (HTTP ${response.status}). Reenvie a mídia.`,
      details,
    );
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  let metadata: ReturnType<typeof readPngMetadata>;

  try {
    metadata = readPngMetadata(bytes, params.displayName);
  } catch (error) {
    const apiError = asApiError(error);
    apiError.details = {
      ...createAssetDetails(params.key, params.field, params.displayName, {
        url: params.url,
      }),
      ...(apiError.details ?? {}),
    };
    throw apiError;
  }

  return {
    key: params.key,
    field: params.field,
    displayName: params.displayName,
    url: params.url,
    bytes,
    metadata,
    isFallback: params.isFallback,
  } as ResolvedAsset;
}

function assertNoUnsupportedImageCombination(
  style: AppleStyle,
  mergedImages: any,
) {
  const hasStrip = !!cleanString(mergedImages?.appleStrip);
  const hasBackground = !!cleanString(mergedImages?.background) ||
    !!cleanString(mergedImages?.appleBackground);
  const hasThumbnail = !!cleanString(mergedImages?.thumbnail) ||
    !!cleanString(mergedImages?.appleThumbnail);

  if (style === "generic" && hasStrip) {
    throw validationError(
      "apple_strip_unsupported_for_style",
      "O estilo generic não suporta Apple Strip. Remova a mídia antes de tentar novamente.",
      createAssetDetails("appleStrip", "images.appleStrip", "Apple Strip", {
        style,
        supportedStyles: ["storeCard", "coupon", "eventTicket"],
      }),
    );
  }

  if (style === "eventTicket" && hasStrip && (hasBackground || hasThumbnail)) {
    throw validationError(
      "apple_event_ticket_conflicting_images",
      "Para eventTicket, não combine strip.png com background.png ou thumbnail.png. Remova a mídia conflitante e tente novamente.",
      {
        style,
        strip: hasStrip,
        background: hasBackground,
        thumbnail: hasThumbnail,
      },
    );
  }
}

async function resolveAndValidateAssets(params: {
  mergedImages: any;
  style: AppleStyle;
}) {
  assertNoUnsupportedImageCombination(params.style, params.mergedImages);

  const iconUrl = ensureHttpUrl(params.mergedImages?.icon) ??
    storagePublicUrl("templates/default/icon.png");

  const logoUrl = ensureHttpUrl(params.mergedImages?.appleLogo) ??
    ensureHttpUrl(params.mergedImages?.logo) ??
    storagePublicUrl("templates/default/logo.png");

  const stripUrl = ensureHttpUrl(params.mergedImages?.appleStrip);

  if (!iconUrl) {
    throw validationError(
      "missing_icon_url",
      "A URL de images.icon é inválida.",
      createAssetDetails("icon", "images.icon", "Icon"),
      false,
    );
  }

  if (!logoUrl) {
    throw validationError(
      "missing_apple_logo_url",
      "A URL de images.appleLogo é inválida.",
      createAssetDetails("appleLogo", "images.appleLogo", "Logo Apple"),
    );
  }

  const requests: Array<Promise<ResolvedAsset>> = [
    fetchValidatedPngAsset({
      key: "icon",
      field: "images.icon",
      displayName: "Icon",
      url: iconUrl,
      isFallback: !cleanString(params.mergedImages?.icon),
    }),
    fetchValidatedPngAsset({
      key: "appleLogo",
      field: cleanString(params.mergedImages?.appleLogo)
        ? "images.appleLogo"
        : "images.logo",
      displayName: "Logo Apple",
      url: logoUrl,
      isFallback: !cleanString(params.mergedImages?.appleLogo) &&
        !cleanString(params.mergedImages?.logo),
    }).then((asset) => ({
      ...asset,
      density: detectAppleLogoDensity(
        asset.metadata.width,
        asset.metadata.height,
      ),
    })),
  ];

  if (stripUrl) {
    requests.push(
      fetchValidatedPngAsset({
        key: "appleStrip",
        field: "images.appleStrip",
        displayName: "Apple Strip",
        url: stripUrl,
        isFallback: false,
      }).then((asset) => ({
        ...asset,
        density: detectAppleStripDensity(
          params.style,
          asset.metadata.width,
          asset.metadata.height,
        ),
      })),
    );
  }

  const assets = await Promise.all(requests);

  return {
    icon: assets.find((asset) => asset.key === "icon")!,
    appleLogo: assets.find((asset) => asset.key === "appleLogo")!,
    appleStrip: assets.find((asset) => asset.key === "appleStrip") ?? null,
  };
}

function buildValidationResult(params: {
  style: AppleStyle;
  assets: Awaited<ReturnType<typeof resolveAndValidateAssets>>;
}) {
  return {
    ok: true,
    message: "Assets Apple validados com sucesso.",
    style: params.style,
    assets: {
      icon: {
        width: params.assets.icon.metadata.width,
        height: params.assets.icon.metadata.height,
        field: params.assets.icon.field,
      },
      appleLogo: {
        width: params.assets.appleLogo.metadata.width,
        height: params.assets.appleLogo.metadata.height,
        field: params.assets.appleLogo.field,
        density: params.assets.appleLogo.density,
      },
      appleStrip: params.assets.appleStrip
        ? {
          width: params.assets.appleStrip.metadata.width,
          height: params.assets.appleStrip.metadata.height,
          field: params.assets.appleStrip.field,
          density: params.assets.appleStrip.density,
        }
        : null,
    },
  };
}

serve(async (req: Request) => {
  const requestId = crypto.randomUUID();
  const origin = req.headers.get("Origin") || "*";

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  try {
    let tokenFromQuery: string | null = null;
    let suppressPointsNotification = false;
    if (req.method === "GET") {
      const url = new URL(req.url);
      tokenFromQuery = url.searchParams.get("token");
      suppressPointsNotification =
        url.searchParams.get("suppress_points_notification") === "1";
      if (!tokenFromQuery) {
        throw validationError("missing_token", "Missing token", {
          field: "token",
        }, false);
      }
    }

    const body = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    if (req.method === "POST") {
      suppressPointsNotification = body?.suppress_points_notification === true;
    }
    const validateOnly = body?.validate_only === true;

    let project_id = body?.project_id ?? null;
    let pass_data = body?.pass_data ?? {};

    let sb: any = null;
    let up: any = null;
    let passRow: any = null;
    let templateDefaults: any = {};
    let globalDefaults: any = {};

    if (tokenFromQuery) {
      const loaded = await loadByToken(tokenFromQuery);
      sb = loaded.sb;
      up = loaded.up;
      passRow = loaded.passRow;
      templateDefaults = loaded.templateDefaults;
      globalDefaults = loaded.globalDefaults;
      const passDesign = normalizeDefaults(passRow?.design);

      project_id = passRow.project_id;

      pass_data = {
        ...pass_data,
        type: passRow.type ?? up.pass_type ?? "loyalty",
        title: passRow.title ?? "Cartão Fidelidade",
        description: passRow.description ?? "",
        fields: { ...(passRow.fields ?? {}), ...(up.metadata ?? {}) },
        colors: normalizeDefaults(passDesign?.colors),
        images: normalizeDefaults(passDesign?.images),
        short_code: passRow.short_code,
        exp_date: up.expires_at,
        serialNumber: up.pass_token,
        qrMessage: up.pass_token,
      };
    }

    if (!project_id) {
      throw validationError(
        "missing_project_id",
        "O campo project_id é obrigatório.",
        { field: "project_id" },
        false,
      );
    }

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      throw configError(
        "missing_supabase_credentials",
        "SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios.",
      );
    }

    if (!sb) {
      sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }

    if (!passRow) {
      const explicitPassId = cleanString(pass_data?.pass_id) ??
        cleanString(pass_data?.id) ??
        cleanString(body?.pass_id);
      const explicitShortCode = cleanString(pass_data?.short_code);

      const dbPassRow = await loadPassRowByReference(
        sb,
        project_id,
        explicitPassId,
        explicitShortCode,
      );

      if (dbPassRow) {
        passRow = dbPassRow;
        const passDesign = normalizeDefaults(passRow?.design);
        pass_data = {
          ...pass_data,
          type: passRow.type ?? pass_data?.type,
          title: passRow.title ?? pass_data?.title,
          description: passRow.description ?? pass_data?.description,
          fields: { ...(passRow.fields ?? {}), ...(pass_data?.fields ?? {}) },
          colors: normalizeDefaults(passDesign?.colors),
          images: normalizeDefaults(passDesign?.images),
          short_code: passRow.short_code ?? pass_data?.short_code,
        };
      }
    }

    const projectName = await loadProjectName(sb, project_id);
    const finalPassData: any = {
      ...globalDefaults,
      ...templateDefaults,
      ...pass_data,
    };

    if (passRow) {
      const passDesign = normalizeDefaults(passRow?.design);
      finalPassData.colors = normalizeDefaults(passDesign?.colors);
      finalPassData.images = normalizeDefaults(passDesign?.images);
    }

    const passMode = getPassMode(finalPassData?.type);
    const currentPoints = parsePointsValue(
      pickFirstPoints(finalPassData?.fields ?? {}),
    );
    const currentBalanceCents = pickBalanceCents(finalPassData?.fields ?? {});
    finalPassData.rewards_available = passMode === "value"
      ? await loadAvailableRewardsForBalance(
        sb,
        project_id,
        currentBalanceCents,
      )
      : await loadAvailableRewardsForPoints(
        sb,
        project_id,
        currentPoints,
      );

    const resolvedSerialNumber = cleanString(finalPassData.serialNumber) ??
      crypto.randomUUID();
    const resolvedDescription = cleanString(finalPassData.description) ??
      cleanString(templateDefaults.description) ??
      cleanString(globalDefaults.description) ??
      "Cartão de fidelidade";
    const resolvedOrg = projectName ?? "Carteira 4.9";

    const envPassType = cleanString(Deno.env.get("APPLE_PASS_TYPE_IDENTIFIER"));
    const envTeamId = cleanString(Deno.env.get("APPLE_TEAM_ID"));

    const resolvedPassTypeIdentifier =
      cleanString(finalPassData.passTypeIdentifier) ??
        resolveIdentifier(templateDefaults, "passTypeIdentifier") ??
        resolveIdentifier(globalDefaults, "passTypeIdentifier") ??
        cleanString(getPath(finalPassData, "pass.passTypeIdentifier")) ??
        envPassType;

    const resolvedTeamIdentifier = cleanString(finalPassData.teamIdentifier) ??
      resolveIdentifier(templateDefaults, "teamIdentifier") ??
      resolveIdentifier(globalDefaults, "teamIdentifier") ??
      cleanString(getPath(finalPassData, "pass.teamIdentifier")) ??
      envTeamId;

    assertPassHasRequiredFields({
      description: resolvedDescription,
      organizationName: resolvedOrg,
      passTypeIdentifier: resolvedPassTypeIdentifier,
      teamIdentifier: resolvedTeamIdentifier,
    });

    const style = mapTemplateStyle(finalPassData.type);
    const title = cleanString(finalPassData.title) ?? "Cartão Fidelidade";
    const colors = mapColors(finalPassData.colors);
    const mergedImages = passRow
      ? {
        ...(finalPassData?.images ?? {}),
      }
      : {
        ...(globalDefaults?.images ?? {}),
        ...(templateDefaults?.images ?? {}),
        ...(pass_data?.images ?? {}),
      };

    const assets = await resolveAndValidateAssets({
      mergedImages,
      style,
    });

    if (validateOnly) {
      return jsonResponse(
        {
          ...buildValidationResult({ style, assets }),
          requestId,
        },
        200,
        origin,
      );
    }

    const qrMessage = cleanString(finalPassData.qrMessage) ??
      cleanString(finalPassData.qr_url) ??
      cleanString(finalPassData.universal_url) ??
      resolvedSerialNumber;

    const appleFields = buildAppleFields(finalPassData, {
      suppressPointsNotification,
    });

    const applePayload: any = {
      description: resolvedDescription,
      organizationName: resolvedOrg,
      passTypeIdentifier: resolvedPassTypeIdentifier,
      teamIdentifier: resolvedTeamIdentifier,
      logoText: title,
      ...colors,
      barcodes: [
        {
          format: "PKBarcodeFormatQR",
          message: qrMessage,
          messageEncoding: "iso-8859-1",
        },
      ],
    };

    const resolvedPassId = cleanString(finalPassData.pass_id) ??
      cleanString(finalPassData.id) ??
      cleanString(passRow?.id);

    const resolvedShortCode = cleanString(finalPassData.short_code) ??
      cleanString(passRow?.short_code);

    const passLocations = await loadPassLocationsApple(
      sb,
      project_id,
      resolvedPassId,
      resolvedShortCode,
    );

    if (passLocations.length > 0) {
      applePayload.locations = passLocations.map((l) => ({
        latitude: l.lat,
        longitude: l.lng,
        relevantText: cleanString(l.description) ??
          DEFAULT_LOCATION_RELEVANT_TEXT,
      }));
    }

    const PASSKIT_WS_URL = cleanString(Deno.env.get("PASSKIT_WEB_SERVICE_URL"));
    if (!PASSKIT_WS_URL) {
      throw configError(
        "missing_web_service_url",
        "Missing env: PASSKIT_WEB_SERVICE_URL",
      );
    }

    applePayload.webServiceURL = PASSKIT_WS_URL;
    applePayload.authenticationToken = resolvedSerialNumber;
    applePayload[style] = {
      ...(applePayload[style] ?? {}),
      ...appleFields,
    };

    const template = new Template(style as any, applePayload);

    const certEnv = Deno.env.get("CERTIFICATE_PEM");
    const keyEnv = Deno.env.get("PRIVATE_KEY_PEM");
    if (!certEnv || !keyEnv) {
      throw configError(
        "missing_signing_material",
        "CERTIFICATE_PEM e PRIVATE_KEY_PEM são obrigatórios para assinar o passe Apple.",
      );
    }

    const certificate = decodePemOrBase64(
      certEnv,
      "CERTIFICATE_PEM",
      requestId,
    );
    const privateKey = decodePemOrBase64(keyEnv, "PRIVATE_KEY_PEM", requestId);

    const signerSecret = cleanString(Deno.env.get("SIGNER_SECRET"));
    if (signerSecret) {
      (template as any).setCertificate(certificate, signerSecret);
    } else (template as any).setCertificate(certificate);

    (template as any).setPrivateKey(privateKey);

    const pass = (template as any).createPass({
      serialNumber: resolvedSerialNumber,
    });

    forcePassRequiredFields(pass, {
      description: resolvedDescription,
      organizationName: resolvedOrg,
      passTypeIdentifier: resolvedPassTypeIdentifier!,
      teamIdentifier: resolvedTeamIdentifier!,
    });

    const images = (pass as any).images;
    const { logo1xBytes, logo3xBytes } = await createAppleLogoVariants(
      assets.appleLogo.bytes,
    );

    await images.add("icon", Buffer.from(assets.icon.bytes));

    await images.add("logo", Buffer.from(logo1xBytes));
    await images.add("logo", Buffer.from(logo3xBytes), "3x");

    if (assets.appleStrip) {
      await images.add("strip", Buffer.from(assets.appleStrip.bytes), "3x");
    }

    const buffer = await (pass as any).asBuffer();

    return new Response(buffer, {
      headers: {
        ...corsHeaders(origin),
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition":
          `attachment; filename="pass_${project_id}.pkpass"`,
      },
    });
  } catch (err: unknown) {
    console.error(`[${requestId}] ❌ Erro ao gerar passe:`, err);
    return errorResponse(err, requestId, origin);
  }
});
