import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Apple, Smartphone, Upload, Link as LinkIcon, Save, Settings } from 'lucide-react';
import GenerationResultModal from '@/components/superadmin/wallet/GenerationResultModal';
import { QRCode } from 'react-qrcode-logo';

const ColorInput = ({ label, ...props }) => (
  <div className="flex flex-col space-y-2">
    <Label className="text-sm font-medium">{label}</Label>
    <div className="relative">
      <Input
        type="color"
        {...props}
        className="p-0 h-10 w-full appearance-none border-none bg-transparent cursor-pointer"
      />
      <div
        className="absolute inset-0 rounded-md border pointer-events-none flex items-center justify-end px-2"
        style={{ backgroundColor: props.value }}
      >
        <span className="font-mono text-xs mix-blend-difference text-white">{props.value}</span>
      </div>
    </div>
  </div>
);

function formatExpPreview(v) {
  if (!v) return "XX/XX";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "XX/XX";
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}`;
  } catch {
    return "XX/XX";
  }
}

const PassPreview = ({ formState, qrPreviewUrl }) => {
  const [platform, setPlatform] = useState('apple');
  const {
    title = 'Título do Passe',
    colors = {},
    images = {},
    dataFields = [],
    sampleValues = {},
    exp_date,
  } = formState;

  const { background = '#6c5ce7', text = '#ffffff', label = '#ffffff' } = colors;
  const { logo: logoUrl, googleHero, appleStrip } = images;

  const pointsFieldKey = dataFields.find(f => f.key.toLowerCase().includes('points'))?.key;
  const pointsValue = pointsFieldKey ? (sampleValues[pointsFieldKey] || '123') : '123';

  const expText = `EXPIRA EM ${formatExpPreview(exp_date)}`;

  // ✅ ESSENCIAL: QR deve apontar pro link compartilhável (claim link)
  const qrValue = qrPreviewUrl || formState.qr_url || "https://example.com";

  return (
    <div className="sticky top-24">
      <div
        style={{ backgroundColor: background }}
        className="w-full max-w-sm mx-auto rounded-2xl flex flex-col text-white shadow-2xl font-sans transition-colors duration-300 overflow-hidden"
      >
        <div className="p-4 flex flex-col flex-1 min-h-[420px]">
          <header className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {logoUrl ? (
                <img
                  src={logoUrl}
                  alt="logo"
                  className="w-10 h-10 rounded-full bg-white object-contain p-1"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-white/20"></div>
              )}
              <h3 style={{ color: text }} className="font-bold text-lg">
                {title}
              </h3>
            </div>

            <p style={{ color: label }} className="text-xs uppercase font-semibold">
              {expText}
            </p>
          </header>

          {platform === "apple" && (
            appleStrip ? (
              <div className="-mx-4 mb-4">
                <img
                  src={appleStrip}
                  alt="Apple Strip"
                  className="w-full h-28 object-cover"
                />
              </div>
            ) : (
              <div className="-mx-4 mb-4">
                <div className="w-full h-28 bg-white/15" />
              </div>
            )
          )}

          <main className="flex-grow flex flex-col items-start justify-center text-left">
            <p style={{ color: label }} className="text-sm uppercase tracking-wider">
              Pontos
            </p>
            <p style={{ color: text }} className="text-4xl font-bold leading-none">
              {pointsValue}
            </p>
          </main>

          <footer className="mt-6 flex items-center justify-center">
            <div className="bg-white p-2 rounded-md">
              <QRCode
                value={qrValue}
                size={96}
                quietZone={0}
                bgColor="transparent"
              />
            </div>
          </footer>
        </div>

        {platform === "google" && (
          googleHero ? (
            <img
              src={googleHero}
              alt="Google Hero"
              className="w-full h-32 object-cover"
            />
          ) : (
            <div className="w-full h-32 bg-white/15"></div>
          )
        )}
      </div>

      <div className="mt-4 flex items-center justify-center gap-2">
        <Button
          size="sm"
          variant={platform === "apple" ? "default" : "secondary"}
          className="rounded-full gap-2"
          onClick={() => setPlatform("apple")}
        >
          <Apple className="w-4 h-4" /> Apple
        </Button>

        <Button
          size="sm"
          variant={platform === "google" ? "default" : "secondary"}
          className="rounded-full gap-2"
          onClick={() => setPlatform("google")}
        >
          <Smartphone className="w-4 h-4" /> Google
        </Button>
      </div>
    </div>
  );
};

const PassesList = ({ passes, loading, onAction }) => (
  <div className="rounded-lg border">
    <table className="w-full text-sm">
      <thead className="bg-gray-50 dark:bg-gray-900/50">
        <tr>
          <th className="p-3 text-left font-semibold">Título</th>
          <th className="p-3 text-left font-semibold">Tipo</th>
          <th className="p-3 text-left font-semibold">Expira</th>
          <th className="p-3 text-left font-semibold">Status</th>
          <th className="p-3 text-center font-semibold">Ações</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr>
            <td colSpan="5" className="text-center p-8">
              <Loader2 className="mx-auto h-6 w-6 animate-spin text-gray-400" />
            </td>
          </tr>
        )}
        {!loading && passes.length === 0 && (
          <tr>
            <td colSpan="5" className="text-center p-8 text-gray-500">
              Nenhum passe emitido para este projeto.
            </td>
          </tr>
        )}
        {!loading &&
          passes.map((pass) => (
            <tr
              key={pass.id}
              className="border-t dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50"
            >
              <td className="p-3 font-medium">{pass.title}</td>
              <td className="p-3">{pass.type}</td>
              <td className="p-3">
                {pass.exp_date ? new Date(pass.exp_date).toLocaleDateString() : "-"}
              </td>
              <td className="p-3">
                <span className="bg-green-100 text-green-800 text-xs font-medium me-2 px-2.5 py-0.5 rounded-full dark:bg-green-900 dark:text-green-300">
                  {pass.status || 'Ativo'}
                </span>
              </td>
              <td className="p-3 flex justify-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  // ✅ ESSENCIAL: copiar o link público (qr_url = claim link)
                  onClick={() => onAction('copy', pass.qr_url)}
                  title="Copiar Link Único"
                >
                  <LinkIcon className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction('apple', pass.apple_url)}
                  title="Abrir Link Apple"
                >
                  <Apple className="w-4 h-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onAction('google', pass.google_jwt)}
                  title="Abrir Link Google"
                >
                  <Smartphone className="w-4 h-4" />
                </Button>
              </td>
            </tr>
          ))}
      </tbody>
    </table>
  </div>
);

const WalletConfigTab = ({ projectId, onBack }) => {
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [passes, setPasses] = useState([]);
  const [loadingPasses, setLoadingPasses] = useState(false);
  const [generationResult, setGenerationResult] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [projectSlug, setProjectSlug] = useState('');
  const [formState, setFormState] = useState({
    type: 'loyalty',
    title: '',
    description: '',
    exp_date: '',
    colors: { background: '#6c5ce7', label: '#ffffff', text: '#ffffff' },
    images: { logo: '', icon: '', googleHero: '', appleStrip: '' },
    dataFields: [],
    sampleValues: {},
    // opcional: manter um campo local pra preview se quiser
    qr_url: '',
  });

  const fileInputRef = useRef(null);
  const [uploadingKey, setUploadingKey] = useState(null);

  const loadWalletDefaults = useCallback(async (pId) => {
    setIsProcessing(true);
    try {
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('slug')
        .eq('id', pId)
        .single();
      if (projectError) throw projectError;
      setProjectSlug(projectData.slug);

      const fromProject = pId
        ? await supabase
            .from('wallet_templates')
            .select('defaults')
            .eq('project_id', pId)
            .maybeSingle()
        : { data: null };

      if (fromProject.data?.defaults) {
        setFormState(prev => ({
          ...prev,
          ...fromProject.data.defaults,
          colors: { ...prev.colors, ...fromProject.data.defaults.colors }
        }));
        toast({ title: "Template do projeto carregado!" });
        return;
      }

      const { data: globalData, error: globalError } = await supabase
        .from('wallet_templates')
        .select('defaults')
        .is('project_id', null)
        .single();
      if (globalError) throw globalError;

      if (globalData?.defaults) {
        setFormState(prev => ({
          ...prev,
          ...globalData.defaults,
          colors: { ...prev.colors, ...globalData.defaults.colors }
        }));
        toast({ title: "Template global carregado como fallback." });
      }
    } catch (error) {
      toast({ title: 'Erro ao carregar template', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  }, [toast]);

  const fetchPasses = useCallback(async (pId) => {
    if (!pId) { setPasses([]); return; }
    setLoadingPasses(true);
    try {
      const { data, error } = await supabase
        .from('v_passes')
        .select('*')
        .eq('project_id', pId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setPasses(data || []);
    } catch (error) {
      toast({ title: 'Erro ao buscar passes', description: error.message, variant: 'destructive' });
    } finally {
      setLoadingPasses(false);
    }
  }, [toast]);

  useEffect(() => {
    if (projectId) {
      loadWalletDefaults(projectId);
      fetchPasses(projectId);
    }
  }, [projectId, loadWalletDefaults, fetchPasses]);

  const handleFormChange = (path, value) => {
    setFormState(prev => {
      const keys = path.split('.');
      let tempState = JSON.parse(JSON.stringify(prev));
      let current = tempState;
      for (let i = 0; i < keys.length - 1; i++) {
        if (current[keys[i]] === undefined) current[keys[i]] = {};
        current = current[keys[i]];
      }
      current[keys[keys.length - 1]] = value;
      return tempState;
    });
  };

  const handleUploadClick = (key) => {
    setUploadingKey(key);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file || !uploadingKey) return;

    setIsProcessing(true);
    const path = `${projectId || 'temp'}/${uploadingKey}-${Date.now()}-${file.name}`;

    try {
      const { error: uploadError } = await supabase.storage
        .from('pass-assets')
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('pass-assets').getPublicUrl(path);
      handleFormChange(`images.${uploadingKey}`, data.publicUrl);
      toast({ title: "Upload com sucesso!" });
    } catch (error) {
      toast({ title: "Erro no upload", description: error.message, variant: "destructive" });
    } finally {
      setIsProcessing(false);
      setUploadingKey(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleGenerateLink = async () => {
    setIsProcessing(true);
    try {
      const body = {
        project_id: projectId,
        project_slug: projectSlug,
        type: formState.type,
        title: formState.title,
        description: formState.description,
        fields: Object.fromEntries(
          formState.dataFields.map(f => [f.key, formState.sampleValues?.[f.key] ?? ''])
        ),
        // ✅ ESSENCIAL: server monta qr_url (claim link) com domínio correto
        app_base_url: window.location.origin,
      };

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-teste`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(body)
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Falha na requisição: ${response.status}`);

      // opcional: guardar no formState só pro preview ficar alinhado
      setFormState(prev => ({ ...prev, qr_url: result.qr_url || prev.qr_url }));

      setGenerationResult(result);
      setIsModalOpen(true);
      fetchPasses(projectId);
    } catch (error) {
      toast({ title: 'Erro ao gerar link', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveDefaults = async () => {
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('wallet_templates')
        .upsert(
          { project_id: projectId, name: 'Template do Projeto', defaults: formState },
          { onConflict: 'project_id' }
        );
      if (error) throw error;
      toast({ title: "Template do projeto salvo com sucesso!" });
    } catch (error) {
      toast({ title: 'Erro ao salvar template', description: error.message, variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePassesListAction = (action, url) => {
    if (!url) { toast({ title: 'Link indisponível', variant: 'destructive' }); return; }
    if (action === 'copy') {
      navigator.clipboard.writeText(url);
      toast({ title: "Link copiado!" });
    } else {
      window.open(url, '_blank');
    }
  };

  return (
    <div className="p-4 md:p-6 lg:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Configuração da Wallet</h1>
        <Button onClick={onBack} variant="outline">Voltar aos Projetos</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <div className="space-y-4 p-4 border rounded-lg">
            <h2 className="font-semibold text-lg flex items-center gap-2">
              <Settings className="w-5 h-5 text-purple-500" />Design do Passe
            </h2>

            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <Label>Tipo</Label>
                  <Select value={formState.type} onValueChange={(v) => handleFormChange('type', v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="loyalty">Loyalty</SelectItem>
                      <SelectItem value="offer">Offer</SelectItem>
                      <SelectItem value="event">Event</SelectItem>
                      <SelectItem value="generic">Generic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Título</Label>
                  <Input value={formState.title} onChange={e => handleFormChange('title', e.target.value)} placeholder="Ex: Cartão Fidelidade" />
                </div>

                <div>
                  <Label>Descrição</Label>
                  <Textarea value={formState.description} onChange={e => handleFormChange('description', e.target.value)} placeholder="Ex: Complete 10 visitas e ganhe um café!" />
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  <ColorInput label="Fundo" value={formState.colors.background} onChange={e => handleFormChange('colors.background', e.target.value)} />
                  <ColorInput label="Rótulo" value={formState.colors.label} onChange={e => handleFormChange('colors.label', e.target.value)} />
                  <ColorInput label="Texto" value={formState.colors.text} onChange={e => handleFormChange('colors.text', e.target.value)} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => handleUploadClick('logo')}><Upload className="w-4 h-4 mr-2" /> Logo</Button>
                  <Button variant="outline" onClick={() => handleUploadClick('icon')}><Upload className="w-4 h-4 mr-2" /> Ícone</Button>
                  <Button variant="outline" onClick={() => handleUploadClick('googleHero')}><Upload className="w-4 h-4 mr-2" /> Google Hero</Button>
                  <Button variant="outline" onClick={() => handleUploadClick('appleStrip')}><Upload className="w-4 h-4 mr-2" /> Apple Strip</Button>
                </div>

                <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
              </div>
            </div>
          </div>

          <div className="flex justify-center items-center gap-4 py-6">
            <Button size="lg" onClick={handleSaveDefaults} disabled={isProcessing} variant="outline">
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {isProcessing ? 'Salvando...' : 'Salvar Alterações'}
            </Button>

            <Button size="lg" onClick={handleGenerateLink} disabled={isProcessing}>
              {isProcessing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LinkIcon className="mr-2 h-4 w-4" />}
              {isProcessing ? 'Gerando...' : 'Gerar Link Único'}
            </Button>
          </div>

          <div className="space-y-4">
            <h2 className="font-semibold text-lg">Passes Emitidos para este Projeto</h2>
            <PassesList passes={passes} loading={loadingPasses} onAction={handlePassesListAction} />
          </div>
        </div>

        <div className="lg:col-span-1">
          <PassPreview formState={formState} qrPreviewUrl={generationResult?.qr_url} />
        </div>
      </div>

      {/* ✅ IMPORTANTE: o modal deve mostrar result.qr_url como "Link Único" */}
      <GenerationResultModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} result={generationResult} />
    </div>
  );
};

export default WalletConfigTab;
