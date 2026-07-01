import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Plus, Loader2, Edit, Trash2, QrCode, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter
} from "@/components/ui/dialog";
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { listProjects, createProject, updateProject, deleteProject, uploadProjectLogo } from '@/lib/api';

const ProjectCard = ({ project, onSelect, onEdit, onDelete, canManage, canDelete }) => {
    const qrUrl = `${window.location.origin}/c/${project.id}/me`;
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-lg shadow-slate-950/5 dark:shadow-black/20"
        >
            <div className="p-6">
                <div className="flex justify-between items-start">
                    <div
                        className={`flex-1 ${canManage ? 'cursor-pointer' : ''}`}
                        onClick={() => {
                            if (canManage) onSelect(project);
                        }}
                    >
                        {project.logo_url ? <img src={project.logo_url} alt={project.name} className="h-12 w-auto mb-4 rounded-md object-contain" /> : <div className="h-12 w-12 bg-muted rounded-md mb-4 flex items-center justify-center text-muted-foreground">Logo</div>}
                        <h3 className="text-lg font-bold mb-2">{project.name || '(Sem nome)'}</h3>
                        <p className="text-sm text-muted-foreground h-10 overflow-hidden">{project.description || 'Sem descrição.'}</p>
                        {!canManage && (
                            <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                                <Eye className="h-3.5 w-3.5" />
                                Somente visualização
                            </div>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                        {canManage && (
                            <Button variant="ghost" size="icon" onClick={() => onEdit(project)} aria-label="Editar projeto">
                                <Edit className="h-4 w-4 text-blue-500" />
                            </Button>
                        )}
                        {canDelete && (
                            <Button variant="ghost" size="icon" onClick={() => onDelete(project)} aria-label="Excluir projeto">
                                <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                        )}
                    </div>
                </div>
            </div>
            <div className="bg-muted p-4 flex items-center justify-between">
                <a href={qrUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-muted-foreground truncate hover:text-primary hover:underline">
                    {qrUrl}
                </a>
                <a href={qrUrl} target="_blank" rel="noopener noreferrer">
                    <QrCode className="h-5 w-5 text-primary hover:text-primary/80" />
                </a>
            </div>
        </motion.div>
    );
};

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
                        <Button type="submit" disabled={isSubmitting}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Salvar</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};

const ProjectsTab = ({ onSelectProject, canManageProject = () => true, canDeleteProjects = true }) => {
    const [projects, setProjects] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAlertOpen, setIsAlertOpen] = useState(false);
    const [currentProject, setCurrentProject] = useState(null);
    const [projectToDelete, setProjectToDelete] = useState(null);
    const { toast } = useToast();

    const fetchProjects = useCallback(async () => {
        setLoading(true);
        try {
            const data = await listProjects();
            setProjects(data);
        } catch (error) {
            toast({ title: "Erro ao carregar projetos", description: error.message, variant: "destructive" });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    useEffect(() => { fetchProjects(); }, [fetchProjects]);

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
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold">Projetos</h2>
                <Button onClick={() => { setCurrentProject(null); setIsModalOpen(true); }} className="gap-2 bg-gradient-to-r from-purple-600 to-indigo-600">
                    <Plus className="w-4 h-4" /> Novo Projeto
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : (
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {projects.map((project) => (
                        <ProjectCard
                            key={project.id}
                            project={project}
                            onSelect={onSelectProject}
                            onEdit={(p) => { setCurrentProject(p); setIsModalOpen(true); }}
                            onDelete={(p) => { setProjectToDelete(p); setIsAlertOpen(true); }}
                            canManage={canManageProject(project)}
                            canDelete={canDeleteProjects}
                        />
                    ))}
                </div>
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
