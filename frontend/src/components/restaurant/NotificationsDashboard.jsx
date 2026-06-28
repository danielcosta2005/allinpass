import React, { useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";

import NotificationsTab from "@/components/restaurant/NotificationsTab";
import NotificationsManager from "@/components/restaurant/NotificationsManager";
import AutomationsTab from "@/components/restaurant/AutomationsTab";

export default function NotificationsDashboard({
  activeTab = "send",
  memberRole,
  onTabChange,
  projectId,
}) {
  const isLoadingMemberRole = memberRole === undefined;
  const isStaff = memberRole === "staff";
  const canSendNotifications = memberRole === "owner";
  const defaultTab = canSendNotifications ? "send" : "manager";

  const allowedTabs = useMemo(() => {
    return new Set(canSendNotifications ? ["send", "manager", "automations"] : ["manager", "automations"]);
  }, [canSendNotifications]);
  const selectedTab = allowedTabs.has(activeTab) ? activeTab : defaultTab;

  useEffect(() => {
    if (isLoadingMemberRole) return;
    if (!allowedTabs.has(activeTab)) {
      onTabChange?.(defaultTab);
    }
  }, [activeTab, allowedTabs, defaultTab, isLoadingMemberRole, onTabChange]);

  return (
    <div className="space-y-4">
      {isLoadingMemberRole ? (
        <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground shadow-sm">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Carregando permissoes...
        </div>
      ) : (
        <div className="space-y-4">
          {selectedTab === "send" && canSendNotifications ? (
            <NotificationsTab projectId={projectId} />
          ) : null}

          {selectedTab === "manager" ? (
            <NotificationsManager
              projectId={projectId}
              isStaff={isStaff}
              canCancelCampaigns={canSendNotifications}
              sentOnly={!canSendNotifications}
            />
          ) : null}

          {selectedTab === "automations" ? (
            <AutomationsTab
              projectId={projectId}
              isStaff={isStaff}
              canManageAutomations={canSendNotifications}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
