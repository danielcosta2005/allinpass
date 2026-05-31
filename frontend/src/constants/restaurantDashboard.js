import { BarChart3, Bell, Gift, History, ScanLine, Users } from 'lucide-react';

export const SUPPORT_MESSAGE = 'Ola, preciso de suporte no Allin Pass.';

export const SUPPORT_WHATSAPP_URL =
  import.meta.env.VITE_RESTAURANT_SUPPORT_WHATSAPP_URL ||
  `https://wa.me/?text=${encodeURIComponent(SUPPORT_MESSAGE)}`;

export const DASHBOARD_TABS = [
  { value: 'kpis', label: 'KPIs', icon: BarChart3 },
  { value: 'scanner', label: 'Scanner', icon: ScanLine },
  { value: 'customers', label: 'Clientes', icon: Users },
  { value: 'members', label: 'Membros', icon: Users },
  { value: 'visits', label: 'Visitas', icon: History },
  { value: 'notifications', label: 'Notificacoes', icon: Bell },
  { value: 'rewards', label: 'Recompensas', icon: Gift },
];

export const ALLOWED_TABS = new Set(DASHBOARD_TABS.map((tab) => tab.value));
