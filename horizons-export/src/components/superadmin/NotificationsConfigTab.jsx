import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/supabaseClient';
import { Loader2, Send, Bell } from 'lucide-react';

export default function NotificationsConfigTab({ projectId }) {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [channels, setChannels] = useState({
    apple: false,
    google: false,
    email: false,
  });
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const handleChannelChange = (channel) => {
    setChannels((prev) => ({ ...prev, [channel]: !prev[channel] }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!projectId) {
      toast({ title: "Erro", description: "Nenhum projeto selecionado.", variant: "destructive" });
      return;
    }
    if (!title || !message) {
      toast({ title: "Erro", description: "Título e mensagem são obrigatórios.", variant: "destructive" });
      return;
    }
    const selectedChannels = Object.keys(channels).filter(c => channels[c]);
    if (selectedChannels.length === 0) {
      toast({ title: "Erro", description: "Selecione pelo menos um canal de notificação.", variant: "destructive" });
      return;
    }

    setIsLoading(true);

    const { data, error } = await supabase.functions.invoke('send-notification', {
        body: {
          project_id: projectId,
          title,
          message,
          channels: selectedChannels,
        }
    });

    setIsLoading(false);

    if (error || data?.error) {
      toast({
        title: "Erro ao enviar notificação",
        description: error?.message || data?.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Sucesso!",
        description: "Notificação enviada para a fila de processamento.",
      });
      setTitle('');
      setMessage('');
      setChannels({ apple: false, google: false, email: false });
    }
  };

  return (
    <div className="p-6 bg-gradient-to-br from-gray-50 to-slate-50 rounded-lg shadow-inner border">
      <form onSubmit={handleSubmit} className="space-y-8 max-w-2xl mx-auto">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 flex items-center justify-center gap-3"><Bell className="text-purple-600"/> Enviar Notificação Push</h2>
          <p className="text-gray-600 mt-2">Envie atualizações e ofertas para os seus clientes diretamente na Wallet deles.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="title" className="text-lg font-semibold">Título da Notificação</Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Sua recompensa chegou!" className="text-base p-4"/>
        </div>

        <div className="space-y-2">
          <Label htmlFor="message" className="text-lg font-semibold">Mensagem</Label>
          <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ex: Você ganhou um café grátis na sua próxima visita!" className="text-base p-4" rows={4}/>
        </div>

        <div className="space-y-4 rounded-lg border p-6 bg-white shadow-sm">
          <Label className="text-lg font-semibold">Canais de Envio</Label>
           <p className="text-sm text-gray-500">Selecione para onde a notificação deve ser enviada.</p>
          <div className="flex items-center space-x-6 pt-2">
            {['apple', 'google', 'email'].map((channel) => (
              <div key={channel} className="flex items-center space-x-2">
                <Checkbox id={channel} checked={channels[channel]} onCheckedChange={() => handleChannelChange(channel)} className="h-5 w-5"/>
                <Label htmlFor={channel} className="capitalize text-base">{channel === 'google' ? 'Google Wallet' : channel === 'apple' ? 'Apple Wallet' : 'E-mail'}</Label>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <Button type="submit" disabled={isLoading} size="lg" className="w-full max-w-xs text-lg font-bold">
            {isLoading ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Send className="mr-2 h-5 w-5" />}
            Enviar Notificação
          </Button>
        </div>
      </form>
    </div>
  );
}