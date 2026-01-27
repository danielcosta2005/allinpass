
import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { PlusCircle, Eye, Trash2, Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import GenerationResultModal from '@/components/superadmin/wallet/GenerationResultModal';

const PassesList = ({ projectId, onGenerate, isGenerating, onPassGenerated }) => {
    const [passes, setPasses] = useState([]);
    const [loading, setLoading] = useState(false);
    const { toast } = useToast();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedPass, setSelectedPass] = useState(null);

    const fetchPasses = useCallback(async () => {
        if (!projectId) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('v_passes')
                .select('*')
                .eq('project_id', projectId)
                .order('created_at', { ascending: false });
            
            if (error) throw error;
            setPasses(data || []);
        } catch (error) {
            toast({ title: 'Erro ao buscar passes', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [projectId, toast]);

    useEffect(() => {
        fetchPasses();
    }, [fetchPasses]);

    useEffect(() => {
        // This effect will be triggered from the parent when a new pass is generated.
        if (onPassGenerated) {
            fetchPasses();
        }
    },[onPassGenerated, fetchPasses])

    const handleViewPass = (pass) => {
        setSelectedPass(pass);
        setIsModalOpen(true);
    };

    return (
        <div className="space-y-4 p-4 mt-8">
            <div className="flex justify-between items-center">
                 <h3 className="text-xl font-semibold">Passes Emitidos</h3>
                <div className="flex gap-2">
                    <Button variant="outline" size="icon" onClick={fetchPasses} disabled={loading}><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></Button>
                    <Button onClick={onGenerate} disabled={isGenerating}>
                        {isGenerating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                        {isGenerating ? 'Gerando...' : 'Gerar Passe de Teste'}
                    </Button>
                </div>
            </div>
            <div className="rounded-lg border">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-gray-900/50"><tr>
                        <th className="p-3 text-left font-semibold">Email</th>
                        <th className="p-3 text-left font-semibold">Serial</th>
                        <th className="p-3 text-left font-semibold">Data</th>
                        <th className="p-3 text-left font-semibold">Status</th>
                        <th className="p-3 text-center font-semibold">Ações</th>
                    </tr></thead>
                    <tbody>
                        {loading && <tr><td colSpan="5" className="text-center p-8"><Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" /></td></tr>}
                        {!loading && passes.length === 0 && <tr><td colSpan="5" className="text-center p-8 text-gray-500">Nenhum passe emitido ainda. Clique em "Gerar Passe de Teste".</td></tr>}
                        {!loading && passes.map((pass) => (
                            <tr key={pass.serial_number} className="border-t dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                                <td className="p-3">{pass.email || 'N/A'}</td>
                                <td className="p-3 font-mono text-xs">{pass.serial_number}</td>
                                <td className="p-3">{new Date(pass.created_at).toLocaleDateString()}</td>
                                <td className="p-3"><span className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">{pass.status || 'Ativo'}</span></td>
                                <td className="p-3 flex justify-center gap-1">
                                    <Button variant="ghost" size="icon" onClick={() => handleViewPass(pass)} title="Ver Detalhes do Passe"><Eye className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" className="text-red-500" disabled title="Deletar (em breve)"><Trash2 className="w-4 h-4" /></Button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {selectedPass && <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={selectedPass} />}
        </div>
    );
}

export default PassesList;
