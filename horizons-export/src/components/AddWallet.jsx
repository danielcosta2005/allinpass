import React, { useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, Wallet } from 'lucide-react';

const AddWallet = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleAddWallet = async (event) => {
    event.preventDefault();
    setLoading(true);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      toast({
        title: "Não autenticado",
        description: "Você precisa estar logado para adicionar uma carteira.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    try {
      const response = await supabase.functions.invoke('add-wallet', {
        body: JSON.stringify({
          wallet_address: '0x' + [...Array(40)].map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
          chain: 'ethereum',
          label: 'MetaMask Example'
        })
      });

      if (response.error) {
        throw new Error(response.error.message);
      }
      
      if (response.data.error) {
         throw new Error(response.data.error);
      }

      toast({
        title: "Sucesso!",
        description: response.data.message || "Carteira adicionada com sucesso.",
      });

    } catch (error) {
      toast({
        title: "Erro ao adicionar carteira",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
      <div className="text-center">
        <h1 className="text-2xl font-bold">Adicionar Carteira</h1>
        <p className="text-sm text-gray-500">
          Clique no botão para adicionar uma carteira de exemplo.
        </p>
      </div>
      <form onSubmit={handleAddWallet}>
        <Button type="submit" className="w-full gap-2" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
          Adicionar Carteira de Exemplo
        </Button>
      </form>
    </div>
  );
};

export default AddWallet;