import { BarChart3, Bell, Gift, History, ScanLine, Send, Settings2, Users, Wallet } from 'lucide-react';

export const SUPPORT_MESSAGE = 'Ola, preciso de suporte no Allin Pass.';

export const SUPPORT_WHATSAPP_URL =
  import.meta.env.VITE_RESTAURANT_SUPPORT_WHATSAPP_URL ||
  `https://wa.me/?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

export const NOTIFICATION_SUBTABS = [
  { value: 'send', label: 'Enviar', icon: Send },
  { value: 'manager', label: 'Gerenciar', icon: Settings2 },
  { value: 'automations', label: 'Automacoes', icon: Bell },
];

export const REWARD_SUBTABS = [
  { value: 'rewards', label: 'Recompensas', icon: Gift },
  { value: 'history', label: 'Historico de resgates', icon: History },
];

export const DASHBOARD_TABS = [
  { value: 'kpis', label: 'KPIs', icon: BarChart3 },
  { value: 'scanner', label: 'Scanner', icon: ScanLine },
  { value: 'wallet', label: 'Cartões', icon: Wallet },
  { value: 'notifications', label: 'Notificações', icon: Bell, children: NOTIFICATION_SUBTABS },
  { value: 'rewards', label: 'Recompensas', icon: Gift, children: REWARD_SUBTABS },
  { value: 'customers', label: 'Clientes', icon: Users },
  { value: 'visits', label: 'Visitas', icon: History },
  { value: 'members', label: 'Membros', icon: Users },
];

export const ALLOWED_TABS = new Set(DASHBOARD_TABS.map((tab) => tab.value));
