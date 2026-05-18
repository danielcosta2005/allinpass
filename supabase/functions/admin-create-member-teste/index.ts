import { corsHeaders } from "./cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.30.0";

function generatePassword() {
  const length = 12;
  const charset =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()";
  let retVal = "";
  for (let i = 0, n = charset.length; i < length; ++i) {
    retVal += charset.charAt(Math.floor(Math.random() * n));
  }
  return retVal;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getBearerToken(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

async function getCallerProfile(supabaseAdmin: any, req: Request) {
  const token = getBearerToken(req);
  if (!token) throw new HttpError(401, "Missing Authorization header");

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) throw new HttpError(401, "Sessão inválida.");

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) throw profileError;
  return { user, profile };
}

function ensureSuperadmin(caller: { profile?: { role?: string } | null }) {
  if (caller.profile?.role !== "superadmin") {
    throw new HttpError(403, "Acesso negado. Apenas superadmins podem criar membros.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, password, projectId, role } = await req.json();
    const normalizedEmail = String(email).trim().toLowerCase();

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    ensureSuperadmin(await getCallerProfile(supabaseAdmin, req));

    let userId: string | null = null;
    let inviteSent = false;

    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) throw listError;

    const existingUser = users.find(u => u.email?.toLowerCase() === normalizedEmail);

    if (existingUser) {
      // User existe -> get id.
      userId = existingUser.id;
    } else {
      // User não existe
      if (password && password.trim().length > 0) {
        const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
          email: normalizedEmail,
          password: password.trim(),
          email_confirm: true,
        });
        if (createError) throw createError;
        userId = newUser.user.id;
      } else {
        const { data: invited, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail);
        if (inviteError) throw inviteError;
        userId = invited.user?.id ?? null;
        inviteSent = true;
      }
    }

    if (!userId) throw new Error("Não foi possível determinar o userId.");

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        email: normalizedEmail,
        role: 'establishment',
        created_at: new Date().toISOString(),
      }, { onConflict: "id" });

    if (profileError) throw profileError;

    const { error: linkError } = await supabaseAdmin
      .from("project_members")
      .upsert({
        project_id: projectId,
        user_id: userId,
        role, // staff or owner
      }, { onConflict: "project_id,user_id" });

    if (linkError) throw linkError;

    return new Response(JSON.stringify({ success: true, userId, inviteSent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    console.error("Erro na função admin-create-member:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: error instanceof HttpError ? error.status : 400,
    });
  }
});
