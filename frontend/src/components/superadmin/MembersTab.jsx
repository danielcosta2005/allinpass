import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Users, Plus, Loader2, Edit, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { listMembers } from '@/lib/api';
import { adminCreateMember, adminUpdateMember, adminRemoveMember } from '@/lib/admin';

const MembersTab = ({ projectId }) => {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', role: 'staff' });

  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({ newPassword: '', role: 'staff' });
  
  const [memberToEdit, setMemberToEdit] = useState(null);
  const [memberToRemove, setMemberToRemove] = useState(null);

  const fetchMembers = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const data = await listMembers(projectId);
      setMembers(data);
    } catch (error) {
      toast({ title: "Erro ao carregar membros", description: error.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);
  
  const handleCreateFormChange = (e) => {
    const { id, value } = e.target;
    setCreateForm(prev => ({ ...prev, [id]: value }));
  };

  const handleEditFormChange = (e) => {
    const { id, value } = e.target;
    setEditForm(prev => ({ ...prev, [id]: value }));
  };

  const validatePassword = (password) => {
    if (!password) return true;
    if (password.length < 6) return false;
    return true;
  };

  const handleCreateMember = async (e) => {
    e.preventDefault();
    if (createForm.password && !validatePassword(createForm.password)) {
      toast({ title: "Senha inválida", description: "A senha deve ter no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await adminCreateMember({
        projectId,
        email: createForm.email.trim(),
        password: createForm.password || undefined,
        role: createForm.role,
      });
      
      if (result.inviteSent) {
        toast({ title: "Convite enviado!", description: `Um convite foi enviado para ${createForm.email}.` });
      } else {
        toast({ title: "Membro adicionado!", description: `${createForm.email} foi criado e adicionado ao projeto.` });
      }

      setCreateForm({ email: '', password: '', role: 'staff' });
      setShowCreateModal(false);
      await fetchMembers();
    } catch (error) {
      toast({ title: "Erro ao adicionar membro", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (member) => {
    setMemberToEdit(member);
    setEditForm({ newPassword: '', role: member.role });
    setShowEditModal(true);
  };
  
  const handleUpdateMember = async (e) => {
    e.preventDefault();
    if (editForm.newPassword && !validatePassword(editForm.newPassword)) {
      toast({ title: "Senha inválida", description: "A nova senha deve ter no mínimo 6 caracteres.", variant: "destructive" });
      return;
    }
    setIsSubmitting(true);
    try {
      await adminUpdateMember({
        memberId: memberToEdit.user_id,
        projectId,
        role: editForm.role,
        password: editForm.newPassword || undefined,
      });
      toast({ title: "Membro atualizado!", description: "As informações do membro foram salvas." });
      setShowEditModal(false);
      setMemberToEdit(null);
      await fetchMembers();
    } catch (error) {
      toast({ title: "Erro ao atualizar membro", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!memberToRemove) return;
    setIsSubmitting(true);
    try {
      await adminRemoveMember({ projectId, memberId: memberToRemove.user_id });
      toast({ title: "Membro removido", description: `${memberToRemove.email} foi removido do projeto.` });
      setMemberToRemove(null);
      await fetchMembers();
    } catch (error) {
      toast({ title: "Erro ao remover membro", description: error.message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Membros</h2>
        <Button onClick={() => setShowCreateModal(true)} className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600">
          <Plus className="w-4 h-4" /> Novo Membro
        </Button>
      </div>
      
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-white rounded-2xl p-6 shadow-lg border border-purple-100">
        <h3 className="text-lg font-bold mb-4">Membros do Projeto</h3>
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : members.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3">Email</th>
                  <th scope="col" className="px-6 py-3">Papel</th>
                  <th scope="col" className="px-6 py-3">Criação</th>
                  <th scope="col" className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {members.map(member => (
                  <tr key={member.user_id} className="bg-white border-b">
                    <td className="px-6 py-4 font-semibold">{member.email || '—'}</td>
                    <td className="px-6 py-4 capitalize">{member.role}</td>
                    <td className="px-6 py-4">{new Date(member.created_at).toLocaleDateString()}</td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="icon" onClick={() => openEditModal(member)}><Edit className="h-4 w-4 text-blue-500" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => setMemberToRemove(member)}><Trash2 className="h-4 w-4 text-red-500" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-600 text-center mt-4">Nenhum membro neste projeto.</p>
        )}
      </motion.div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Criar Novo Membro</DialogTitle></DialogHeader>
          <form onSubmit={handleCreateMember} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" value={createForm.email} onChange={handleCreateFormChange} required disabled={isSubmitting}/></div>
            <div className="space-y-2"><Label htmlFor="password">Senha (Opcional)</Label><Input id="password" type="password" placeholder="Deixe em branco para enviar convite" value={createForm.password} onChange={handleCreateFormChange} disabled={isSubmitting}/></div>
            <div className="space-y-2"><Label htmlFor="role">Papel</Label>
              <select id="role" value={createForm.role} onChange={handleCreateFormChange} className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmitting}>
                <option value="owner">Owner</option><option value="staff">Staff</option>
              </select>
            </div>
            <DialogFooter><Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Criar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      
      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader><DialogTitle>Editar Membro</DialogTitle><DialogDescription>{memberToEdit?.email}</DialogDescription></DialogHeader>
          <form onSubmit={handleUpdateMember} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="newPassword">Nova Senha (opcional)</Label><Input id="newPassword" type="password" placeholder="Deixe em branco para não alterar" value={editForm.newPassword} onChange={handleEditFormChange} disabled={isSubmitting}/></div>
            <div className="space-y-2"><Label htmlFor="role">Papel</Label>
              <select id="role" value={editForm.role} onChange={handleEditFormChange} className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmitting}>
                <option value="owner">Owner</option><option value="staff">Staff</option>
              </select>
            </div>
            <DialogFooter><Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Salvar</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!memberToRemove} onOpenChange={(open) => !open && setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Confirmar Remoção</AlertDialogTitle></AlertDialogHeader>
          <AlertDialogDescription>Tem certeza que deseja remover {memberToRemove?.email} deste projeto? Esta ação não pode ser desfeita.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setMemberToRemove(null)} disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveMember} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin"/>} Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default MembersTab;