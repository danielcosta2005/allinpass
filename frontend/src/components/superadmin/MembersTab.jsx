import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Edit, Loader2, Plus, RefreshCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/components/ui/use-toast';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { listMembers } from '@/lib/api';
import {
  adminCreateMember,
  adminRemoveMember,
  adminResendInvitation,
  adminUpdateMember,
} from '@/lib/admin';

const memberRoleLabels = {
  owner: 'Gestor',
  staff: 'Funcionario',
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

function getMemberKey(member) {
  return member.user_id || member.invitation_id || member.email;
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

const MembersTab = ({ projectId, canManageMembers = true }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState(null);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', role: 'staff' });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ role: 'staff' });

  const [memberToEdit, setMemberToEdit] = useState(null);
  const [memberToRemove, setMemberToRemove] = useState(null);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listMembers(projectId);
      setMembers(data);
    } catch (error) {
      toast({ title: 'Erro ao carregar membros', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const handleCreateFormChange = (event) => {
    const { id, value } = event.target;
    setCreateForm((prev) => ({ ...prev, [id]: value }));
  };

  const handleCreateMember = async (event) => {
    event.preventDefault();
    if (!canManageMembers) return;

    const email = createForm.email.trim().toLowerCase();
    if (!email) {
      toast({ title: 'Email obrigatorio', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await adminCreateMember({
        projectId,
        email,
        role: createForm.role,
      });

      toast({
        title: result.inviteSent ? 'Convite enviado' : 'Membro adicionado',
        description: result.inviteSent
          ? `Um convite foi enviado para ${email}.`
          : `${email} foi adicionado ao projeto.`,
      });

      setCreateForm({ email: '', role: 'staff' });
      setShowCreateModal(false);
      await fetchMembers();
    } catch (error) {
      toast({ title: 'Erro ao adicionar membro', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (member) => {
    if (!canManageMembers) return;
    setMemberToEdit(member);
    setEditForm({ role: member.role || 'staff' });
    setShowEditModal(true);
  };

  const handleUpdateMember = async (event) => {
    event.preventDefault();
    if (!canManageMembers || !memberToEdit) return;

    setIsSubmitting(true);
    try {
      await adminUpdateMember({
        memberId: memberToEdit.user_id || undefined,
        invitationId: memberToEdit.invitation_id || undefined,
        projectId,
        role: editForm.role,
      });
      toast({ title: 'Membro atualizado', description: 'As permissoes do membro foram salvas.' });
      setShowEditModal(false);
      setMemberToEdit(null);
      await fetchMembers();
    } catch (error) {
      toast({ title: 'Erro ao atualizar membro', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendInvitation = async (member) => {
    if (!canManageMembers || !member?.invitation_id) return;

    setResendingInvitationId(member.invitation_id);
    try {
      await adminResendInvitation({ invitationId: member.invitation_id });
      toast({
        title: 'Convite reenviado',
        description: `Um novo link foi enviado para ${member.email}.`,
      });
      await fetchMembers();
    } catch (error) {
      toast({ title: 'Erro ao reenviar convite', description: error.message, variant: 'destructive' });
    } finally {
      setResendingInvitationId(null);
    }
  };

  const handleRemoveMember = async () => {
    if (!canManageMembers || !memberToRemove) return;

    setIsSubmitting(true);
    try {
      await adminRemoveMember({
        projectId,
        memberId: memberToRemove.user_id || undefined,
        invitationId: memberToRemove.invitation_id || undefined,
      });
      toast({
        title: memberToRemove.invitation_id ? 'Convite cancelado' : 'Membro removido',
        description: `${memberToRemove.email} nao tera mais esse acesso.`,
      });
      setMemberToRemove(null);
      await fetchMembers();
    } catch (error) {
      toast({ title: 'Erro ao remover membro', description: error.message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-2xl font-bold">Membros</h2>
        {canManageMembers && (
          <Button onClick={() => setShowCreateModal(true)} className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600">
            <Plus className="w-4 h-4" /> Novo Membro
          </Button>
        )}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-2xl border border-border bg-card p-6 text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
      >
        <h3 className="mb-4 text-lg font-bold">Membros do Projeto</h3>
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : members.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted text-xs uppercase text-muted-foreground">
                <tr>
                  <th scope="col" className="px-6 py-3">Email</th>
                  <th scope="col" className="px-6 py-3">Papel</th>
                  <th scope="col" className="px-6 py-3">Status</th>
                  <th scope="col" className="px-6 py-3">Criacao</th>
                  {canManageMembers && <th scope="col" className="px-6 py-3 text-right">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const memberStatus = member.status || 'active';
                  const isPending = Boolean(member.invitation_id);

                  return (
                    <tr key={getMemberKey(member)} className="border-b border-border bg-card">
                      <td className="px-6 py-4 font-semibold">{member.email || '-'}</td>
                      <td className="px-6 py-4">{memberRoleLabels[member.role] || member.role}</td>
                      <td className="px-6 py-4"><StatusPill status={memberStatus} /></td>
                      <td className="px-6 py-4">{formatDate(member.created_at)}</td>
                      {canManageMembers && (
                        <td className="px-6 py-4 text-right">
                          <div className="flex justify-end gap-1">
                            {isPending && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleResendInvitation(member)}
                                disabled={resendingInvitationId === member.invitation_id}
                                aria-label="Reenviar convite"
                              >
                                {resendingInvitationId === member.invitation_id ? (
                                  <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                                ) : (
                                  <RefreshCcw className="h-4 w-4 text-indigo-500" />
                                )}
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => openEditModal(member)} aria-label="Editar membro">
                              <Edit className="h-4 w-4 text-blue-500" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setMemberToRemove(member)} aria-label={isPending ? 'Cancelar convite' : 'Remover membro'}>
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-4 text-center text-muted-foreground">Nenhum membro neste projeto.</p>
        )}
      </motion.div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Membro</DialogTitle>
            <DialogDescription>O convidado recebera um link para criar a senha.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateMember} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={createForm.email}
                onChange={handleCreateFormChange}
                required
                disabled={isSubmitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="create-role">Papel</Label>
              <Select
                value={createForm.role}
                onValueChange={(value) => setCreateForm((prev) => ({ ...prev, role: value }))}
                disabled={isSubmitting}
              >
                <SelectTrigger id="create-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Gestor</SelectItem>
                  <SelectItem value="staff">Funcionario</SelectItem>
                </SelectContent>
              </Select>
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
            <DialogTitle>Editar Membro</DialogTitle>
            <DialogDescription>{memberToEdit?.email}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateMember} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-role">Papel</Label>
              <Select
                value={editForm.role}
                onValueChange={(value) => setEditForm((prev) => ({ ...prev, role: value }))}
                disabled={isSubmitting}
              >
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="owner">Gestor</SelectItem>
                  <SelectItem value="staff">Funcionario</SelectItem>
                </SelectContent>
              </Select>
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

      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{memberToRemove?.invitation_id ? 'Cancelar convite' : 'Remover membro'}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            Tem certeza que deseja remover {memberToRemove?.email} deste projeto?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToRemove(null)} disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MembersTab;
