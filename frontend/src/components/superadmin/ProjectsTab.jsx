import React, { useState, useEffect, useCallback, useDeferredValue, useMemo, useRef } from 'react';
import { Plus, Edit, Trash2, Eye, ArrowRight, Search, X, ChevronLeft, ChevronRight, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { listProjects, createProject, updateProject, deleteProject, uploadProjectLogo } from '@/lib/api';
import { getSuperadminFinancialOverview } from '@/lib/superadminFinance';
import { fetchSubscriptionPlans } from '@/lib/subscriptionPlans';
import { cn } from '@/lib/utils';

const MIN_PROJECT_SKELETON_CARDS = 6;
const PROJECT_PAGE_SIZE_OPTIONS = [15, 30, 50, 100];

const INITIAL_PROJECT_FILTERS = {
    search: '',
    subscription: 'all',
    sort: 'created_desc',
};

const SUBSCRIPTION_STATUS_LABELS = {
    active: 'Ativa',
    expired: 'Trial expirado',
    past_due: 'Pagamento pendente',
    paused: 'Pausada',
    suspended: 'Suspensa',
    trialing: 'Período gratuito',
    sem_assinatura: 'Sem assinatura',
    unavailable: 'Assinatura indisponível',
};

const SUBSCRIPTION_STATUS_STYLES = {
    active: 'border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500',
    trialing: 'border-sky-600 bg-sky-600 text-white dark:border-sky-500 dark:bg-sky-500',
    past_due: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500',
    paused: 'border-amber-600 bg-amber-600 text-white dark:border-amber-500 dark:bg-amber-500',
    suspended: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500',
    expired: 'border-rose-600 bg-rose-600 text-white dark:border-rose-500 dark:bg-rose-500',
    sem_assinatura: 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500',
    unavailable: 'border-muted bg-muted text-muted-foreground',
};

const SUBSCRIPTION_TYPE_STYLES = {
    free_trial: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/70 dark:bg-sky-950/45 dark:text-sky-300',
    starter: 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900/70 dark:bg-indigo-950/45 dark:text-indigo-300',
    pro: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/45 dark:text-emerald-300',
    premium: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-900/70 dark:bg-fuchsia-950/45 dark:text-fuchsia-300',
    sem_assinatura: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/55 dark:text-slate-300',
    unavailable: 'border-muted bg-muted text-muted-foreground',
};

const SUBSCRIPTION_STATUS_PRIORITY = {
    sem_assinatura: 7,
    suspended: 6,
    past_due: 5,
    expired: 4,
    paused: 3,
    trialing: 2,
    active: 1,
    unavailable: 0,
};

const PROJECT_SORT_OPTIONS = [
    { value: 'created_desc', label: 'Mais recentes' },
    { value: 'created_asc', label: 'Mais antigos' },
    { value: 'name_asc', label: 'Nome A-Z' },
    { value: 'name_desc', label: 'Nome Z-A' },
    { value: 'subscription_asc', label: 'Assinatura A-Z' },
    { value: 'status_priority', label: 'Status crítico primeiro' },
];

const integerFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function normalizeFilterValue(value) {
    return String(value || '').trim().toLowerCase();
}

function formatInteger(value) {
    const numericValue = Number(value || 0);
    return integerFormatter.format(Number.isFinite(numericValue) ? numericValue : 0);
}

function StableSelect({
    value,
    onValueChange,
    children,
    ariaLabel,
    disabled = false,
    className,
}) {
    const optionItems = React.Children.toArray(children).filter(React.isValidElement);

    return (
        <Select value={String(value)} onValueChange={onValueChange} disabled={disabled}>
            <SelectTrigger aria-label={ariaLabel} className={cn('min-w-0 max-w-full', className)}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {optionItems.map((option) => (
                    <SelectItem
                        key={option.key || option.props.value}
                        value={String(option.props.value)}
                        disabled={option.props.disabled}
                    >
                        {option.props.children}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function mergeProjectFinancialData(projects, financialProjects) {
    const financialByProjectId = new Map(
        (financialProjects || [])
            .filter((project) => project?.projectId)
            .map((project) => [project.projectId, project])
    );

    return (projects || []).map((project) => {
        const financialProject = financialByProjectId.get(project.id);

        if (!financialProject) {
            return {
                ...project,
                subscriptionId: null,
                subscriptionPlanCode: null,
                subscriptionPlanName: null,
                subscriptionStatus: null,
            };
        }

        return {
            ...project,
            subscriptionId: financialProject.subscriptionId || null,
            subscriptionPlanCode: financialProject.planCode || null,
            subscriptionPlanName: financialProject.planName || null,
            subscriptionStatus: financialProject.subscriptionStatus || null,
            subscriptionRiskLevel: financialProject.riskLevel || null,
            trialEndsAt: financialProject.trialEndsAt || null,
        };
    });
}

function getSubscriptionStatus(project, subscriptionInfoAvailable) {
    if (!subscriptionInfoAvailable) return 'unavailable';
    if (!project?.subscriptionId) return 'sem_assinatura';
    return normalizeFilterValue(project.subscriptionStatus || 'sem_assinatura');
}

function getSubscriptionStatusLabel(project, subscriptionInfoAvailable) {
    const status = getSubscriptionStatus(project, subscriptionInfoAvailable);
    return SUBSCRIPTION_STATUS_LABELS[status] || project?.subscriptionStatus || 'Sem assinatura';
}

function getSubscriptionType(project, subscriptionInfoAvailable) {
    if (!subscriptionInfoAvailable) {
        return {
            key: 'unavailable',
            label: 'Assinatura indisponível',
        };
    }

    const planCode = normalizeFilterValue(project?.subscriptionPlanCode);
    if (planCode) {
        return {
            key: planCode,
            label: project.subscriptionPlanName || project.subscriptionPlanCode,
        };
    }

    if (project?.subscriptionId) {
        return {
            key: getSubscriptionStatus(project, subscriptionInfoAvailable),
            label: 'Assinatura',
        };
    }

    return {
        key: 'sem_assinatura',
        label: 'Sem assinatura',
    };
}

function getProjectTimestamp(project) {
    const timestamp = new Date(project?.created_at || project?.createdAt || 0).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareProjectsByName(left, right, direction = 'asc') {
    const multiplier = direction === 'asc' ? 1 : -1;
    return String(left?.name || '').localeCompare(String(right?.name || ''), 'pt-BR') * multiplier;
}

function sortProjects(projects, sort, subscriptionInfoAvailable) {
    return [...projects].sort((left, right) => {
        if (sort === 'created_asc') {
            return getProjectTimestamp(left) - getProjectTimestamp(right) || compareProjectsByName(left, right);
        }

        if (sort === 'name_asc') return compareProjectsByName(left, right);
        if (sort === 'name_desc') return compareProjectsByName(left, right, 'desc');

        if (sort === 'subscription_asc') {
            const leftType = getSubscriptionType(left, subscriptionInfoAvailable).label;
            const rightType = getSubscriptionType(right, subscriptionInfoAvailable).label;
            return leftType.localeCompare(rightType, 'pt-BR') || compareProjectsByName(left, right);
        }

        if (sort === 'status_priority') {
            const leftStatus = getSubscriptionStatus(left, subscriptionInfoAvailable);
            const rightStatus = getSubscriptionStatus(right, subscriptionInfoAvailable);
            return (SUBSCRIPTION_STATUS_PRIORITY[rightStatus] || 0) - (SUBSCRIPTION_STATUS_PRIORITY[leftStatus] || 0)
                || compareProjectsByName(left, right);
        }

        return getProjectTimestamp(right) - getProjectTimestamp(left) || compareProjectsByName(left, right);
    });
}

function SubscriptionTypeBadge({ project, subscriptionInfoAvailable }) {
    const subscriptionType = getSubscriptionType(project, subscriptionInfoAvailable);
    const className = SUBSCRIPTION_TYPE_STYLES[subscriptionType.key]
        || 'border-border bg-muted text-muted-foreground';

    return (
        <span className={cn('inline-flex max-w-full items-center rounded border px-2.5 py-1 text-xs font-semibold', className)}>
            <span className="truncate">{subscriptionType.label}</span>
        </span>
    );
}

function SubscriptionStatusBadge({ project, subscriptionInfoAvailable }) {
    const status = getSubscriptionStatus(project, subscriptionInfoAvailable);
    const className = SUBSCRIPTION_STATUS_STYLES[status]
        || 'border-slate-600 bg-slate-600 text-white dark:border-slate-500 dark:bg-slate-500';

    return (
        <span className={cn('inline-flex max-w-full items-center rounded border px-2.5 py-1 text-xs font-semibold', className)}>
            <span className="truncate">{getSubscriptionStatusLabel(project, subscriptionInfoAvailable)}</span>
        </span>
    );
}

function SubscriptionBadges({ project, subscriptionInfoAvailable }) {
    const status = getSubscriptionStatus(project, subscriptionInfoAvailable);

    if (status === 'sem_assinatura' || status === 'unavailable') {
        return <SubscriptionTypeBadge project={project} subscriptionInfoAvailable={subscriptionInfoAvailable} />;
    }

    return (
        <>
            <SubscriptionTypeBadge project={project} subscriptionInfoAvailable={subscriptionInfoAvailable} />
            <SubscriptionStatusBadge project={project} subscriptionInfoAvailable={subscriptionInfoAvailable} />
        </>
    );
}

function SkeletonBlock({ className }) {
    return <div className={`animate-pulse rounded bg-muted ${className}`} />;
}

function ProjectCardSkeleton() {
    return (
        <div
            className="min-h-[17rem] overflow-hidden rounded-2xl border border-border bg-card p-6 pb-16 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
            aria-hidden="true"
        >
            <div className="flex justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <SkeletonBlock className="mb-4 h-12 w-12" />
                    <SkeletonBlock className="mb-3 h-5 w-2/3" />
                    <div className="space-y-2">
                        <SkeletonBlock className="h-3 w-full" />
                        <SkeletonBlock className="h-3 w-4/5" />
                        <SkeletonBlock className="h-3 w-3/5" />
                    </div>
                </div>
                <div className="flex flex-col items-end gap-3">
                    <SkeletonBlock className="h-9 w-9" />
                    <SkeletonBlock className="h-9 w-9" />
                </div>
            </div>
        </div>
    );
}

function ProjectCardsSkeleton({ count }) {
    const skeletonCount = Math.max(count, MIN_PROJECT_SKELETON_CARDS);

    return (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3" aria-live="polite" aria-busy="true">
            {Array.from({ length: skeletonCount }).map((_, index) => (
                <ProjectCardSkeleton key={index} />
            ))}
        </div>
    );
}

const ProjectCard = ({ project, onSelect, onEdit, onDelete, canManage, canDelete, subscriptionInfoAvailable }) => {
    const projectName = project.name || '(Sem nome)';
    const handleSelect = () => {
        if (canManage) onSelect(project);
    };
    const handleEdit = (event) => {
        event.stopPropagation();
        onEdit(project);
    };
    const handleDelete = (event) => {
        event.stopPropagation();
        onDelete(project);
    };

    return (
        <div
            className={cn(
                'group relative min-h-[17rem] overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 transition-[border-color,box-shadow] duration-200 ease-out hover:border-primary/60 hover:shadow-xl hover:shadow-slate-950/10 focus-within:border-primary/60 focus-within:shadow-xl focus-within:shadow-slate-950/10 dark:shadow-black/20 dark:hover:shadow-black/30 dark:focus-within:shadow-black/30',
                canManage && 'cursor-pointer'
            )}
        >
            {canManage && (
                <button
                    type="button"
                    className="absolute inset-0 z-0 rounded-2xl outline-none focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    onClick={handleSelect}
                    aria-label={`Ver detalhes de ${projectName}`}
                />
            )}
            <div className="relative z-10 p-6 pb-16 pointer-events-none">
                <div className="flex justify-between items-start">
                    <div className="min-w-0 flex-1">
                        {project.logo_url ? <img src={project.logo_url} alt={project.name} className="h-12 w-auto mb-4 rounded-md object-contain" /> : <div className="h-12 w-12 bg-muted rounded-md mb-4 flex items-center justify-center text-muted-foreground">Logo</div>}
                        <h3 className="text-lg font-bold mb-2">{projectName}</h3>
                        <div className="mb-3 flex flex-wrap gap-2">
                            <SubscriptionBadges project={project} subscriptionInfoAvailable={subscriptionInfoAvailable} />
                        </div>
                        <p className="text-sm text-muted-foreground h-10 overflow-hidden">{project.description || 'Sem descrição.'}</p>
                        {!canManage && (
                            <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                <Eye className="h-3.5 w-3.5" />
                                Somente visualização
                            </div>
                        )}
                    </div>
                    <div className="relative z-20 flex flex-col items-end gap-2 pointer-events-auto">
                        {canManage && (
                            <Button variant="ghost" size="icon" onClick={handleEdit} aria-label="Editar projeto">
                                <Edit className="h-4 w-4 text-blue-500" />
                            </Button>
                        )}
                        {canDelete && (
                            <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Excluir projeto">
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            {canManage && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-11 overflow-hidden" aria-hidden="true">
                    <div className="absolute inset-x-0 bottom-0 flex h-11 translate-y-[calc(100%+1px)] items-center justify-end bg-primary px-4 text-primary-foreground shadow-lg transition-transform duration-200 ease-out group-hover:translate-y-0 group-focus-within:translate-y-0">
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold">
                            Detalhes
                            <ArrowRight className="h-3.5 w-3.5" />
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
};

function ProjectsToolbar({
    filters,
    subscriptionOptions,
    subscriptionInfoAvailable,
    visibleCount,
    totalCount,
    onChange,
    onReset,
}) {
    const hasActiveFilters = filters.search !== ''
        || filters.subscription !== INITIAL_PROJECT_FILTERS.subscription
        || filters.sort !== INITIAL_PROJECT_FILTERS.sort;

    return (
        <div className="rounded-md border border-border bg-card px-4 py-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
                Filtros e ordenação
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(18rem,1fr)_14rem_14rem_5.5rem] lg:items-end">
                <div className="space-y-1.5">
                    <Label htmlFor="projects-search" className="text-xs font-semibold text-muted-foreground">Buscar</Label>
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            id="projects-search"
                            value={filters.search}
                            onChange={(event) => onChange('search', event.target.value)}
                            placeholder="Nome, descrição ou assinatura"
                            className="h-11 bg-background pl-9"
                            aria-label="Buscar projetos"
                        />
                    </div>
                </div>

                <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-muted-foreground">Filtrar por assinatura</Label>
                    <StableSelect
                        value={filters.subscription}
                        onValueChange={(value) => onChange('subscription', value)}
                        disabled={!subscriptionInfoAvailable}
                        ariaLabel="Filtrar por tipo de assinatura"
                        className="h-11"
                    >
                        <option value="all">Todas assinaturas</option>
                        {subscriptionOptions.map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                        ))}
                    </StableSelect>
                </div>

                <div className="space-y-1.5">
                    <Label className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                        <ArrowUpDown className="h-3.5 w-3.5" />
                        Ordenar por
                    </Label>
                    <StableSelect
                        value={filters.sort}
                        onValueChange={(value) => onChange('sort', value)}
                        ariaLabel="Ordenar projetos"
                        className="h-11"
                    >
                        {PROJECT_SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </StableSelect>
                </div>

                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-11 w-full justify-center gap-1.5 px-3 text-muted-foreground"
                    onClick={onReset}
                    disabled={!hasActiveFilters}
                >
                    <X className="h-4 w-4" />
                    Limpar
                </Button>
            </div>
            <div className="mt-3 flex flex-col gap-1 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
                <span>{formatInteger(visibleCount)} de {formatInteger(totalCount)} projetos encontrados</span>
                {!subscriptionInfoAvailable ? <span>Tags financeiras indisponíveis para o usuário atual.</span> : null}
            </div>
        </div>
    );
}

function ProjectsPagination({
    page,
    pageSize,
    pageCount,
    totalItems,
    onPageChange,
    onPageSizeChange,
}) {
    const firstItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
    const lastItem = Math.min(totalItems, page * pageSize);

    return (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
                Mostrando {formatInteger(firstItem)}-{formatInteger(lastItem)} de {formatInteger(totalItems)}
            </p>

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Por página</span>
                    <StableSelect
                        value={String(pageSize)}
                        onValueChange={(value) => onPageSizeChange(Number(value))}
                        ariaLabel="Projetos por página"
                        className="h-9 w-[5.25rem]"
                    >
                        {PROJECT_PAGE_SIZE_OPTIONS.map((option) => (
                            <option key={option} value={String(option)}>{option}</option>
                        ))}
                    </StableSelect>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() => onPageChange(page - 1)}
                        disabled={page <= 1}
                    >
                        <ChevronLeft className="h-4 w-4" />
                        Anterior
                    </Button>
                    <span className="min-w-[5rem] text-center text-xs font-medium text-muted-foreground">
                        {formatInteger(page)} / {formatInteger(pageCount)}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 gap-1.5"
                        onClick={() => onPageChange(page + 1)}
                        disabled={page >= pageCount}
                    >
                        Próxima
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    );
}

function EmptyProjectsState({ hasProjects }) {
    return (
        <div className="rounded-md border border-dashed border-border bg-card px-6 py-10 text-center">
            <h3 className="text-base font-semibold text-foreground">
                {hasProjects ? 'Nenhum projeto encontrado' : 'Nenhum projeto cadastrado'}
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
                {hasProjects ? 'Ajuste a busca, o filtro de assinatura ou a ordenação atual.' : 'Crie o primeiro projeto para começar.'}
            </p>
        </div>
    );
}

const ProjectFormModal = ({ project, isOpen, onClose, onSave }) => {
    const [formData, setFormData] = useState({ name: '', description: '' });
    const [logoFile, setLogoFile] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const { toast } = useToast();

    useEffect(() => {
        if (project) {
            setFormData({
                name: project.name || '',
                description: project.description || ''
            });
        } else {
            setFormData({ name: '', description: '' });
        }
        setLogoFile(null);
    }, [project, isOpen]);

    const handleFileChange = (e) => {
        if (e.target.files.length > 0) {
            setLogoFile(e.target.files[0]);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            let logo_url = project?.logo_url;

            if (logoFile) {
                const { publicUrl } = await uploadProjectLogo(logoFile);
                logo_url = publicUrl;
            }

            const payload = {
                name: formData.name,
                description: formData.description,
                logo_url,
            };

            await onSave(payload);
            onClose();
        } catch (error) {
            toast({
                title: "Erro ao salvar projeto",
                description: error.message,
                variant: "destructive"
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{project ? 'Editar Projeto' : 'Novo Projeto'}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div><Label htmlFor="name">Nome</Label><Input id="name" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} disabled={isSubmitting} /></div>
                    <div><Label htmlFor="description">Descrição</Label><Input id="description" value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} disabled={isSubmitting} /></div>
                    <div><Label htmlFor="logo">Logo</Label><Input id="logo" type="file" onChange={handleFileChange} accept="image/png, image/jpeg" disabled={isSubmitting} /></div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Salvando...' : 'Salvar'}</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const ProjectsTab = ({ onSelectProject, canManageProject = () => true, canDeleteProjects = true }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [subscriptionInfoAvailable, setSubscriptionInfoAvailable] = useState(false);
    const [billingPlanOptions, setBillingPlanOptions] = useState([]);
    const [filters, setFilters] = useState(INITIAL_PROJECT_FILTERS);
    const [pageSize, setPageSize] = useState(PROJECT_PAGE_SIZE_OPTIONS[0]);
    const [page, setPage] = useState(1);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAlertOpen, setIsAlertOpen] = useState(false);
    const [currentProject, setCurrentProject] = useState(null);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const { toast } = useToast();
    const deferredSearch = useDeferredValue(filters.search);
    const projectsStartRef = useRef(null);

    const fetchProjects = useCallback(async () => {
        setLoading(true);
        try {
            const [projectsResult, financialResult, billingPlansResult] = await Promise.allSettled([
                listProjects(),
                getSuperadminFinancialOverview(),
                fetchSubscriptionPlans(),
            ]);

            if (projectsResult.status === 'rejected') throw projectsResult.reason;

            const financialOverview = financialResult.status === 'fulfilled' ? financialResult.value : null;
            const financialProjects = financialOverview?.projects || [];
            const billingPlans = billingPlansResult.status === 'fulfilled' ? billingPlansResult.value : [];

            setSubscriptionInfoAvailable(financialResult.status === 'fulfilled');
            setBillingPlanOptions(Array.isArray(billingPlans) ? billingPlans : []);
            setProjects(mergeProjectFinancialData(projectsResult.value || [], financialProjects));

            if (financialResult.status === 'rejected') {
                console.warn('[ProjectsTab] Não foi possível carregar tags financeiras dos projetos.', financialResult.reason);
            }
        } catch (error) {
            toast({ title: "Erro ao carregar projetos", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchProjects(); }, [fetchProjects]);

    const subscriptionOptions = useMemo(() => {
        if (!subscriptionInfoAvailable) return [];

        const options = new Map();
        billingPlanOptions.forEach((plan) => {
            if (plan?.code && plan?.name) {
                options.set(plan.code, plan.name);
            }
        });

        projects.forEach((project) => {
            const subscriptionType = getSubscriptionType(project, subscriptionInfoAvailable);
            if (subscriptionType.key && subscriptionType.key !== 'unavailable') {
                options.set(subscriptionType.key, subscriptionType.label);
            }
        });

        return [...options.entries()];
    }, [billingPlanOptions, projects, subscriptionInfoAvailable]);

    const visibleProjects = useMemo(() => {
        const query = normalizeFilterValue(deferredSearch);

        const filteredProjects = projects.filter((project) => {
            const subscriptionType = getSubscriptionType(project, subscriptionInfoAvailable);
            const searchable = [
                project.name,
                project.description,
                project.id,
                subscriptionType.label,
                project.subscriptionPlanCode,
                project.subscriptionStatus,
                getSubscriptionStatusLabel(project, subscriptionInfoAvailable),
            ].map(normalizeFilterValue).join(' ');

            if (query && !searchable.includes(query)) return false;
            if (filters.subscription !== 'all' && subscriptionType.key !== filters.subscription) return false;
            return true;
        });

        return sortProjects(filteredProjects, filters.sort, subscriptionInfoAvailable);
    }, [
        deferredSearch,
        filters.sort,
        filters.subscription,
        projects,
        subscriptionInfoAvailable,
    ]);

    const pageCount = Math.max(1, Math.ceil(visibleProjects.length / pageSize));
    const currentPage = Math.min(Math.max(page, 1), pageCount);

    const paginatedProjects = useMemo(() => {
        const start = (currentPage - 1) * pageSize;
        return visibleProjects.slice(start, start + pageSize);
    }, [currentPage, pageSize, visibleProjects]);

    useEffect(() => {
        setPage((current) => Math.min(Math.max(current, 1), pageCount));
    }, [pageCount]);

    const handleFilterChange = useCallback((key, value) => {
        setPage(1);
        setFilters((current) => ({ ...current, [key]: value }));
    }, []);

    const handleResetFilters = useCallback(() => {
        setPage(1);
        setFilters(INITIAL_PROJECT_FILTERS);
    }, []);

    const handlePageSizeChange = useCallback((value) => {
        if (!PROJECT_PAGE_SIZE_OPTIONS.includes(value)) return;
        setPageSize(value);
        setPage(1);
    }, []);

    const scrollToProjectsStart = useCallback(() => {
        window.requestAnimationFrame(() => {
            projectsStartRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
    }, []);

    const handlePageChange = useCallback((value) => {
        setPage(Math.min(Math.max(value, 1), pageCount));
        scrollToProjectsStart();
    }, [pageCount, scrollToProjectsStart]);

    const handleSave = async (payload) => {
        if (currentProject) {
            if (!canManageProject(currentProject)) {
                toast({ title: "Sem permissão", description: "Você só pode editar projetos criados por você.", variant: "destructive" });
                return;
            }
            await updateProject(currentProject.id, payload);
            toast({ title: "Projeto atualizado!" });
        } else {
            await createProject(payload);
            toast({ title: "Projeto criado com sucesso!" });
        }
        await fetchProjects();
    };

    const handleDelete = async () => {
        if (!projectToDelete) return;
        if (!canDeleteProjects) {
            toast({ title: "Sem permissão", description: "Admins não podem excluir projetos.", variant: "destructive" });
            setProjectToDelete(null);
            setIsAlertOpen(false);
            return;
        }
        try {
            await deleteProject(projectToDelete.id);
            toast({ title: "Projeto excluído!" });
            setProjectToDelete(null);
            setIsAlertOpen(false);
            await fetchProjects();
        } catch (error) {
            toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
        }
    };

    return (
        <div ref={projectsStartRef} className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Projetos</h2>
                <Button onClick={() => { setCurrentProject(null); setIsModalOpen(true); }} className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600">
                    <Plus className="w-4 h-4" /> Novo Projeto
                </Button>
            </div>

            {!loading && (
                <ProjectsToolbar
                    filters={filters}
                    subscriptionOptions={subscriptionOptions}
                    subscriptionInfoAvailable={subscriptionInfoAvailable}
                    visibleCount={visibleProjects.length}
                    totalCount={projects.length}
                    onChange={handleFilterChange}
                    onReset={handleResetFilters}
                />
            )}

            {loading ? (
                <ProjectCardsSkeleton count={projects.length || 3} />
            ) : visibleProjects.length === 0 ? (
                <EmptyProjectsState hasProjects={projects.length > 0} />
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {paginatedProjects.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            onSelect={onSelectProject}
                            onEdit={(p) => { setCurrentProject(p); setIsModalOpen(true); }}
                            onDelete={(p) => { setProjectToDelete(p); setIsAlertOpen(true); }}
                            canManage={canManageProject(project)}
                            canDelete={canDeleteProjects}
                            subscriptionInfoAvailable={subscriptionInfoAvailable}
                        />
                    ))}
                </div>
            )}

            {!loading && visibleProjects.length > 0 && (
                <ProjectsPagination
                    page={currentPage}
                    pageSize={pageSize}
                    pageCount={pageCount}
                    totalItems={visibleProjects.length}
                    onPageChange={handlePageChange}
                    onPageSizeChange={handlePageSizeChange}
                />
            )}

            <ProjectFormModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} project={currentProject} onSave={handleSave} />

            <AlertDialog open={isAlertOpen} onOpenChange={setIsAlertOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Confirmar Exclusão</AlertDialogTitle></AlertDialogHeader>
                    <AlertDialogDescription>Tem certeza que deseja excluir o projeto "{projectToDelete?.name}"? Esta ação é irreversível.</AlertDialogDescription>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Excluir</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ProjectsTab;
