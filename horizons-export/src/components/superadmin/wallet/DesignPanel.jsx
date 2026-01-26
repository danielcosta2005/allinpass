
import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { FileImage as ImageIcon, Save, Loader2 } from 'lucide-react';

const ColorInput = ({ label, ...props }) => (
  <div className="flex flex-col space-y-2">
    <Label className="text-sm font-medium">{label}</Label>
    <div className="relative">
      <Input type="color" {...props} className="p-0 h-10 w-full appearance-none border-none bg-transparent cursor-pointer" />
      <div className="absolute inset-0 rounded-md border pointer-events-none flex items-center justify-end px-2" style={{ backgroundColor: props.value }}>
        <span className="font-mono text-xs mix-blend-difference text-white">{props.value}</span>
      </div>
    </div>
  </div>
);

const DesignPanel = ({ project, handleDeepChange, setEditingImageType, imageFileInputRef, onSave, isSaving }) => {
    const design = project.wallet_design || {};
    const colors = design.colors || {};
    const imageIds = design.imageIds || {};

    const triggerImageUpload = (type) => {
        setEditingImageType(type);
        imageFileInputRef.current?.click();
    };

    return (
        <div className="space-y-8 p-4">
            <div className="space-y-4">
                <h4 className="font-semibold text-xl">Informações do Passe</h4>
                <div className="space-y-2">
                    <Label htmlFor="orgName">Nome da Organização</Label>
                    <Input id="orgName" value={design.organizationName || ''} onChange={e => handleDeepChange('wallet_design.organizationName', e.target.value)} placeholder="Nome da sua empresa"/>
                </div>
                <div className="space-y-2">
                    <Label htmlFor="passDesc">Descrição do Passe</Label>
                    <Input id="passDesc" value={design.description || ''} onChange={e => handleDeepChange('wallet_design.description', e.target.value)} placeholder="Ex: Cartão de Fidelidade Premium"/>
                </div>
            </div>
            
             <div className="space-y-4">
                 <h4 className="font-semibold text-xl">Cores</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border p-4 rounded-lg bg-gray-50/50 dark:bg-gray-800/20">
                    <ColorInput label="Cor de Fundo" value={colors.backgroundColor || '#6c5ce7'} onChange={e => handleDeepChange('wallet_design.colors.backgroundColor', e.target.value)} />
                    <ColorInput label="Cor dos Rótulos" value={colors.labelColor || '#ffffff'} onChange={e => handleDeepChange('wallet_design.colors.labelColor', e.target.value)} />
                    <ColorInput label="Cor do Texto" value={colors.textColor || '#ffffff'} onChange={e => handleDeepChange('wallet_design.colors.textColor', e.target.value)} />
                </div>
            </div>
            
            <div className="space-y-4">
                <h4 className="font-semibold text-xl">Imagens</h4>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <ImageUploader label="Logo" imageUrl={imageIds.logo} onUpload={() => triggerImageUpload('logo')} />
                    <ImageUploader label="Ícone" imageUrl={imageIds.icon} onUpload={() => triggerImageUpload('icon')} />
                    <ImageUploader label="Google Hero" imageUrl={imageIds.hero} onUpload={() => triggerImageUpload('hero')} />
                    <ImageUploader label="Apple Strip" imageUrl={imageIds.strip} onUpload={() => triggerImageUpload('strip')} />
                </div>
            </div>

             <div className="flex justify-end pt-4">
                <Button onClick={onSave} disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Salvar Design
                </Button>
            </div>
        </div>
    );
};

const ImageUploader = ({ label, imageUrl, onUpload }) => (
    <div className="flex flex-col items-center justify-center space-y-2 p-4 border-2 border-dashed rounded-lg h-full">
        <div className="w-full h-16 bg-gray-100 dark:bg-gray-800 rounded-md flex items-center justify-center">
            {imageUrl ? (
                <img src={imageUrl} alt={`${label} preview`} className="max-h-full max-w-full object-contain p-1"/>
            ) : (
                <span className="text-xs text-muted-foreground">Sem imagem</span>
            )}
        </div>
        <Button variant="outline" size="sm" onClick={onUpload} className="w-full">
            <ImageIcon className="mr-2 h-4 w-4" /> {label}
        </Button>
    </div>
);


export default DesignPanel;
