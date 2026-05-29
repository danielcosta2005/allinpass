import React, { useEffect, useMemo, useState } from "react";
import { Bell, Loader2, Send, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import NotificationsTab from "@/components/restaurant/NotificationsTab";
import NotificationsManager from "@/components/restaurant/NotificationsManager";
import AutomationsTab from "@/components/restaurant/AutomationsTab";
import { useAuth } from "@/contexts/SupabaseAuthContext";
import { supabase } from "@/lib/supabaseClient";

export default function NotificationsDashboard({ projectId }) {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("send");
  const [memberRole, setMemberRole] = useState(undefined);

  const isLoadingMemberRole = memberRole === undefined;
  const isStaff = memberRole === "staff";
  const canSendNotifications = memberRole === "owner";
  const defaultTab = canSendNotifications ? "send" : "manager";

  const allowedTabs = useMemo(() => {
    return new Set(canSendNotifications ? ["send", "manager", "automations"] : ["manager", "automations"]);
  }, [canSendNotifications]);

  useEffect(() => {
    let cancelled = false;

    async function fetchMemberRole() {
      setMemberRole(undefined);

      if (!projectId || !user?.id) {
        setMemberRole(null);
        return;
      }

      const { data, error } = await supabase
        .from("project_members")
        .select("role")
        .eq("project_id", projectId)
        .eq("user_id", user.id)
        .maybeSingle();

      if (cancelled) return;
      setMemberRole(error ? null : data?.role || null);
    }

    fetchMemberRole();

    return () => {
      cancelled = true;
    };
  }, [projectId, user?.id]);

  useEffect(() => {
    if (isLoadingMemberRole) return;
    if (!allowedTabs.has(activeTab)) {
      setActiveTab(defaultTab);
    }
  }, [activeTab, allowedTabs, defaultTab, isLoadingMemberRole]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Central de Notificações</h2>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Gerencie envios manuais, acompanhe campanhas e construa automações em um único lugar.
        </p>
      </div>

      {isLoadingMemberRole ? (
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-600 shadow-sm">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Carregando permissoes...
        </div>
      ) : (
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-2 lg:w-auto lg:inline-flex">
          {canSendNotifications && (
            <TabsTrigger value="send" className="gap-2">
              <Send className="h-4 w-4" />
              Enviar
            </TabsTrigger>
          )}
          <TabsTrigger value="manager" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Gerenciar
          </TabsTrigger>
          <TabsTrigger value="automations" className="gap-2">
            <Bell className="h-4 w-4" />
            Automações
          </TabsTrigger>
        </TabsList>

        {canSendNotifications && (
          <TabsContent value="send">
            <NotificationsTab projectId={projectId} />
          </TabsContent>
        )}

        <TabsContent value="manager">
          <NotificationsManager
            projectId={projectId}
            isStaff={isStaff}
            canCancelCampaigns={canSendNotifications}
            sentOnly={!canSendNotifications}
          />
        </TabsContent>

        <TabsContent value="automations">
          <AutomationsTab
            projectId={projectId}
            isStaff={isStaff}
            canManageAutomations={canSendNotifications}
          />
        </TabsContent>
      </Tabs>
      )}
    </div>
  );
}
