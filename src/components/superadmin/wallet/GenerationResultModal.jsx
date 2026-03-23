import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Apple, Smartphone, Copy, X } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { QRCode } from 'react-qrcode-logo';

const GenerationResultModal = ({ isOpen, setIsOpen, result }) => {
  const { toast } = useToast();

  if (!isOpen) return null;

  const copyToClipboard = (text) => {
    if (!text) {
      toast({ title: 'Link indisponível', variant: 'destructive' });
      return;
    }
    navigator.clipboard.writeText(text);
    toast({ title: 'Copiado para a área de transferência!' });
  };

  // Mantém compatibilidade com retorno antigo (caso ainda venha google_jwt).
  // Se você remover google_jwt do create-pass, esse botão simplesmente some.
  const googleSaveUrl = result?.google_jwt
    ? `https://pay.google.com/gp/v/save/${result.google_jwt}`
    : null;

  // ✅ Novo: o "Link Único" essencial agora é o qr_url (claim link).
  // Fallback: se algum ambiente ainda retornar "claim_url", usa também.
  const shareUrl = result?.qr_url || result?.claim_url || null;

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {result?.error ? 'Erro ao Gerar Passe' : 'Passe Gerado com Sucesso!'}
          </DialogTitle>
          <DialogDescription>
            {result?.error
              ? 'Ocorreu um problema ao gerar seu passe.'
              : 'Use o link único para compartilhar o resgate (com autenticação) ou abra diretamente nos botões abaixo.'}
          </DialogDescription>
        </DialogHeader>

        {result?.error && (
          <div className="text-red-500 p-4 bg-red-50 dark:bg-red-900/20 rounded-md break-all my-4">
            <p className="font-bold">Detalhes do Erro:</p>
            <p className="text-xs mt-2">{result.error}</p>
          </div>
        )}

        {result && !result.error && (
          <div className="p-4 space-y-4">
            {shareUrl && (
              <div className="flex flex-col items-center gap-4 p-4 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <QRCode value={shareUrl} size={128} />
                <div className="text-center">
                  <p className="font-semibold">Link Único (Compartilhável)</p>
                  <p className="text-xs text-muted-foreground break-all">
                    {shareUrl}
                  </p>
                </div>
                <Button
                  onClick={() => copyToClipboard(shareUrl)}
                  variant="outline"
                  className="w-full justify-center gap-2"
                >
                  <Copy className="w-4 h-4" /> Copiar Link Único
                </Button>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-4">
              {result.apple_url && (
                <Button asChild className="w-full">
                  <a
                    href={result.apple_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 justify-center"
                  >
                    <Apple className="w-5 h-5" /> Abrir no iPhone
                  </a>
                </Button>
              )}

              {googleSaveUrl && (
                <Button asChild className="w-full">
                  <a
                    href={googleSaveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 justify-center"
                  >
                    <Smartphone className="w-5 h-5" /> Abrir no Android
                  </a>
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setIsOpen(false)}>
            <X className="mr-2 h-4 w-4" /> Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default GenerationResultModal;
