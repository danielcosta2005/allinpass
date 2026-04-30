// create-project

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "./cors.ts";

// Admin client
const getSupabaseAdminClient = () =>
  createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

// slugify sem dependências
function slugify(input: string) {
  const base = input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.length ? base : "projeto";
}

function randSuffix(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  // ✅ Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  try {
    const { name, description, logo_url } = await req.json().catch(() => ({}));

    if (!name || String(name).trim().length === 0) {
      return new Response(JSON.stringify({ error: "O nome do projeto é obrigatório." }), {
        status: 400,
        headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = getSupabaseAdminClient();

    // ✅ gera slug
    const baseSlug = slugify(String(name));
    const slug = `${baseSlug}-${randSuffix(6)}`.slice(0, 64);
    const projectName = String(name).trim();

    // ✅ defaults iniciais do wallet template
   const walletDefaults = {
  type: "loyalty",
  title: projectName,
  description: `Cartão de benefícios ${projectName}`,
  organizationName: "Khaos Omni LTDA",
  passTypeIdentifier: "pass.com.khaosomni.carteira49",
  teamIdentifier: "JM2D9G6ZFB",
  colors: {
    text: "#ffffff",
    label: "#ffffff",
    background: "#6c5ce7",
  },
  images: {
    icon:
      "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/icon.png",
    appleLogo:
      "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/logo.png",
    googleLogo:
      "https://tjagxmusbnbipeeitsyi.supabase.co/storage/v1/object/public/pass-assets/templates/default/logo.png",
    appleStrip: null,
    googleHero: null,
  },
};

    // ✅ 1) cria projeto
    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects")
      .insert({
        name: String(name).trim(),
        slug,
        description: typeof description === "string" ? description.trim() : null,
        logo_url: typeof logo_url === "string" ? logo_url.trim() : null,
        auth_mode: "form_only",
      })
      .select("id, name, slug, description, logo_url, auth_mode, created_at")
      .single();

    if (projectError) throw projectError;

    // ✅ 2) cria template do projeto (wallet_templates)
    const { error: templateError } = await supabaseAdmin
      .from("wallet_templates")
      .insert({
        project_id: project.id,
        name: "Template do Projeto",
        defaults: walletDefaults,
      });

    if (templateError) {
      // rollback opcional
      await supabaseAdmin.from("projects").delete().eq("id", project.id);
      throw templateError;
    }

    return new Response(JSON.stringify({ project, wallet_defaults: walletDefaults }), {
      status: 201,
      headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Erro ao criar projeto:", error);
    return new Response(
      JSON.stringify({ error: error?.message || "Ocorreu um erro interno." }),
      { status: 500, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } },
    );
  }
});
