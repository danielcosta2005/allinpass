import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Edit, Loader2, RefreshCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import {
  adminCreateAdmin,
  adminListAdmins,
  adminRemoveAdmin,
  adminResendInvitation,
  adminUpdateAdmin,
} from '@/lib/admin';

const adminRoleLabels = {
  admin: 'Admin',
  superadmin: 'Superadmin',
};

const statusLabels = {
  active: 'Ativo',
  invited: 'Convidado',
  expired: 'Expirado',
};

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function getLinkedProjects(projects) {
  return Array.isArray(projects) ? projects : [];
}

function getAdminKey(admin) {
  return admin.invitation_id || admin.id || admin.email;
}

function StatusPill({ status }) {
  const styleByStatus = {
    active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    invited: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    expired: 'border-amber-200 bg-amber-50 text-amber-800',
  };

  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${styleByStatus[status] || 'border-slate-200 bg-slate-50 text-slate-700'}`}>
      {statusLabels[status] || status || '-'}
    </span>
  );
}

function ProjectNames({ projects }) {
  const linkedProjects = getLinkedProjects(projects);

  if (linkedProjects.length === 0) {
    return <span className="text-sm text-muted-foreground">Nenhum projeto vinculado</span>;
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-4 py-2.5">Projeto</th>
            <th className="px-4 py-2.5">Criado em</th>
          </tr>
        </thead>
        <tbody>
          {linkedProjects.map((project) => (
            <tr key={project.id} className="border-b last:border-b-0">
              <td className="px-4 py-2.5 font-semibold text-foreground">
                {project.name || 'Projeto sem nome'}
              </td>
              <td className="whitespace-nowrap px-4 py-2.5 text-muted-foreground">
                {formatDate(project.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const AdminTab = () => {
  const { role } = useAuth();
  const { toast } = useToast();
  const canManageAdmins = role === 'superadmin';
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [adminToEdit, setAdminToEdit] = useState(null);
  const [adminToRemove, setAdminToRemove] = useState(null);
  const [expandedAdminId, setExpandedAdminId] = useState(null);
  const [createForm, setCreateForm] = useState({ email: '', role: 'admin' });
  const [editForm, setEditForm] = useState({ role: 'admin' });

  const fetchAdmins = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await adminListAdmins();
      setAdmins(rows);
    } catch (error) {
      toast({
        title: 'Erro ao carregar admins',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAdmins();
  }, [fetchAdmins]);

  const handleCreateChange = (event) => {
    const { id, value } = event.target;
    setCreateForm((prev) => ({ ...prev, [id]: value }));
  };

  const handleEditChange = (event) => {
    const { id, value } = event.target;
    setEditForm((prev) => ({ ...prev, [id]: value }));
  };

  const handleCreateAdmin = async (event) => {
    event.preventDefault();
    if (!canManageAdmins) return;

    const email = createForm.email.trim().toLowerCase();
    if (!email) {
      toast({ title: 'Email obrigatorio', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await adminCreateAdmin({ email, role: createForm.role });

      toast({
        title: result.inviteSent ? 'Convite enviado' : 'Admin atualizado',
        description: result.inviteSent
          ? `Um convite foi enviado para ${email}.`
          : `${email} agora tem permissao de ${adminRoleLabels[createForm.role]}.`,
      });

      setCreateForm({ email: '', role: 'admin' });
      setShowCreateModal(false);
      await fetchAdmins();
    } catch (error) {
      toast({
        title: 'Erro ao convidar admin',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (admin) => {
    if (!canManageAdmins) return;
    setAdminToEdit(admin);
    setEditForm({ role: admin.role || 'admin' });
    setShowEditModal(true);
  };

  const handleUpdateAdmin = async (event) => {
    event.preventDefault();
    if (!canManageAdmins || !adminToEdit) return;

    setIsSubmitting(true);
    try {
      await adminUpdateAdmin({
        adminId: adminToEdit.status === 'active' ? adminToEdit.id : undefined,
        invitationId: adminToEdit.invitation_id || undefined,
        role: editForm.role,
      });

      toast({
        title: 'Permissao atualizada',
        description: `${adminToEdit.email} agora esta como ${adminRoleLabels[editForm.role]}.`,
      });

      setShowEditModal(false);
      setAdminToEdit(null);
      await fetchAdmins();
    } catch (error) {
      toast({
        title: 'Erro ao atualizar admin',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendInvitation = async (admin) => {
    if (!canManageAdmins || !admin?.invitation_id) return;

    setResendingInvitationId(admin.invitation_id);
    try {
      await adminResendInvitation({ invitationId: admin.invitation_id });
      toast({
        title: 'Convite reenviado',
        description: `Um novo link foi enviado para ${admin.email}.`,
      });
      await fetchAdmins();
    } catch (error) {
      toast({
        title: 'Erro ao reenviar convite',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setResendingInvitationId(null);
    }
  };

  const handleRemoveAdmin = async () => {
    if (!canManageAdmins || !adminToRemove) return;

    setIsSubmitting(true);
    try {
      await adminRemoveAdmin({
        adminId: adminToRemove.status === 'active' ? adminToRemove.id : undefined,
        invitationId: adminToRemove.invitation_id || undefined,
      });
      toast({
        title: adminToRemove.invitation_id ? 'Convite cancelado' : 'Admin removido',
        description: `${adminToRemove.email || 'O admin'} nao tera mais esse acesso.`,
      });
      setAdminToRemove(null);
      await fetchAdmins();
    } catch (error) {
      toast({
        title: 'Erro ao remover admin',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleProjects = useCallback((adminId) => {
    setExpandedAdminId((current) => (current === adminId ? null : adminId));
  }, []);

  const tableColSpan = canManageAdmins ? 6 : 5;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Admins</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Visualize administradores, convites e projetos vinculados.
          </p>
        </div>

        {canManageAdmins && (
          <Button
            onClick={() => setShowCreateModal(true)}
            className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600"
            disabled={isSubmitting}
          >
            <UserPlus className="h-4 w-4" />
            Novo Admin
          </Button>
        )}
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
        ) : admins.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-6 py-3">Admin</th>
                  <th className="px-6 py-3">Papel</th>
                  <th className="px-6 py-3">Status</th>
                  <th className="px-6 py-3">Projetos</th>
                  <th className="px-6 py-3">Criado em</th>
                  {canManageAdmins && <th className="px-6 py-3 text-right">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => {
                  const linkedProjects = getLinkedProjects(admin.projects);
                  const adminKey = getAdminKey(admin);
                  const isExpanded = expandedAdminId === adminKey;
                  const canExpandProjects = linkedProjects.length >= 1;
                  const isPending = Boolean(admin.invitation_id);

                  return (
                    <React.Fragment key={adminKey}>
                      <tr
                        className={`border-t border-border bg-card transition-colors ${canExpandProjects ? 'cursor-pointer hover:bg-accent/60' : ''}`}
                        onClick={canExpandProjects ? () => handleToggleProjects(adminKey) : undefined}
                        onKeyDown={(event) => {
                          if (!canExpandProjects) return;
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            handleToggleProjects(adminKey);
                          }
                        }}
                        tabIndex={canExpandProjects ? 0 : -1}
                        aria-expanded={canExpandProjects ? isExpanded : undefined}
                      >
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="rounded-lg bg-primary/10 p-2 text-primary">
                              <ShieldCheck className="h-4 w-4" />
                            </div>
                            <p className="font-semibold text-foreground">{admin.email || 'Email nao informado'}</p>
                          </div>
                        </td>
                        <td className="px-6 py-4">{adminRoleLabels[admin.role] || admin.role}</td>
                        <td className="px-6 py-4"><StatusPill status={admin.status} /></td>
                        <td className="px-6 py-4">
                          <span className="text-sm font-semibold text-foreground">{linkedProjects.length}</span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">{formatDate(admin.created_at)}</td>
                        {canManageAdmins && (
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-1">
                              {isPending && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleResendInvitation(admin);
                                  }}
                                  disabled={resendingInvitationId === admin.invitation_id}
                                  aria-label="Reenviar convite"
                                >
                                  {resendingInvitationId === admin.invitation_id ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                  ) : (
                                    <RefreshCcw className="h-4 w-4 text-indigo-500" />
                                  )}
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openEditModal(admin);
                                }}
                                aria-label="Editar permissao"
                              >
                                <Edit className="h-4 w-4 text-blue-500" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setAdminToRemove(admin);
                                }}
                                aria-label={isPending ? 'Cancelar convite' : 'Remover admin'}
                              >
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {canExpandProjects && isExpanded && (
                        <tr className="border-t border-border bg-muted/50">
                          <td colSpan={tableColSpan} className="px-6 py-4">
                            <div className="space-y-2">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                Projetos vinculados
                              </p>
                              <ProjectNames projects={linkedProjects} />
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-muted-foreground">Nenhum admin cadastrado.</div>
        )}
      </motion.div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Admin</DialogTitle>
            <DialogDescription>O convidado recebera um link para criar a senha.</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateAdmin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={createForm.email}
                onChange={handleCreateChange}
                disabled={isSubmitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Papel</Label>
              <select
                id="role"
                value={createForm.role}
                onChange={handleCreateChange}
                disabled={isSubmitting}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="admin">Admin</option>
                <option value="superadmin">Superadmin</option>
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar convite
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar permissao</DialogTitle>
            <DialogDescription>{adminToEdit?.email}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateAdmin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role">Papel</Label>
              <select
                id="role"
                value={editForm.role}
                onChange={handleEditChange}
                disabled={isSubmitting}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="admin">Admin</option>
                <option value="superadmin">Superadmin</option>
              </select>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditModal(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Salvar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!adminToRemove} onOpenChange={(open) => !open && setAdminToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{adminToRemove?.invitation_id ? 'Cancelar convite' : 'Remover admin'}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            Tem certeza que deseja remover o acesso de {adminToRemove?.email || 'este usuario'}?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveAdmin} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminTab;
