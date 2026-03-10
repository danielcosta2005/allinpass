import React, { useState } from "react";
import { Bell, Send, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import NotificationsTab from "@/components/restaurant/NotificationsTab";
import NotificationsManager from "@/components/restaurant/NotificationsManager";
import AutomationsTab from "@/components/restaurant/AutomationsTab";

export default function NotificationsDashboard({ projectId }) {
  const [activeTab, setActiveTab] = useState("send");

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-gray-900">Central de Notificações</h2>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          Gerencie envios manuais, acompanhe campanhas e construa automações em um unico lugar.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap gap-2 lg:w-auto lg:inline-flex">
          <TabsTrigger value="send" className="gap-2">
            <Send className="h-4 w-4" />
            Enviar
          </TabsTrigger>
          <TabsTrigger value="manager" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Gerenciar
          </TabsTrigger>
          <TabsTrigger value="automations" className="gap-2">
            <Bell className="h-4 w-4" />
            Automações
          </TabsTrigger>
        </TabsList>

        <TabsContent value="send">
          <NotificationsTab projectId={projectId} />
        </TabsContent>

        <TabsContent value="manager">
          <NotificationsManager projectId={projectId} />
        </TabsContent>

        <TabsContent value="automations">
          <AutomationsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
