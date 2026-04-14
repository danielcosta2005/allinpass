
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Send, Loader2, Apple, Smartphone, Mail as MailIcon } from 'lucide-react';

const NotificationsPanel = ({ projectId }) => {
    const [title, setTitle] = useState('');
    const [message, setMessage] = useState('');
    const [channels, setChannels] = useState({ apple: true, google: true, email: false });
    const [isSending, setIsSending] = useState(false);
    const { toast } = useToast();

    const handleChannelChange = (channel) => {
        setChannels(prev => ({ ...prev, [channel]: !prev[channel] }));
    };

    const handleSendNotification = async () => {
        const selectedChannels = Object.keys(channels).filter(c => channels[c]);
        if (!title || !message || selectedChannels.length === 0) {
            toast({
                title: "Campos obrigatórios",
                description: "Por favor, preencha o título, a mensagem e selecione pelo menos um canal.",
                variant: "destructive",
            });
            return;
        }

        setIsSending(true);
        try {
            const { error } = await supabase.functions.invoke('send-notification', {
                body: {
                    project_id: projectId,
                    title,
                    message,
                    channels: selectedChannels,
                },
            });

            if (error) throw error;

            toast({
                title: "Notificação enviada!",
                description: "A notificação foi agendada para envio para os canais selecionados.",
            });
            setTitle('');
            setMessage('');
        } catch (error) {
            toast({
                title: "Erro ao enviar notificação",
                description: error.message,
                variant: "destructive",
            });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div className="p-4 space-y-6">
            <div>
                <h3 className="text-xl font-semibold">Enviar Notificação Push</h3>
                <p className="text-muted-foreground text-sm">Envie uma mensagem para os usuários que possuem passes deste projeto.</p>
            </div>
            
            <div className="space-y-4 max-w-lg">
                <div className="space-y-2">
                    <Label htmlFor="notification-title">Título</Label>
                    <Input
                        id="notification-title"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="Ex: Nova Oferta Imperdível!"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="notification-message">Mensagem</Label>
                    <Textarea
                        id="notification-message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="Descreva sua notificação aqui..."
                    />
                </div>
            </div>

            <div className="space-y-3">
                 <Label>Canais de Envio</Label>
                 <div className="flex flex-col sm:flex-row gap-4">
                    <ChannelCheckbox id="apple" checked={channels.apple} onCheckedChange={() => handleChannelChange('apple')} icon={Apple} label="Apple Wallet"/>
                    <ChannelCheckbox id="google" checked={channels.google} onCheckedChange={() => handleChannelChange('google')} icon={Smartphone} label="Google Wallet"/>
                    <ChannelCheckbox id="email" checked={channels.email} onCheckedChange={() => handleChannelChange('email')} icon={MailIcon} label="Email"/>
                 </div>
            </div>

            <div className="pt-4">
                <Button onClick={handleSendNotification} disabled={isSending}>
                    {isSending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    {isSending ? 'Enviando...' : 'Enviar Notificação'}
                </Button>
            </div>
        </div>
    );
};

const ChannelCheckbox = ({ id, checked, onCheckedChange, icon: Icon, label }) => (
     <Label htmlFor={id} className="flex items-center gap-3 p-3 border rounded-lg hover:bg-accent hover:text-accent-foreground cursor-pointer transition-colors">
        <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} />
        <Icon className="w-5 h-5"/>
        <span className="font-medium">{label}</span>
    </Label>
);

export default NotificationsPanel;

