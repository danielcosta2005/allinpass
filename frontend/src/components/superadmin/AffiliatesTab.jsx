import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  CheckCircle2,
  Copy,
  CreditCard,
  Edit3,
  FileSearch,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Search,
  UserPlus,
  Users,
  WalletCards,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
  buildPromotionalLinkUrl,
  createPromotionalCode,
  createSellerWithCoupon,
  listAffiliateCommissionClients,
  listAffiliateCommissions,
  listPromotionalCodes,
  listAffiliateSellers,
  markAffiliateCommissionPaid,
  markAffiliateSellerCompetencePaid,
  updateAffiliateSeller,
  updatePromotionalCode,
} from '@/lib/affiliates';

const PAGE_SIZE = 25;
const COUPON_PAGE_SIZE = 25;
const COMMISSION_PAGE_SIZE = 25;
const CLIENT_PAGE_SIZE = 20;
const EMPTY_SELLER_FORM = {
  name: '',
  phone: '',
  email: '',
  pixKey: '',
};
const EMPTY_COUPON_FORM = {
  code: '',
  sellerId: '',
  discountBps: 1000,
  commissionBps: 1000,
  status: 'active',
  maxUses: '',
  validUntil: '',
};
const PROMOTIONAL_CODE_PATTERN = /^[a-z0-9]{5,10}$/;

function getCurrentCompetence() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function toApiCompetence(value) {
  if (!value) return '';
  return value.length === 7 ? `${value}-01` : value;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMonth(value) {
  if (!value) return '-';
  const date = new Date(`${toApiCompetence(value)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

function formatCurrency(cents = 0, currency = 'BRL') {
  const amount = Number(cents || 0) / 100;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(amount);
}

function formatRateBps(rateBps = 0) {
  const value = Number(rateBps || 0) / 100;
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

function normalizePromotionalCodeInput(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
}

function generatePromotionalCode() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const randomValues = new Uint8Array(8);

  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomValues);
  } else {
    randomValues.forEach((_, index) => {
      randomValues[index] = Math.floor(Math.random() * 255);
    });
  }

  return Array.from(randomValues, (value) => alphabet[value % alphabet.length]).join('');
}

function formatUses(promotionalCode = {}) {
  const redeemedUses = Number(promotionalCode.redeemedUses || 0);
  const maxUses = promotionalCode.maxUses;

  if (!maxUses) return `${redeemedUses}`;
  return `${redeemedUses}/${maxUses}`;
}

function getCouponTypeLabel(promotionalCode = {}) {
  return promotionalCode.sellerId ? 'Cupom de vendedor' : 'Cupom de campanha';
}

function getStatusLabel(status) {
  return status === 'inactive' ? 'Inativo' : 'Ativo';
}

function getCommissionStatusLabel(status) {
  if (status === 'paid') return 'Pago';
  if (status === 'void') return 'Anulado';
  return 'Pendente';
}

function getSubscriptionStatusLabel(status) {
  if (!status) return 'Sem assinatura';
  const normalized = String(status).toLowerCase();
  if (normalized.includes('cancel')) return 'Cancelada';
  if (normalized.includes('active')) return 'Ativa';
  if (normalized.includes('paid')) return 'Paga';
  if (normalized.includes('pending')) return 'Pendente';
  if (normalized.includes('past_due') || normalized.includes('overdue')) return 'Inadimplente';
  return status;
}

function getClientInvestigationStatus(client) {
  const commissions = Array.isArray(client.commissions) ? client.commissions : [];
  const subscriptionStatus = String(client.subscription?.status || '').toLowerCase();

  if (commissions.some((commission) => commission.status === 'paid')) {
    return 'Comissão já paga';
  }

  if (commissions.length > 0) {
    return 'Comissão gerada';
  }

  if (subscriptionStatus.includes('cancel')) {
    return 'Assinatura cancelada';
  }

  if (subscriptionStatus.includes('past_due') || subscriptionStatus.includes('overdue')) {
    return 'Pagamento pendente/falho';
  }

  return 'Sem pagamento confirmado';
}

function StatusBadge({ status }) {
  const isInactive = status === 'inactive';

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
        isInactive
          ? 'border-border bg-muted text-muted-foreground'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300'
      }`}
    >
      {getStatusLabel(status)}
    </span>
  );
}

