import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  assertProjectBillingActive,
  getProjectBillingInactivePayload,
  isProjectBillingInactiveError,
} from "../_shared/billingAccess.ts";
// branch

type AutomationType = "expiring_soon" | "days_without_visit";
type AutomationStatus = "on" | "off";

type CreateAutomationBody = {
  project_id: string;
  type: AutomationType;
  quantity: number;
  message: string;
  status?: AutomationStatus;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function isValidType(type: string): type is AutomationType {
  return ["expiring_soon", "days_without_visit"].includes(type);
}

function isValidStatus(status: string): status is AutomationStatus {
  return ["on", "off"].includes(status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return jsonResponse({ ok: true });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header" }, 401);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const body = (await req.json()) as CreateAutomationBody;

    const projectId = body.project_id?.trim();
    const type = body.type;
    const quantity = Number(body.quantity);
    const message = body.message?.trim();
    const status = body.status ?? "on";

    if (!projectId) {
      return jsonResponse({ error: "project_id is required" }, 400);
    }

    if (!type || !isValidType(type)) {
      return jsonResponse({ error: "Invalid type" }, 400);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return jsonResponse({ error: "quantity must be a positive integer" }, 400);
    }

    if (!message) {
      return jsonResponse({ error: "message is required" }, 400);
    }

    if (!isValidStatus(status)) {
      return jsonResponse({ error: "Invalid status" }, 400);
    }

    const { data: membership, error: membershipError } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .eq("role", "owner")
      .maybeSingle();

    if (membershipError) {
      return jsonResponse(
        {
          error: "Failed to validate project role",
          details: membershipError.message,
        },
        500,
      );
    }

    if (!membership) {
      return jsonResponse(
        { error: "Forbidden: only project owners can create automations" },
        403,
      );
    }

    await assertProjectBillingActive(supabase, projectId);

    const { data, error } = await supabase
      .from("automations")
      .insert({
        project_id: projectId,
        type,
        quantity,
        message,
        status,
      })
      .select()
      .single();

    if (error) {
      return jsonResponse(
        {
          error: "Failed to create automation",
          details: error.message,
        },
        400,
      );
    }

    return jsonResponse({
      success: true,
      automation: data,
    });
  } catch (err) {
    if (isProjectBillingInactiveError(err)) {
      return jsonResponse(getProjectBillingInactivePayload(err), 402);
    }

    return jsonResponse(
      {
        error: "Unexpected error",
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});
