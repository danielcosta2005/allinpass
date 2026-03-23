import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlusCircle, Trash2, Save } from 'lucide-react';

const FormEditorModal = ({ isOpen, setIsOpen, schema, onSave }) => {
    const [localSchema, setLocalSchema] = useState([]);
    
    useEffect(() => { 
        setLocalSchema(Array.isArray(schema) ? schema : []); 
    }, [schema, isOpen]);
    
    const updateField = (index, prop, value) => {
        const newSchema = [...localSchema];
        newSchema[index][prop] = value;
        setLocalSchema(newSchema);
    };
    
    const addField = () => setLocalSchema([...localSchema, {key: `custom${localSchema.length}`, label: '', type: 'text', required: false}]);
    const removeField = (index) => setLocalSchema(localSchema.filter((_, i) => i !== index));

    const handleSave = () => { onSave(localSchema); setIsOpen(false); };

    return (
         <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogContent className="max-w-2xl">
                <DialogHeader><DialogTitle>Editor de Formulário</DialogTitle><DialogDescription>Crie campos customizados para o cadastro do cliente.</DialogDescription></DialogHeader>
                <div className="space-y-4 max-h-[60vh] overflow-y-auto p-1">
                    {localSchema.map((field, index) => (
                        <div key={index} className="grid grid-cols-12 gap-2 items-center p-2 border rounded-md">
                            <Input placeholder="Field Key" value={field.key} onChange={e => updateField(index, 'key', e.target.value)} className="col-span-3"/>
                            <Input placeholder="Label" value={field.label} onChange={e => updateField(index, 'label', e.target.value)} className="col-span-4"/>
                            <Select value={field.type} onValueChange={v => updateField(index, 'type', v)}>
                                <SelectTrigger className="col-span-3"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="text">Texto</SelectItem>
                                    <SelectItem value="number">Número</SelectItem>
                                    <SelectItem value="date">Data</SelectItem>
                                </SelectContent>
                            </Select>
                            <label className="col-span-1 flex items-center justify-center gap-1 text-xs"><input type="checkbox" checked={field.required} onChange={e => updateField(index, 'required', e.target.checked)}/> Req.</label>
                            <Button size="icon" variant="ghost" onClick={() => removeField(index)} className="col-span-1 text-red-500"><Trash2 className="w-4 h-4"/></Button>
                        </div>
                    ))}
                </div>
                 <DialogFooter className="items-center justify-between w-full">
                    <Button variant="outline" onClick={addField}><PlusCircle className="mr-2 h-4 w-4"/>Adicionar</Button>
                    <Button onClick={handleSave}><Save className="mr-2 h-4 w-4"/>Salvar Formulário</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export default FormEditorModal;