function CommissionStatusBadge({ status }) {
  const classes = {
    paid: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-500/10 dark:text-emerald-300',
    void: 'border-border bg-muted text-muted-foreground',
    pending: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-300',
  };

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
        classes[status] || classes.pending
      }`}
    >
      {getCommissionStatusLabel(status)}
    </span>
  );
}

function SubscriptionStatusBadge({ status }) {
  return (
    <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700 dark:border-sky-400/30 dark:bg-sky-500/10 dark:text-sky-300">
      {getSubscriptionStatusLabel(status)}
    </span>
  );
}

function SummaryTile({ icon: Icon, label, value, helper }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </div>
      <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
      {helper && <p className="mt-1 text-xs text-muted-foreground">{helper}</p>}
    </div>
  );
}

const AffiliatesTab = () => {
  const { toast } = useToast();
  const [adminView, setAdminView] = useState('sellers');
  const [sellers, setSellers] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [coupons, setCoupons] = useState([]);
  const [couponPage, setCouponPage] = useState(1);
  const [couponTotal, setCouponTotal] = useState(0);
  const [couponsLoading, setCouponsLoading] = useState(true);
  const [couponStatusFilter, setCouponStatusFilter] = useState('');
  const [couponTypeFilter, setCouponTypeFilter] = useState('');
  const [couponSellerFilter, setCouponSellerFilter] = useState('');
  const [couponSearchDraft, setCouponSearchDraft] = useState('');
  const [couponSearch, setCouponSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copyingLinkSellerId, setCopyingLinkSellerId] = useState(null);
  const [copyingCouponId, setCopyingCouponId] = useState(null);
  const [togglingCouponId, setTogglingCouponId] = useState(null);
  const [formMode, setFormMode] = useState('');
  const [activeSeller, setActiveSeller] = useState(null);
  const [activePromotionalCode, setActivePromotionalCode] = useState(null);
  const [sellerForm, setSellerForm] = useState(EMPTY_SELLER_FORM);
  const [couponForm, setCouponForm] = useState(EMPTY_COUPON_FORM);
  const [wizardStep, setWizardStep] = useState(1);
  const [negativeMarginAcknowledged, setNegativeMarginAcknowledged] = useState(false);
  const [selectedCompetence, setSelectedCompetence] = useState(getCurrentCompetence);
  const [selectedSellerId, setSelectedSellerId] = useState('');
  const [commissionStatusFilter, setCommissionStatusFilter] = useState('');
  const [commissions, setCommissions] = useState([]);
  const [commissionPage, setCommissionPage] = useState(1);
  const [commissionTotal, setCommissionTotal] = useState(0);
  const [commissionsLoading, setCommissionsLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [clientPage, setClientPage] = useState(1);
  const [clientTotal, setClientTotal] = useState(0);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [paymentNote, setPaymentNote] = useState('');
  const [markingCommissionId, setMarkingCommissionId] = useState(null);
  const [markingSellerId, setMarkingSellerId] = useState(null);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const couponTotalPages = useMemo(() => Math.max(1, Math.ceil(couponTotal / COUPON_PAGE_SIZE)), [couponTotal]);
  const commissionTotalPages = useMemo(
    () => Math.max(1, Math.ceil(commissionTotal / COMMISSION_PAGE_SIZE)),
    [commissionTotal],
  );
  const clientTotalPages = useMemo(
    () => Math.max(1, Math.ceil(clientTotal / CLIENT_PAGE_SIZE)),
    [clientTotal],
  );
  const isDialogOpen = Boolean(formMode);
  const selectedCompetenceForApi = useMemo(
    () => toApiCompetence(selectedCompetence),
    [selectedCompetence],
  );

  const visibleSellerSummary = useMemo(() => sellers.reduce((summary, seller) => {
    const sellerSummary = seller.summary || {};
    return {
      attributedClientsCount: summary.attributedClientsCount + Number(sellerSummary.attributedClientsCount || 0),
      pendingCommissionCents: summary.pendingCommissionCents + Number(sellerSummary.pendingCommissionCents || 0),
      paidCommissionCents: summary.paidCommissionCents + Number(sellerSummary.paidCommissionCents || 0),
      pendingCommissionCount: summary.pendingCommissionCount + Number(sellerSummary.pendingCommissionCount || 0),
    };
  }, {
    attributedClientsCount: 0,
    pendingCommissionCents: 0,
    paidCommissionCents: 0,
    pendingCommissionCount: 0,
  }), [sellers]);

  const sellerCouponsBySellerId = useMemo(() => {
    const entries = coupons
      .filter((coupon) => coupon.sellerId)
      .map((coupon) => [coupon.sellerId, coupon]);

    sellers.forEach((seller) => {
      if (seller.promotionalCode?.sellerId) {
        entries.push([seller.id, seller.promotionalCode]);
      }
    });

    return new Map(entries);
  }, [coupons, sellers]);

  const couponHasNegativeMargin = useMemo(() => (
    Number(couponForm.discountBps || 0) + Number(couponForm.commissionBps || 0) > 10000
  ), [couponForm.commissionBps, couponForm.discountBps]);

  const loadSellerPromotionalCodes = useCallback(async () => {
    const couponResult = await listPromotionalCodes({
      page: 1,
      pageSize: 1000,
      type: 'seller',
    });

    return new Map(
      couponResult.promotionalCodes.map((coupon) => [coupon.sellerId, coupon]),
    );
  }, []);

  const fetchSellers = useCallback(async (nextPage = page, { quiet = false } = {}) => {
    if (quiet) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const result = await listAffiliateSellers({
        page: nextPage,
        pageSize: PAGE_SIZE,
        search,
        includeSummary: true,
        competenceMonth: selectedCompetenceForApi,
      });
      const couponsBySellerId = await loadSellerPromotionalCodes();

      setSellers(result.sellers.map((seller) => ({
        ...seller,
        promotionalCode: seller.promotionalCode || couponsBySellerId.get(seller.id) || null,
      })));
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      toast({
        title: 'Erro ao carregar afiliados',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSellerPromotionalCodes, page, search, selectedCompetenceForApi, toast]);

  const fetchCoupons = useCallback(async (nextPage = couponPage, { quiet = false } = {}) => {
    if (!quiet) {
      setCouponsLoading(true);
    }

    try {
      const result = await listPromotionalCodes({
        page: nextPage,
        pageSize: COUPON_PAGE_SIZE,
        status: couponStatusFilter,
        type: couponTypeFilter,
        sellerId: couponSellerFilter,
        search: couponSearch,
      });

      setCoupons(result.promotionalCodes);
      setCouponTotal(result.total);
      setCouponPage(result.page);
    } catch (error) {
      toast({
        title: 'Erro ao carregar cupons',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCouponsLoading(false);
    }
  }, [couponPage, couponSearch, couponSellerFilter, couponStatusFilter, couponTypeFilter, toast]);

  const refreshCouponListsAfterMutation = useCallback(async () => {
    await Promise.all([
      fetchSellers(page, { quiet: true }),
      fetchCoupons(couponPage, { quiet: true }),
    ]);
  }, [couponPage, fetchCoupons, fetchSellers, page]);

  const fetchCommissions = useCallback(async () => {
    setCommissionsLoading(true);

    try {
      const result = await listAffiliateCommissions({
        page: commissionPage,
        pageSize: COMMISSION_PAGE_SIZE,
        sellerId: selectedSellerId,
        competenceMonth: selectedCompetenceForApi,
        status: commissionStatusFilter,
      });

      setCommissions(result.commissions);
      setCommissionTotal(result.total);
      setCommissionPage(result.page);
    } catch (error) {
      toast({
        title: 'Erro ao carregar comissões',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCommissionsLoading(false);
    }
  }, [commissionPage, commissionStatusFilter, selectedCompetenceForApi, selectedSellerId, toast]);

  const fetchClients = useCallback(async () => {
    setClientsLoading(true);

    try {
      const result = await listAffiliateCommissionClients({
        page: clientPage,
        pageSize: CLIENT_PAGE_SIZE,
        sellerId: selectedSellerId,
      });

      setClients(result.clients);
      setClientTotal(result.total);
      setClientPage(result.page);
    } catch (error) {
      toast({
        title: 'Erro ao carregar clientes indicados',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setClientsLoading(false);
    }
  }, [clientPage, selectedSellerId, toast]);

  useEffect(() => {
    fetchSellers(page);
  }, [fetchSellers, page]);

  useEffect(() => {
    fetchCoupons(couponPage);
  }, [fetchCoupons, couponPage]);

  useEffect(() => {
    fetchCommissions();
  }, [fetchCommissions]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const resetForm = () => {
    setSellerForm(EMPTY_SELLER_FORM);
    setCouponForm(EMPTY_COUPON_FORM);
    setActiveSeller(null);
    setActivePromotionalCode(null);
    setWizardStep(1);
    setNegativeMarginAcknowledged(false);
    setFormMode('');
  };

  const openCreateDialog = () => {
    setSellerForm(EMPTY_SELLER_FORM);
    setCouponForm({
      ...EMPTY_COUPON_FORM,
      code: generatePromotionalCode(),
    });
    setActiveSeller(null);
    setWizardStep(1);
    setNegativeMarginAcknowledged(false);
    setFormMode('create');
  };

  const openEditDialog = (seller) => {
    const sellerCoupon = seller.promotionalCode || sellerCouponsBySellerId.get(seller.id) || null;

    setSellerForm({
      name: seller.name || '',
      phone: seller.phone || '',
      email: seller.email || '',
      pixKey: seller.pixKey || '',
    });
    setCouponForm(sellerCoupon ? {
      code: sellerCoupon.code || '',
      sellerId: seller.id,
      discountBps: Number(sellerCoupon.discountBps || 0),
      commissionBps: Number(sellerCoupon.commissionBps || 0),
      status: sellerCoupon.status === 'inactive' ? 'inactive' : 'active',
      maxUses: sellerCoupon.maxUses || '',
      validUntil: sellerCoupon.validUntil ? String(sellerCoupon.validUntil).slice(0, 10) : '',
    } : {
      ...EMPTY_COUPON_FORM,
      sellerId: seller.id,
      code: seller.affiliateLink?.code || generatePromotionalCode(),
    });
    setActiveSeller(seller);
    setActivePromotionalCode(sellerCoupon);
    setNegativeMarginAcknowledged(Boolean(sellerCoupon?.metadata?.marginWarningAcknowledged));
    setFormMode('edit');
  };

  const openCreateCouponDialog = () => {
    setCouponForm({
      ...EMPTY_COUPON_FORM,
      code: generatePromotionalCode(),
      commissionBps: 0,
    });
    setActivePromotionalCode(null);
    setNegativeMarginAcknowledged(false);
    setFormMode('coupon-create');
  };

  const openEditCouponDialog = (promotionalCode) => {
    setCouponForm({
      code: promotionalCode.code || '',
      sellerId: promotionalCode.sellerId || '',
      discountBps: Number(promotionalCode.discountBps || 0),
      commissionBps: Number(promotionalCode.commissionBps || 0),
      status: promotionalCode.status === 'inactive' ? 'inactive' : 'active',
      maxUses: promotionalCode.maxUses || '',
      validUntil: promotionalCode.validUntil ? String(promotionalCode.validUntil).slice(0, 10) : '',
    });
    setActivePromotionalCode(promotionalCode);
    setNegativeMarginAcknowledged(false);
    setFormMode('coupon-edit');
  };

  const handleSellerFormChange = (field, value) => {
    setSellerForm((current) => ({ ...current, [field]: value }));
  };

  const handleCouponFormChange = (field, value) => {
    setCouponForm((current) => ({
      ...current,
      [field]: field === 'code' ? normalizePromotionalCodeInput(value) : value,
    }));
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const handleCouponSearchSubmit = (event) => {
    event.preventDefault();
    setCouponPage(1);
    setCouponSearch(couponSearchDraft.trim());
  };

  const handleCouponStatusFilterChange = (value) => {
    setCouponPage(1);
    setCouponStatusFilter(value === 'all' ? '' : value);
  };

  const handleCouponTypeFilterChange = (value) => {
    setCouponPage(1);
    setCouponTypeFilter(value === 'all' ? '' : value);
  };

  const handleCouponSellerFilterChange = (value) => {
    setCouponPage(1);
    setCouponSellerFilter(value === 'all' ? '' : value);
  };

  const handleSelectedSellerChange = (value) => {
    setCommissionPage(1);
    setClientPage(1);
    setSelectedSellerId(value === 'all' ? '' : value);
  };

  const handleCommissionStatusChange = (value) => {
    setCommissionPage(1);
    setCommissionStatusFilter(value === 'all' ? '' : value);
  };

  const handleCompetenceChange = (value) => {
    setPage(1);
    setCommissionPage(1);
    setSelectedCompetence(value || getCurrentCompetence());
  };

  const handleRefreshAll = () => {
    fetchSellers(page, { quiet: true });
    fetchCoupons(couponPage, { quiet: true });
    fetchCommissions();
    fetchClients();
  };

  const updateSellerPromotionalCode = (sellerId, promotionalCode) => {
    setSellers((current) => current.map((seller) => (
      seller.id === sellerId ? { ...seller, promotionalCode } : seller
    )));
  };

  const handleCopyLink = async (seller) => {
    const code = seller.affiliateLink?.code;
    if (!code) {
      toast({
        title: 'Link ausente',
        description: 'Gere o link antes de copiar.',
        variant: 'destructive',
      });
      return;
    }

    setCopyingLinkSellerId(seller.id);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Área de transferência indisponível neste navegador.');
      }

      const url = buildPromotionalLinkUrl(code);
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Link copiado',
        description: url,
      });
    } catch (error) {
      toast({
        title: 'Erro ao copiar link',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCopyingLinkSellerId(null);
    }
  };

  const validateSellerStep = () => {
    const hasContactRoute = sellerForm.phone.trim() || sellerForm.email.trim();

    if (!sellerForm.name.trim() || !sellerForm.pixKey.trim() || !hasContactRoute) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha nome, telefone ou email, e chave Pix para continuar.',
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const validateCouponForm = () => {
    if (!PROMOTIONAL_CODE_PATTERN.test(couponForm.code)) {
      toast({
        title: 'Cupom inválido',
        description: 'Use de 5 a 10 caracteres, apenas letras minúsculas e números.',
        variant: 'destructive',
      });
      return false;
    }

    if (couponHasNegativeMargin && !negativeMarginAcknowledged) {
      toast({
        title: 'Confirme o alerta de margem',
        description: 'Desconto e comissão passam de 100% do primeiro mês.',
        variant: 'destructive',
      });
      return false;
    }

    const maxUses = couponForm.maxUses === '' ? null : Number(couponForm.maxUses);
    const minimumMaxUses = Number(activePromotionalCode?.redeemedUses || 0);

    if (maxUses !== null && Number.isFinite(maxUses) && maxUses < minimumMaxUses) {
      toast({
        title: 'Limite menor que usos',
        description: `Este cupom ja tem ${minimumMaxUses} uso${minimumMaxUses === 1 ? '' : 's'} resgatado${minimumMaxUses === 1 ? '' : 's'}.`,
        variant: 'destructive',
      });
      return false;
    }

    return true;
  };

  const handleWizardNext = () => {
    if (validateSellerStep()) {
      setWizardStep(2);
    }
  };

  const handleCopyCoupon = async (sellerOrCoupon) => {
    const promotionalCode = sellerOrCoupon.promotionalCode || sellerOrCoupon;
    const code = promotionalCode?.code;

    if (!code) {
      toast({
        title: 'Cupom ausente',
        description: 'Este vendedor ainda não tem cupom promocional.',
        variant: 'destructive',
      });
      return;
    }

    setCopyingLinkSellerId(sellerOrCoupon.id);
    setCopyingCouponId(promotionalCode.id);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('Área de transferência indisponível neste navegador.');
      }

      const url = buildPromotionalLinkUrl(code);
      await navigator.clipboard.writeText(url);
      toast({
        title: 'Cupom copiado',
        description: url,
      });
    } catch (error) {
      toast({
        title: 'Erro ao copiar cupom',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setCopyingLinkSellerId(null);
      setCopyingCouponId(null);
    }
  };

  const handleToggleCouponStatus = async (promotionalCode) => {
    const nextStatus = promotionalCode.status === 'inactive' ? 'active' : 'inactive';

    setTogglingCouponId(promotionalCode.id);
    try {
      const updatedPromotionalCode = await updatePromotionalCode({
        promotionalCodeId: promotionalCode.id,
        status: nextStatus,
      });

      setCoupons((current) => current.map((coupon) => (
        coupon.id === updatedPromotionalCode.id ? updatedPromotionalCode : coupon
      )));
      if (updatedPromotionalCode.sellerId) {
        updateSellerPromotionalCode(updatedPromotionalCode.sellerId, updatedPromotionalCode);
      }
      await refreshCouponListsAfterMutation();
      toast({
        title: nextStatus === 'active' ? 'Cupom ativado' : 'Cupom inativado',
        description: `${updatedPromotionalCode.code} foi atualizado.`,
      });
    } catch (error) {
      toast({
        title: 'Erro ao alterar cupom',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setTogglingCouponId(null);
    }
  };

  const buildCouponPayload = ({ sellerCoupon = false } = {}) => ({
    code: couponForm.code,
    sellerId: sellerCoupon ? undefined : couponForm.sellerId,
    discountBps: Number(couponForm.discountBps || 0),
    commissionBps: sellerCoupon || couponForm.sellerId ? Number(couponForm.commissionBps || 0) : 0,
    status: couponForm.status,
    maxUses: couponForm.maxUses ? Number(couponForm.maxUses) : null,
    validUntil: couponForm.validUntil || null,
    duration: 'first_month',
    marginWarningAcknowledged: negativeMarginAcknowledged,
  });

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (formMode === 'create' && wizardStep === 1) {
      handleWizardNext();
      return;
    }

    const isCouponFormMode = formMode.startsWith('coupon');

    if ((formMode === 'create' || formMode === 'edit' || isCouponFormMode) && !validateCouponForm()) {
      return;
    }

    const payload = {
      name: sellerForm.name.trim(),
      contact: sellerForm.email.trim() || sellerForm.phone.trim(),
      phone: sellerForm.phone.trim(),
      email: sellerForm.email.trim(),
      pixKey: sellerForm.pixKey.trim(),
    };

    if (!isCouponFormMode) {
      if (!payload.name || !(payload.phone || payload.email) || !payload.pixKey) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha nome, telefone ou email, e chave Pix para salvar.',
        variant: 'destructive',
      });
      return;
    }

    }

    setSubmitting(true);
    try {
      if (formMode === 'edit' && activeSeller?.id) {
        const updatedSeller = await updateAffiliateSeller({
          sellerId: activeSeller.id,
          ...payload,
        });
        let updatedPromotionalCode = activePromotionalCode;

        if (activePromotionalCode?.id) {
          updatedPromotionalCode = await updatePromotionalCode({
            promotionalCodeId: activePromotionalCode.id,
            ...buildCouponPayload({ sellerCoupon: true }),
          });
        } else {
          updatedPromotionalCode = await createPromotionalCode({
            ...buildCouponPayload(),
            sellerId: activeSeller.id,
          });
        }

        setSellers((current) => current.map((seller) => (
          seller.id === updatedSeller.id
            ? { ...updatedSeller, promotionalCode: updatedPromotionalCode }
            : seller
        )));
        setCoupons((current) => {
          if (!updatedPromotionalCode) return current;
          const exists = current.some((coupon) => coupon.id === updatedPromotionalCode.id);
          if (exists) {
            return current.map((coupon) => (
              coupon.id === updatedPromotionalCode.id ? updatedPromotionalCode : coupon
            ));
          }
          return [updatedPromotionalCode, ...current].slice(0, COUPON_PAGE_SIZE);
        });
        toast({
          title: 'Vendedor e cupom atualizados',
          description: `${updatedSeller.name} foi salvo com sucesso.`,
        });
      } else if (formMode === 'coupon-edit' && activePromotionalCode?.id) {
        const updatedPromotionalCode = await updatePromotionalCode({
          promotionalCodeId: activePromotionalCode.id,
          ...buildCouponPayload(),
        });

        setCoupons((current) => current.map((coupon) => (
          coupon.id === updatedPromotionalCode.id ? updatedPromotionalCode : coupon
        )));
        if (updatedPromotionalCode.sellerId) {
          updateSellerPromotionalCode(updatedPromotionalCode.sellerId, updatedPromotionalCode);
        }
        toast({
          title: 'Cupom atualizado',
          description: `${updatedPromotionalCode.code} foi salvo com sucesso.`,
        });
      } else if (formMode === 'coupon-create') {
        const createdPromotionalCode = await createPromotionalCode(buildCouponPayload());

        setCouponPage(1);
        setCoupons((current) => [createdPromotionalCode, ...current].slice(0, COUPON_PAGE_SIZE));
        setCouponTotal((current) => current + 1);
        if (createdPromotionalCode.sellerId) {
          updateSellerPromotionalCode(createdPromotionalCode.sellerId, createdPromotionalCode);
        }
        toast({
          title: 'Cupom criado',
          description: `${createdPromotionalCode.code} ficou disponível para uso.`,
        });
      } else {
        const result = await createSellerWithCoupon({
          ...payload,
          coupon: buildCouponPayload({ sellerCoupon: true }),
          marginWarningAcknowledged: negativeMarginAcknowledged,
        });
        const createdSeller = result.seller;
        setPage(1);
        setSellers((current) => [createdSeller, ...current].slice(0, PAGE_SIZE));
        setTotal((current) => current + 1);
        setCoupons((current) => [result.promotionalCode, ...current].slice(0, COUPON_PAGE_SIZE));
        setCouponTotal((current) => current + 1);
        toast({
          title: 'Vendedor e cupom criados',
          description: `${createdSeller.name} recebeu o cupom ${result.promotionalCode?.code}.`,
        });
      }

      resetForm();
      fetchSellers(1, { quiet: true });
      fetchCoupons(1, { quiet: true });
    } catch (error) {
      toast({
        title: isCouponFormMode
          ? 'Erro ao salvar cupom'
          : formMode === 'edit'
            ? 'Erro ao editar vendedor'
            : 'Erro ao criar vendedor',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkCommissionPaid = async (commission) => {
    if (commission.status !== 'pending') return;

    setMarkingCommissionId(commission.id);
    try {
      const result = await markAffiliateCommissionPaid({
        commissionId: commission.id,
        note: paymentNote,
      });

      setCommissions((current) => current.map((item) => (
        item.id === result.commission.id ? result.commission : item
      )));
      toast({
        title: result.alreadyPaid ? 'Comissão já estava paga' : 'Comissão marcada como paga',
        description: result.alreadyPaid
          ? 'O registro original foi preservado.'
          : 'Pagamento manual registrado para controle administrativo.',
      });
      fetchSellers(page, { quiet: true });
      fetchClients();
    } catch (error) {
      toast({
        title: 'Erro ao marcar comissão',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setMarkingCommissionId(null);
    }
  };

  const handleMarkSellerCompetencePaid = async (seller) => {
    const pendingCount = Number(seller.summary?.pendingCommissionCount || 0);
    if (!pendingCount) {
      toast({
        title: 'Sem pendências',
        description: `${seller.name} não possui comissões pendentes nesta competência.`,
      });
      return;
    }

    setMarkingSellerId(seller.id);
    try {
      const result = await markAffiliateSellerCompetencePaid({
        sellerId: seller.id,
        competenceMonth: selectedCompetenceForApi,
        note: paymentNote,
      });

      toast({
        title: 'Competência marcada como paga',
        description: `${result.updatedCount} ${result.updatedCount === 1 ? 'comissão' : 'comissões'} atualizada${result.updatedCount === 1 ? '' : 's'}.`,
      });
      fetchSellers(page, { quiet: true });
      fetchCommissions();
      fetchClients();
    } catch (error) {
      toast({
        title: 'Erro ao marcar competência',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setMarkingSellerId(null);
    }
  };

  const renderSellerCoupon = (seller) => {
    const promotionalCode = seller.promotionalCode || sellerCouponsBySellerId.get(seller.id);

    if (!promotionalCode?.code) {
      return (
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-muted-foreground">Sem cupom</p>
          <p className="text-xs text-muted-foreground">Use o wizard para criar vendedor com cupom.</p>
        </div>
      );
    }

    const isCopying = copyingLinkSellerId === seller.id || copyingCouponId === promotionalCode.id;
    const isToggling = togglingCouponId === promotionalCode.id;
    const nextStatus = promotionalCode.status === 'inactive' ? 'active' : 'inactive';

    return (
      <div className="min-w-[16rem]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-foreground">{promotionalCode.code}</span>
          <StatusBadge status={promotionalCode.status} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Copiar cupom de ${seller.name}`}
            onClick={() => handleCopyCoupon({ ...seller, promotionalCode })}
            disabled={isCopying}
          >
            {isCopying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => handleToggleCouponStatus(promotionalCode)}
            disabled={isToggling}
          >
            {isToggling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {nextStatus === 'active' ? 'Ativar' : 'Inativar'}
          </Button>
        </div>
        <div className="hidden">
          <span>Comissão {formatRateBps(promotionalCode.commissionBps)}</span>
        </div>
        <span className="sr-only">Copiar cupom</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Afiliados</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cadastre vendedores, acompanhe clientes indicados e feche comissões mensais.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRefreshAll}
            disabled={loading || refreshing || commissionsLoading || clientsLoading}
            className="gap-2"
          >
            {refreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Atualizar
          </Button>
          <Button type="button" onClick={openCreateDialog} className="gap-2" disabled={submitting}>
            <UserPlus className="h-4 w-4" />
            Novo vendedor
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <SummaryTile
          icon={CreditCard}
          label="Mês atual"
          value={formatMonth(selectedCompetenceForApi)}
        />
        <SummaryTile
          icon={WalletCards}
          label="Pendente"
          value={formatCurrency(visibleSellerSummary.pendingCommissionCents)}
          helper={`${visibleSellerSummary.pendingCommissionCount} comissões nesta página`}
        />
        <SummaryTile
          icon={CheckCircle2}
          label="Pago"
          value={formatCurrency(visibleSellerSummary.paidCommissionCents)}
        />
        <SummaryTile
          icon={Users}
          label="Clientes indicados"
          value={visibleSellerSummary.attributedClientsCount}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          <Button
            type="button"
            variant={adminView === 'sellers' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setAdminView('sellers')}
          >
            Vendedores
          </Button>
          <Button
            type="button"
            variant={adminView === 'coupons' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setAdminView('coupons')}
          >
            Cupons
          </Button>
        </div>
        {adminView === 'coupons' && (
          <Button type="button" onClick={openCreateCouponDialog} className="gap-2" disabled={submitting}>
            <LinkIcon className="h-4 w-4" />
            Novo cupom
          </Button>
        )}
      </div>

      {adminView === 'sellers' && (
        <>
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20 sm:flex-row sm:items-end">
        <form onSubmit={handleSearchSubmit} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="affiliate-search">Buscar vendedor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="affiliate-search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Nome, telefone ou email"
                className="pl-9"
              />
            </div>
          </div>
          <Button type="submit" variant="outline" className="sm:w-auto">
            Buscar
          </Button>
        </form>

      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : sellers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-5 py-3">Vendedor</th>
                  <th className="whitespace-nowrap px-5 py-3">Telefone</th>
                  <th className="whitespace-nowrap px-5 py-3">Email</th>
                  <th className="whitespace-nowrap px-5 py-3">Cupom</th>
                  <th className="whitespace-nowrap px-5 py-3 text-center">Clientes</th>
                  <th className="whitespace-nowrap px-5 py-3 text-right">Pendente</th>
                  <th className="whitespace-nowrap px-5 py-3 text-right">Pago</th>
                  <th className="whitespace-nowrap px-5 py-3">Atualizado</th>
                  <th className="whitespace-nowrap px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => {
                  const summary = seller.summary || {};
                  const isMarkingSeller = markingSellerId === seller.id;

                  return (
                    <tr key={seller.id} className="border-t border-border bg-card align-middle">
                      <td className="min-w-44 px-5 py-4">
                        <div>
                          <p className="whitespace-nowrap font-semibold text-foreground">{seller.name}</p>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{seller.phone || '-'}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{seller.email || '-'}</td>
                      <td className="px-5 py-4">{renderSellerCoupon(seller)}</td>
                      <td className="px-5 py-4 text-center font-semibold text-foreground">
                        {summary.attributedClientsCount || 0}
                      </td>
                      <td className="min-w-32 px-5 py-4 text-right">
                        <p className="whitespace-nowrap font-semibold text-amber-700 dark:text-amber-300">
                          {formatCurrency(summary.pendingCommissionCents)}
                        </p>
                        <p className="whitespace-nowrap text-xs text-muted-foreground">
                          {summary.pendingCommissionCount || 0} pendente{summary.pendingCommissionCount === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="min-w-32 px-5 py-4 text-right">
                        <p className="whitespace-nowrap font-semibold text-emerald-700 dark:text-emerald-300">
                          {formatCurrency(summary.paidCommissionCents)}
                        </p>
                        <p className="whitespace-nowrap text-xs text-muted-foreground">
                          {summary.paidCommissionCount || 0} paga{summary.paidCommissionCount === 1 ? '' : 's'}
                        </p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">
                        {formatDate(seller.updatedAt || seller.createdAt)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Editar vendedor ${seller.name}`}
                            onClick={() => openEditDialog(seller)}
                          >
                            <Edit3 className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2 whitespace-nowrap"
                            disabled={!summary.pendingCommissionCount || isMarkingSeller}
                            onClick={() => handleMarkSellerCompetencePaid(seller)}
                          >
                            {isMarkingSeller ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <WalletCards className="h-4 w-4" />
                            )}
                            Marcar competência
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="font-semibold text-foreground">Nenhum vendedor cadastrado.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Crie o primeiro vendedor para iniciar a gestão de afiliados.
            </p>
          </div>
        )}
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {total} vendedor{total === 1 ? '' : 'es'} encontrado{total === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Anterior
          </Button>
          <span className="min-w-20 text-center">
            Página {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>
        </>
      )}

      {adminView === 'coupons' && (
        <>
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20 sm:flex-row sm:items-end">
            <form onSubmit={handleCouponSearchSubmit} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="coupon-search">Buscar código</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="coupon-search"
                    value={couponSearchDraft}
                    onChange={(event) => setCouponSearchDraft(normalizePromotionalCodeInput(event.target.value))}
                    placeholder="ex.: promo10"
                    className="pl-9"
                  />
                </div>
              </div>
              <Button type="submit" variant="outline" className="sm:w-auto">
                Buscar
              </Button>
            </form>

            <div className="space-y-2 sm:w-44">
              <Label htmlFor="coupon-status-filter">Status</Label>
              <Select value={couponStatusFilter || 'all'} onValueChange={handleCouponStatusFilterChange}>
                <SelectTrigger id="coupon-status-filter">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="active">Ativo</SelectItem>
                  <SelectItem value="inactive">Inativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:w-52">
              <Label htmlFor="coupon-type-filter">Tipo</Label>
              <Select value={couponTypeFilter || 'all'} onValueChange={handleCouponTypeFilterChange}>
                <SelectTrigger id="coupon-type-filter">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="campaign">Cupom de campanha</SelectItem>
                  <SelectItem value="seller">Cupom de vendedor</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:w-56">
              <Label htmlFor="coupon-seller-filter">Vendedor</Label>
              <Select value={couponSellerFilter || 'all'} onValueChange={handleCouponSellerFilterChange}>
                <SelectTrigger id="coupon-seller-filter">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  {sellers.map((seller) => (
                    <SelectItem key={seller.id} value={seller.id}>
                      {seller.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
          >
            {couponsLoading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : coupons.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-[1100px] w-full text-left text-sm">
                  <thead className="bg-muted text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="whitespace-nowrap px-5 py-3">Código</th>
                      <th className="whitespace-nowrap px-5 py-3">Tipo</th>
                      <th className="whitespace-nowrap px-5 py-3">Vendedor</th>
                      <th className="whitespace-nowrap px-5 py-3">Desconto</th>
                      <th className="whitespace-nowrap px-5 py-3">Comissão</th>
                      <th className="whitespace-nowrap px-5 py-3">Validade</th>
                      <th className="whitespace-nowrap px-5 py-3">Usos</th>
                      <th className="whitespace-nowrap px-5 py-3">Status</th>
                      <th className="whitespace-nowrap px-5 py-3 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coupons.map((promotionalCode) => {
                      const seller = sellers.find((item) => item.id === promotionalCode.sellerId);
                      const isCopying = copyingCouponId === promotionalCode.id;
                      const isToggling = togglingCouponId === promotionalCode.id;

                      return (
                        <tr key={promotionalCode.id} className="border-t border-border align-middle">
                          <td className="px-5 py-4">
                            <p className="font-mono font-semibold text-foreground">{promotionalCode.code}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {`/?promo=${promotionalCode.code}#planos`}
                            </p>
                          </td>
                          <td className="px-5 py-4 text-muted-foreground">{getCouponTypeLabel(promotionalCode)}</td>
                          <td className="px-5 py-4 text-muted-foreground">{seller?.name || '-'}</td>
                          <td className="px-5 py-4 font-semibold text-foreground">
                            {formatRateBps(promotionalCode.discountBps)}
                          </td>
                          <td className="px-5 py-4 text-muted-foreground">
                            {formatRateBps(promotionalCode.commissionBps)}
                          </td>
                          <td className="px-5 py-4 text-muted-foreground">
                            {formatDate(promotionalCode.validUntil)}
                          </td>
                          <td className="px-5 py-4 text-muted-foreground">{formatUses(promotionalCode)}</td>
                          <td className="px-5 py-4">
                            <StatusBadge status={promotionalCode.status} />
                          </td>
                          <td className="px-5 py-4">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Copiar cupom ${promotionalCode.code}`}
                                onClick={() => handleCopyCoupon(promotionalCode)}
                                disabled={isCopying}
                              >
                                {isCopying ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Copy className="h-4 w-4" />
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Editar cupom ${promotionalCode.code}`}
                                onClick={() => openEditCouponDialog(promotionalCode)}
                              >
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={isToggling}
                                onClick={() => handleToggleCouponStatus(promotionalCode)}
                              >
                                {isToggling && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                {promotionalCode.status === 'inactive' ? 'Ativar' : 'Inativar'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-10 text-center">
                <p className="font-semibold text-foreground">Nenhum cupom encontrado.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ajuste filtros ou crie um cupom de campanha.
                </p>
              </div>
            )}
          </motion.div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>
              {couponTotal} cupom{couponTotal === 1 ? '' : 's'} encontrado{couponTotal === 1 ? '' : 's'}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={couponPage <= 1 || couponsLoading}
                onClick={() => setCouponPage((current) => Math.max(1, current - 1))}
              >
                Anterior
              </Button>
              <span className="min-w-20 text-center">
                Página {couponPage} de {couponTotalPages}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={couponPage >= couponTotalPages || couponsLoading}
                onClick={() => setCouponPage((current) => current + 1)}
              >
                Próxima
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="affiliate-competence">Competência</Label>
            <Input
              id="affiliate-competence"
              type="month"
              value={selectedCompetence}
              onChange={(event) => handleCompetenceChange(event.target.value)}
              className="w-40"
            />
          </div>

          <div className="space-y-2 sm:w-56">
            <Label htmlFor="affiliate-seller-filter">Vendedor</Label>
            <Select value={selectedSellerId || 'all'} onValueChange={handleSelectedSellerChange}>
              <SelectTrigger id="affiliate-seller-filter">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os vendedores</SelectItem>
                {sellers.map((seller) => (
                  <SelectItem key={seller.id} value={seller.id}>
                    {seller.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:w-48">
            <Label htmlFor="affiliate-commission-status-filter">Status da comissão</Label>
            <Select value={commissionStatusFilter || 'all'} onValueChange={handleCommissionStatusChange}>
              <SelectTrigger id="affiliate-commission-status-filter">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
                <SelectItem value="paid">Pago</SelectItem>
                <SelectItem value="void">Anulado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="min-w-64 flex-1 space-y-2">
            <Label htmlFor="affiliate-payment-note">Observação do pagamento</Label>
            <Input
              id="affiliate-payment-note"
              value={paymentNote}
              onChange={(event) => setPaymentNote(event.target.value)}
              placeholder="Ex.: Pix realizado em lote"
            />
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <WalletCards className="h-5 w-5 text-primary" />
              Comissões
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Visão em tempo real dos registros persistidos para {formatMonth(selectedCompetenceForApi)}.
            </p>
          </div>
        </div>

        {commissionsLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : commissions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Vendedor / Cliente</th>
                  <th className="px-5 py-3">Competência</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Valor elegível</th>
                  <th className="px-5 py-3">Comissão</th>
                  <th className="px-5 py-3">Pagamento cliente</th>
                  <th className="px-5 py-3">Pagamento vendedor</th>
                  <th className="px-5 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {commissions.map((commission) => {
                  const sellerName = commission.seller?.name || 'Vendedor';
                  const projectName = commission.project?.name || commission.project?.slug || commission.projectId || 'Cliente';
                  const isMarking = markingCommissionId === commission.id;

                  return (
                    <tr key={commission.id} className="border-t border-border align-top">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{sellerName}</p>
                        <p className="text-sm text-muted-foreground">{projectName}</p>
                      </td>
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">
                        {formatMonth(commission.competenceMonth)}
                      </td>
                      <td className="px-5 py-4">
                        <CommissionStatusBadge status={commission.status} />
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">
                          {formatCurrency(commission.eligibleAmountCents, commission.currency)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">
                          {formatCurrency(commission.commissionCents, commission.currency)}
                        </p>
                        <p className="text-xs text-muted-foreground">{formatRateBps(commission.rateBps)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="text-muted-foreground">{formatDateTime(commission.paidAt)}</p>
                      </td>
                      <td className="px-5 py-4">
                        {commission.status === 'paid' ? (
                          <div>
                            <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                              {formatDateTime(commission.markedPaidAt || commission.payout?.paidAt)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {commission.paymentNote || commission.payout?.note || 'Pagamento manual registrado'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Aguardando fechamento</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="gap-2 whitespace-nowrap"
                          disabled={commission.status !== 'pending' || isMarking}
                          onClick={() => handleMarkCommissionPaid(commission)}
                        >
                          {isMarking ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4" />
                          )}
                          Marcar como paga
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="font-semibold text-foreground">Nenhuma comissão encontrada.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ajuste filtros ou aguarde pagamentos confirmados do Asaas para esta competência.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
          <span>
            {commissionTotal} {commissionTotal === 1 ? 'comissão' : 'comissões'} encontrada{commissionTotal === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={commissionPage <= 1 || commissionsLoading}
              onClick={() => setCommissionPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <span className="min-w-20 text-center">
              Página {commissionPage} de {commissionTotalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={commissionPage >= commissionTotalPages || commissionsLoading}
              onClick={() => setCommissionPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20">
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h3 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FileSearch className="h-5 w-5 text-primary" />
              Clientes indicados
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Dados resumidos para conferência e investigação de divergências.
            </p>
          </div>
        </div>

        {clientsLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : clients.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Vendedor</th>
                  <th className="px-5 py-3">Cliente / Projeto</th>
                  <th className="px-5 py-3">Assinatura</th>
                  <th className="px-5 py-3">Investigação</th>
                  <th className="px-5 py-3">Comissões</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => {
                  const projectName = client.project?.name || client.project?.slug || client.projectId || 'Cliente indicado';
                  const commissionsCount = client.commissions?.length || 0;
                  const generatedCommission = client.commissions?.[0];

                  return (
                    <tr key={client.id} className="border-t border-border align-top">
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{client.seller?.name || 'Vendedor'}</p>
                        <p className="font-mono text-xs text-muted-foreground">
                          {client.link?.code ? `ref=${client.link.code}` : client.sourceCode || '-'}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{projectName}</p>
                      </td>
                      <td className="px-5 py-4">
                        <SubscriptionStatusBadge status={client.subscription?.status} />
                      </td>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-foreground">{getClientInvestigationStatus(client)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Atribuído em {formatDate(client.attributedAt || client.createdAt)}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        {commissionsCount > 0 ? (
                          <div>
                            <p className="font-semibold text-foreground">
                              {commissionsCount} registro{commissionsCount === 1 ? '' : 's'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Última: {generatedCommission
                                ? `${getCommissionStatusLabel(generatedCommission.status)} - ${formatCurrency(generatedCommission.commissionCents, generatedCommission.currency)}`
                                : '-'}
                            </p>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">Sem pagamento confirmado</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="font-semibold text-foreground">Nenhum cliente indicado encontrado.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clientes aparecem aqui depois que uma atribuição de afiliado é criada.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground">
          <span>
            {clientTotal} cliente{clientTotal === 1 ? '' : 's'} indicado{clientTotal === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clientPage <= 1 || clientsLoading}
              onClick={() => setClientPage((current) => Math.max(1, current - 1))}
            >
              Anterior
            </Button>
            <span className="min-w-20 text-center">
              Página {clientPage} de {clientTotalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={clientPage >= clientTotalPages || clientsLoading}
              onClick={() => setClientPage((current) => current + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => !open && resetForm()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {formMode === 'edit'
                ? 'Editar vendedor'
                : formMode === 'coupon-edit'
                  ? 'Editar cupom'
                  : formMode === 'coupon-create'
                    ? 'Novo cupom'
                    : 'Novo vendedor'}
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            {!formMode.startsWith('coupon') && !(formMode === 'create' && wizardStep === 2) && (
              <>
            {formMode === 'create' && wizardStep === 1 && (
              <p className="text-sm font-medium text-foreground">Etapa 1: dados do vendedor</p>
            )}
            <div className="space-y-2">
              <Label htmlFor="affiliate-name">Nome</Label>
              <Input
                id="affiliate-name"
                value={sellerForm.name}
                onChange={(event) => handleSellerFormChange('name', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="affiliate-phone">Telefone</Label>
                <Input
                  id="affiliate-phone"
                  value={sellerForm.phone}
                  onChange={(event) => handleSellerFormChange('phone', event.target.value)}
                  disabled={submitting}
                  placeholder="+5511999999999"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="affiliate-email">Email</Label>
                <Input
                  id="affiliate-email"
                  type="email"
                  value={sellerForm.email}
                  onChange={(event) => handleSellerFormChange('email', event.target.value)}
                  disabled={submitting}
                  placeholder="vendedor@exemplo.com"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="affiliate-pix-key">Chave Pix</Label>
              <Input
                id="affiliate-pix-key"
                value={sellerForm.pixKey}
                onChange={(event) => handleSellerFormChange('pixKey', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

              </>
            )}

            {formMode === 'create' && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                Etapa {wizardStep} de 2
              </div>
            )}

            {(formMode.startsWith('coupon') || formMode === 'edit' || (formMode === 'create' && wizardStep === 2)) && (
              <div className="space-y-4">
                {formMode === 'create' && (
                  <p className="text-sm font-medium text-foreground">Etapa 2: configurar cupom</p>
                )}
                {formMode === 'edit' && (
                  <p className="text-sm font-medium text-foreground">Cupom do vendedor</p>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="coupon-code">Código</Label>
                    <Input
                      id="coupon-code"
                      value={couponForm.code}
                      onChange={(event) => handleCouponFormChange('code', event.target.value)}
                      disabled={submitting || formMode === 'coupon-edit'}
                      required
                    />
                  </div>

                  {formMode.startsWith('coupon') && (
                    <div className="space-y-2">
                      <Label htmlFor="coupon-seller">Vendedor</Label>
                      <Select
                        value={couponForm.sellerId || 'campaign'}
                        onValueChange={(value) => handleCouponFormChange('sellerId', value === 'campaign' ? '' : value)}
                        disabled={submitting || formMode === 'coupon-edit'}
                      >
                        <SelectTrigger id="coupon-seller">
                          <SelectValue placeholder="Campanha" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="campaign">Cupom de campanha</SelectItem>
                          {sellers.map((seller) => (
                            <SelectItem key={seller.id} value={seller.id}>
                              {seller.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="coupon-discount">Desconto</Label>
                    <Input
                      id="coupon-discount"
                      type="number"
                      min="0"
                      max="10000"
                      step="100"
                      value={couponForm.discountBps}
                      onChange={(event) => handleCouponFormChange('discountBps', event.target.value)}
                      disabled={submitting}
                    />
                    <p className="text-xs text-muted-foreground">{formatRateBps(couponForm.discountBps)}</p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="coupon-commission">Comissão</Label>
                    <Input
                      id="coupon-commission"
                      type="number"
                      min="0"
                      max="10000"
                      step="100"
                      value={couponForm.commissionBps}
                      onChange={(event) => handleCouponFormChange('commissionBps', event.target.value)}
                      disabled={submitting || (formMode.startsWith('coupon') && !couponForm.sellerId)}
                    />
                    <p className="text-xs text-muted-foreground">{formatRateBps(couponForm.commissionBps)}</p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="coupon-max-uses">Limite de usos</Label>
                    <Input
                      id="coupon-max-uses"
                      type="number"
                      min="1"
                      value={couponForm.maxUses}
                      onChange={(event) => handleCouponFormChange('maxUses', event.target.value)}
                      disabled={submitting}
                      placeholder="Sem limite"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="coupon-valid-until">Validade</Label>
                    <div className="relative">
                      {!couponForm.validUntil && (
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          Sem validade
                        </span>
                      )}
                      <Input
                        id="coupon-valid-until"
                        type="date"
                        value={couponForm.validUntil}
                        onChange={(event) => handleCouponFormChange('validUntil', event.target.value)}
                        disabled={submitting}
                        className={!couponForm.validUntil ? 'text-transparent' : undefined}
                      />
                    </div>
                  </div>
                </div>

                {couponHasNegativeMargin && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-400/40 dark:bg-amber-500/10 dark:text-amber-200">
                    <p className="font-semibold">Alerta de margem</p>
                    <p className="mt-1">Desconto e comissão somados passam de 100% do primeiro mês.</p>
                    <label className="mt-3 flex items-center gap-2">
                      <Checkbox
                        checked={negativeMarginAcknowledged}
                        onCheckedChange={(checked) => setNegativeMarginAcknowledged(Boolean(checked))}
                      />
                      <span>Confirmo que desejo continuar mesmo assim.</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}>
                Cancelar
              </Button>
              {formMode === 'create' && wizardStep === 2 && (
                <Button type="button" variant="outline" onClick={() => setWizardStep(1)} disabled={submitting}>
                  Voltar
                </Button>
              )}
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {formMode === 'create' && wizardStep === 1
                  ? 'Continuar'
                  : formMode === 'create'
                    ? 'Criar vendedor e cupom'
                    : 'Salvar'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AffiliatesTab;
