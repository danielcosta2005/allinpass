import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode.react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { getClaimUrl } from '@/lib/helpers';
import { supabase } from '@/lib/supabaseClient';
import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function QRTab({ projectId }) {
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [loadingProject, setLoadingProject] = useState(true);

  const [project, setProject] = useState(null);

  const [claimUrl, setClaimUrl] = useState('');
  const [claimUrlTemplate, setClaimUrlTemplate] = useState('');
  const [qrPayloadTemplate, setQrPayloadTemplate] = useState('');

  // 1) Buscar projeto quando projectId existir
  useEffect(() => {
    const fetchProject = async () => {
      if (!projectId) return;

      setLoadingProject(true);
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('id', projectId)
        .single();

      if (error) {
        console.error('Erro ao buscar projeto:', error);
        toast({
          title: 'Erro ao carregar projeto',
          description: 'Não foi possível carregar os dados do projeto. Verifique vínculo/RLS.',
          variant: 'destructive',
        });
        setProject(null);
      } else {
        setProject(data);
      }

      setLoadingProject(false);
    };

    fetchProject();
  }, [projectId, toast]);

  // 2) Quando o projeto chegar, preencher os estados derivados
  useEffect(() => {
    if (!project?.id) return;

    setClaimUrl(getClaimUrl(project.id));
    setClaimUrlTemplate(project.claim_url_template || '');
    setQrPayloadTemplate(project.qr_payload_template || '');
  }, [project]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!project?.id) return;

    setLoading(true);

    const { data, error } = await supabase
      .from('projects')
      .update({
        claim_url_template: claimUrlTemplate,
        qr_payload_template: qrPayloadTemplate,
      })
      .eq('id', project.id)
      .select()
      .single();

    if (error) {
      console.error('Erro ao salvar configs QR:', error);
      toast({
        title: 'Erro ao salvar',
        description: 'Não foi possível salvar as configurações do QR Code.',
        variant: 'destructive',
      });
    } else {
      setProject(data);
      toast({
        title: 'Sucesso!',
        description: 'Configurações do QR Code salvas.',
      });
    }

    setLoading(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(claimUrl).then(() => {
      toast({ title: 'Copiado!', description: 'Link de resgate copiado para a área de transferência.' });
    }, () => {
      toast({ title: 'Erro', description: 'Não foi possível copiar o link.', variant: 'destructive' });
    });
  };

  const downloadQRCode = () => {
    const el = document.getElementById('qr-code-canvas');
    if (!el) return;

    // Se for canvas, funciona direto:
    if (el.tagName.toLowerCase() === 'canvas') {
      const pngUrl = el
        .toDataURL('image/png')
        .replace('image/png', 'image/octet-stream');

      const downloadLink = document.createElement('a');
      downloadLink.href = pngUrl;
      downloadLink.download = `qrcode-projeto-${project.id}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      return;
    }

    // Se qrcode.react renderizar como SVG, não dá pra usar toDataURL.
    toast({
      title: 'Download não suportado',
      description: 'O QRCode está em SVG. Precisamos ajustar o método de download.',
      variant: 'destructive',
    });
  };

  // Estados de carregamento/erro
  if (!projectId) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        Nenhum projeto associado.
      </div>
    );
  }

  if (loadingProject) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        Carregando projeto...
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        Não foi possível carregar o projeto. (Verifique vínculo/RLS)
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="p-6 bg-white rounded-lg shadow-md"
    >
      <h2 className="text-2xl font-bold mb-6 text-gray-800">QR Code e Link de Resgate</h2>

      <div className="grid md:grid-cols-2 gap-8 items-center">
        <div className="flex flex-col items-center justify-center p-6 border rounded-lg bg-gray-50">
          {claimUrl ? (
            <QRCode id="qr-code-canvas" value={claimUrl} size={256} level="H" />
          ) : (
            <div className="w-64 h-64 bg-gray-200 animate-pulse rounded-lg" />
          )}

          <Button onClick={downloadQRCode} className="mt-6 w-full" disabled={!claimUrl}>
            Baixar QR Code
          </Button>
        </div>

        <div className="space-y-6">
          <div>
            <Label htmlFor="claimUrl">Link de Resgate do Cliente</Label>
            <div className="flex items-center gap-2 mt-2">
              <Input id="claimUrl" type="text" value={claimUrl} readOnly className="bg-gray-100" />
              <Button onClick={copyToClipboard} variant="outline" size="icon" disabled={!claimUrl}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="h-4 w-4">
                  <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
                  <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
                </svg>
              </Button>
            </div>
            <p className="text-sm text-gray-500 mt-2">
              Compartilhe este link com seus clientes para que eles possam resgatar o passe de fidelidade.
            </p>
          </div>

          <form onSubmit={handleSave} className="space-y-4 pt-4 border-t">
            <div className="text-lg font-semibold text-gray-700">Configurações Avançadas</div>

            <div>
              <Label htmlFor="claimUrlTemplate">Template do Link de Resgate</Label>
              <Input
                id="claimUrlTemplate"
                value={claimUrlTemplate}
                onChange={(e) => setClaimUrlTemplate(e.target.value)}
                placeholder="Ex: https://seusite.com/resgate/{projectId}"
              />
              <p className="text-xs text-gray-500 mt-1">
                Use {'{projectId}'} e {'{googleSub}'}. Deixe em branco para usar o padrão.
              </p>
            </div>

            <div>
              <Label htmlFor="qrPayloadTemplate">Template do Payload do QR Code</Label>
              <Input
                id="qrPayloadTemplate"
                value={qrPayloadTemplate}
                onChange={(e) => setQrPayloadTemplate(e.target.value)}
                placeholder="Ex: https://seusistema.com/scan?p={projectId}&c={googleSub}"
              />
              <p className="text-xs text-gray-500 mt-1">
                Template para leitura em scanners. Use {'{projectId}'} e {'{googleSub}'}.
              </p>
            </div>

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar Configurações
            </Button>
          </form>
        </div>
      </div>
    </motion.div>
  );
}
