import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Edit3, Loader2, RefreshCw, Search, UserPlus } from 'lucide-react';
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
  createAffiliateSeller,
  listAffiliateSellers,
  updateAffiliateSeller,
} from '@/lib/affiliates';

const PAGE_SIZE = 25;
const EMPTY_FORM = {
  name: '',
  contact: '',
  pixKey: '',
  status: 'active',
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function getStatusLabel(status) {
  return status === 'inactive' ? 'Inativo' : 'Ativo';
}

function StatusBadge({ status }) {
  const isInactive = status === 'inactive';

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
        isInactive
          ? 'border-gray-300 bg-gray-100 text-gray-700'
          : 'border-emerald-200 bg-emerald-50 text-emerald-700'
      }`}
    >
      {getStatusLabel(status)}
    </span>
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
  const [formMode, setFormMode] = useState('');
  const [activeSeller, setActiveSeller] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const isDialogOpen = Boolean(formMode);

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
  }, [page, search, statusFilter, toast]);

  useEffect(() => {
    fetchSellers(page);
  }, [fetchSellers, page]);

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
        title: 'Campos obrigatorios',
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Afiliados</h2>
          <p className="mt-1 text-sm text-gray-600">
            Cadastre vendedores, revise dados comerciais e controle quem esta ativo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fetchSellers(page, { quiet: true })}
            disabled={loading || refreshing}
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

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-4 sm:flex-row sm:items-end">
        <form onSubmit={handleSearchSubmit} className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-2">
            <Label htmlFor="affiliate-search">Buscar vendedor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
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
        className="overflow-hidden rounded-lg border border-gray-200 bg-white"
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : sellers.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-700">
                <tr>
                  <th className="px-5 py-3">Vendedor</th>
                  <th className="px-5 py-3">Contato</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Link</th>
                  <th className="px-5 py-3">Atualizado</th>
                  <th className="px-5 py-3 text-right">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {sellers.map((seller) => (
                  <tr key={seller.id} className="border-t bg-white">
                    <td className="px-5 py-4">
                      <div>
                        <p className="font-semibold text-gray-900">{seller.name}</p>
                        <p className="font-mono text-xs text-gray-500">{seller.id}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-gray-700">{seller.contact}</td>
                    <td className="px-5 py-4">
                      <StatusBadge status={seller.status} />
                    </td>
                    <td className="px-5 py-4 text-gray-500">Aguardando link</td>
                    <td className="whitespace-nowrap px-5 py-4 text-gray-700">
                      {formatDate(seller.updatedAt || seller.createdAt)}
                    </td>
                    <td className="px-5 py-4 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar vendedor ${seller.name}`}
                        onClick={() => openEditDialog(seller)}
                      >
                        <Edit3 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center">
            <p className="font-semibold text-gray-900">Nenhum vendedor cadastrado.</p>
            <p className="mt-1 text-sm text-gray-600">
              Crie o primeiro vendedor para iniciar a gestao de afiliados.
            </p>
          </div>
        )}
      </motion.div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-600">
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
            Pagina {page} de {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Proxima
          </Button>
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
