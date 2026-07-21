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
  buildAffiliateLinkUrl,
  createAffiliateSeller,
  getOrCreateAffiliateLink,
  listAffiliateCommissionClients,
  listAffiliateCommissions,
  listAffiliateSellers,
  markAffiliateCommissionPaid,
  markAffiliateSellerCompetencePaid,
  updateAffiliateSeller,
} from '@/lib/affiliates';

const PAGE_SIZE = 25;
const COMMISSION_PAGE_SIZE = 25;
const CLIENT_PAGE_SIZE = 20;
const EMPTY_FORM = {
  name: '',
  contact: '',
  pixKey: '',
  status: 'active',
};

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
  const [sellers, setSellers] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [generatingLinkSellerId, setGeneratingLinkSellerId] = useState(null);
  const [copyingLinkSellerId, setCopyingLinkSellerId] = useState(null);
  const [formMode, setFormMode] = useState('');
  const [activeSeller, setActiveSeller] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
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
        status: statusFilter,
        search,
        includeSummary: true,
        competenceMonth: selectedCompetenceForApi,
      });

      setSellers(result.sellers);
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
  }, [page, search, selectedCompetenceForApi, statusFilter, toast]);

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
    fetchCommissions();
  }, [fetchCommissions]);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setActiveSeller(null);
    setFormMode('');
  };

  const openCreateDialog = () => {
    setForm(EMPTY_FORM);
    setActiveSeller(null);
    setFormMode('create');
  };

  const openEditDialog = (seller) => {
    setForm({
      name: seller.name || '',
      contact: seller.contact || '',
      pixKey: seller.pixKey || '',
      status: seller.status === 'inactive' ? 'inactive' : 'active',
    });
    setActiveSeller(seller);
    setFormMode('edit');
  };

  const handleFormChange = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const handleStatusFilterChange = (value) => {
    setPage(1);
    setStatusFilter(value === 'all' ? '' : value);
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
    fetchCommissions();
    fetchClients();
  };

  const updateSellerLink = (sellerId, affiliateLink) => {
    setSellers((current) => current.map((seller) => (
      seller.id === sellerId ? { ...seller, affiliateLink } : seller
    )));
  };

  const handleGenerateLink = async (seller) => {
    if (seller.status === 'inactive') {
      toast({
        title: 'Vendedor inativo',
        description: 'Ative o vendedor antes de gerar um link de afiliado.',
        variant: 'destructive',
      });
      return;
    }

    setGeneratingLinkSellerId(seller.id);
    try {
      const affiliateLink = await getOrCreateAffiliateLink({ sellerId: seller.id });
      updateSellerLink(seller.id, affiliateLink);
      toast({
        title: 'Link gerado',
        description: `Link de ${seller.name} pronto para copiar.`,
      });
    } catch (error) {
      toast({
        title: 'Erro ao gerar link',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setGeneratingLinkSellerId(null);
    }
  };

  const handleCopyLink = async (seller) => {
    if (seller.status === 'inactive') {
      toast({
        title: 'Vendedor inativo',
        description: 'Links de vendedores inativos não devem ser usados para venda.',
        variant: 'destructive',
      });
      return;
    }

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

      const url = buildAffiliateLinkUrl(code);
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

  const handleSubmit = async (event) => {
    event.preventDefault();

    const payload = {
      name: form.name.trim(),
      contact: form.contact.trim(),
      pixKey: form.pixKey.trim(),
      status: form.status,
    };

    if (!payload.name || !payload.contact || !payload.pixKey) {
      toast({
        title: 'Campos obrigatórios',
        description: 'Preencha nome, contato e chave Pix para salvar.',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      if (formMode === 'edit' && activeSeller?.id) {
        const updatedSeller = await updateAffiliateSeller({
          sellerId: activeSeller.id,
          ...payload,
        });

        setSellers((current) => current.map((seller) => (
          seller.id === updatedSeller.id ? updatedSeller : seller
        )));
        toast({
          title: 'Vendedor atualizado',
          description: `${updatedSeller.name} foi salvo com sucesso.`,
        });
      } else {
        const createdSeller = await createAffiliateSeller(payload);
        setPage(1);
        setSellers((current) => [createdSeller, ...current].slice(0, PAGE_SIZE));
        setTotal((current) => current + 1);
        toast({
          title: 'Vendedor criado',
          description: `${createdSeller.name} foi cadastrado como afiliado.`,
        });
      }

      resetForm();
      fetchSellers(1, { quiet: true });
    } catch (error) {
      toast({
        title: formMode === 'edit' ? 'Erro ao editar vendedor' : 'Erro ao criar vendedor',
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

  const renderSellerLink = (seller) => {
    if (seller.status === 'inactive') {
      return <span className="text-muted-foreground">Vendedor inativo</span>;
    }

    const affiliateLink = seller.affiliateLink;
    if (!affiliateLink?.code) {
      const isGenerating = generatingLinkSellerId === seller.id;

      return (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => handleGenerateLink(seller)}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LinkIcon className="h-4 w-4" />
          )}
          Gerar link
        </Button>
      );
    }

    const isCopying = copyingLinkSellerId === seller.id;

    return (
      <div className="flex w-72 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {`/?ref=${affiliateLink.code}#planos`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Copiar link de ${seller.name}`}
          onClick={() => handleCopyLink(seller)}
          disabled={isCopying}
        >
          {isCopying ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
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
                placeholder="Nome ou contato"
                className="pl-9"
              />
            </div>
          </div>
          <Button type="submit" variant="outline" className="sm:w-auto">
            Buscar
          </Button>
        </form>

        <div className="space-y-2 sm:w-48">
          <Label htmlFor="affiliate-status-filter">Status</Label>
          <Select value={statusFilter || 'all'} onValueChange={handleStatusFilterChange}>
            <SelectTrigger id="affiliate-status-filter">
              <SelectValue placeholder="Todos" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="active">Ativo</SelectItem>
              <SelectItem value="inactive">Inativo</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
            <table className="min-w-[1160px] w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="whitespace-nowrap px-5 py-3">Vendedor</th>
                  <th className="whitespace-nowrap px-5 py-3">Contato</th>
                  <th className="whitespace-nowrap px-5 py-3">Status</th>
                  <th className="whitespace-nowrap px-5 py-3">Link</th>
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
                      <td className="whitespace-nowrap px-5 py-4 text-muted-foreground">{seller.contact}</td>
                      <td className="whitespace-nowrap px-5 py-4">
                        <StatusBadge status={seller.status} />
                      </td>
                      <td className="px-5 py-4">{renderSellerLink(seller)}</td>
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
            <DialogTitle>{formMode === 'edit' ? 'Editar vendedor' : 'Novo vendedor'}</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="affiliate-name">Nome</Label>
              <Input
                id="affiliate-name"
                value={form.name}
                onChange={(event) => handleFormChange('name', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="affiliate-contact">Contato</Label>
              <Input
                id="affiliate-contact"
                value={form.contact}
                onChange={(event) => handleFormChange('contact', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="affiliate-pix-key">Chave Pix</Label>
              <Input
                id="affiliate-pix-key"
                value={form.pixKey}
                onChange={(event) => handleFormChange('pixKey', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            {formMode === 'edit' && (
              <div className="space-y-2">
                <Label htmlFor="affiliate-status">Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(value) => handleFormChange('status', value)}
                  disabled={submitting}
                >
                  <SelectTrigger id="affiliate-status">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Ativo</SelectItem>
                    <SelectItem value="inactive">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={resetForm} disabled={submitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AffiliatesTab;
