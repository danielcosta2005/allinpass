import React, { useState } from 'react';
    import { motion } from 'framer-motion';
    import { Bell, Loader2, Send } from 'lucide-react';
    import { Button } from '@/components/ui/button';
    import { Textarea } from '@/components/ui/textarea';
    import { useToast } from '@/components/ui/use-toast';
    import {
      Dialog,
      DialogContent,
      DialogHeader,
      DialogTitle,
      DialogDescription,
      DialogFooter,
      DialogTrigger,
    } from '@/components/ui/dialog';

    const NotificationsTab = ({ projectId }) => {
      const [message, setMessage] = useState('');
      const [isLoading, setIsLoading] = useState(false);
      const { toast } = useToast();

      const handleSendNotification = async () => {
        if (!message.trim()) {
          toast({
            variant: 'destructive',
            title: 'Erro de Validação',
            description: 'A mensagem não pode estar vazia.',
          });
          return;
        }

        setIsLoading(true);
        try {
          const functionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL || `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;
          const response = await fetch(`${functionsUrl}/send-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            },
            body: JSON.stringify({ projectId, message }),
          });

          const result = await response.json();

          if (!response.ok || result.error) {
            throw new Error(result.error || 'Falha ao enviar notificações.');
          }

          toast({
            title: 'Sucesso!',
            description: result.message || 'Notificações enviadas para os clientes.',
          });
          setMessage('');
        } catch (error) {
          toast({
            variant: 'destructive',
            title: 'Erro ao Enviar',
            description: error.message,
          });
        } finally {
          setIsLoading(false);
        }
      };

      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-6"
        >
          <div className="bg-white p-6 rounded-lg shadow-sm border">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Enviar Notificação</h2>
            <p className="text-gray-600 mb-6">
              Envie uma mensagem para todos os clientes com um passe de fidelidade ativo. A mensagem aparecerá diretamente no cartão do Google Wallet e como uma atualização no Apple Wallet.
            </p>
            
            <div className="space-y-4">
              <Textarea
                placeholder="Escreva sua mensagem aqui... Ex: 'Hoje tem promoção de café em dobro!'"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="min-h-[120px] text-base"
                maxLength={200}
              />
              <div className="text-right text-sm text-gray-500">
                {message.length} / 200
              </div>
              
              <Dialog>
                <DialogTrigger asChild>
                  <Button size="lg" className="w-full sm:w-auto gap-2" disabled={isLoading || !message.trim()}>
                    <Send className="w-4 h-4" />
                    Revisar e Enviar
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirmar Envio da Notificação?</DialogTitle>
                    <DialogDescription>
                      Você está prestes a enviar a seguinte mensagem para todos os seus clientes com passes ativos. Esta ação não pode ser desfeita.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="my-4 p-4 bg-gray-100 rounded-md border text-gray-700">
                    <p>{message}</p>
                  </div>
                  <DialogFooter>
                    <Button
                      onClick={handleSendNotification}
                      disabled={isLoading}
                      className="w-full"
                    >
                      {isLoading ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <Bell className="w-4 h-4 mr-2" />
                      )}
                      Confirmar e Enviar para Todos
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </motion.div>
      );
    };

    export default NotificationsTab;