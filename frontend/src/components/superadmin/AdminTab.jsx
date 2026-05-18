import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Loader2, RefreshCcw, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { adminCreateAdmin, adminListAdmins, adminRemoveAdmin } from '@/lib/admin';

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('pt-BR');
}

function ProjectBadges({ projects }) {
  const linkedProjects = Array.isArray(projects) ? projects : [];

  if (linkedProjects.length === 0) {
    return <span className="text-sm text-gray-500">Nenhum projeto vinculado</span>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {linkedProjects.map((project) => (
        <span
          key={project.id}
          className="rounded-full border border-purple-100 bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700"
        >
          {project.name || 'Projeto sem nome'}
        </span>
      ))}
    </div>
  );
}

const AdminTab = () => {
  const { toast } = useToast();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [adminToRemove, setAdminToRemove] = useState(null);
  const [createForm, setCreateForm] = useState({ email: '', password: '' });

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

  const handleCreateAdmin = async (event) => {
    event.preventDefault();

    const email = createForm.email.trim().toLowerCase();
    const password = createForm.password.trim();

    if (!email) {
      toast({ title: 'Email obrigatório', variant: 'destructive' });
      return;
    }

    if (password && password.length < 6) {
      toast({
        title: 'Senha inválida',
        description: 'A senha deve ter no mínimo 6 caracteres.',
        variant: 'destructive',
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await adminCreateAdmin({
        email,
        password: password || undefined,
      });

      toast({
        title: result.inviteSent ? 'Convite enviado' : 'Admin criado',
        description: result.inviteSent
          ? `Um convite foi enviado para ${email}.`
          : `${email} agora tem acesso de admin.`,
      });

      setCreateForm({ email: '', password: '' });
      setShowCreateModal(false);
      await fetchAdmins();
    } catch (error) {
      toast({
        title: 'Erro ao criar admin',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemoveAdmin = async () => {
    if (!adminToRemove?.id) return;

    setIsSubmitting(true);
    try {
      await adminRemoveAdmin({ adminId: adminToRemove.id });
      toast({
        title: 'Admin removido',
        description: `${adminToRemove.email || 'O admin'} perdeu o acesso administrativo.`,
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Admins</h2>
          <p className="mt-1 text-sm text-gray-600">
            Gerencie administradores e veja os projetos criados por cada um.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={fetchAdmins} disabled={loading || isSubmitting}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
          <Button
            onClick={() => setShowCreateModal(true)}
            className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600"
            disabled={isSubmitting}
          >
            <UserPlus className="h-4 w-4" />
            Novo Admin
          </Button>
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-lg"
      >
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : admins.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-700">
                <tr>
                  <th className="px-6 py-3">Admin</th>
                  <th className="px-6 py-3">Projetos vinculados</th>
                  <th className="px-6 py-3">Criado em</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((admin) => (
                  <tr key={admin.id} className="border-t bg-white">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-indigo-50 p-2 text-indigo-600">
                          <ShieldCheck className="h-4 w-4" />
                        </div>
                        <div>
                          <p className="font-semibold text-gray-900">{admin.email || 'Email não informado'}</p>
                          <p className="font-mono text-xs text-gray-500">{admin.id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <ProjectBadges projects={admin.projects} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">{formatDate(admin.created_at)}</td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="icon" onClick={() => setAdminToRemove(admin)}>
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-10 text-center text-gray-600">Nenhum admin cadastrado.</div>
        )}
      </motion.div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo Admin</DialogTitle>
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
              <Label htmlFor="password">Senha (opcional)</Label>
              <Input
                id="password"
                type="password"
                value={createForm.password}
                onChange={handleCreateChange}
                placeholder="Deixe em branco para enviar convite"
                disabled={isSubmitting}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowCreateModal(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Criar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!adminToRemove} onOpenChange={(open) => !open && setAdminToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover admin</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogDescription>
            Tem certeza que deseja remover o acesso admin de {adminToRemove?.email || 'este usuário'}?
          </AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmitting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemoveAdmin} disabled={isSubmitting} className="bg-red-600 hover:bg-red-700">
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminTab;
