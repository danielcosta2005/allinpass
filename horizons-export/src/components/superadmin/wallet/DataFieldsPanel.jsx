
import React, { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Lock, Mail } from 'lucide-react';

const DataFieldsPanel = ({ project, testValues, setTestValues }) => {
    const [fields, setFields] = useState([]);

    useEffect(() => {
        const baseFields = project.field_mapping?.fields || [];
        let hasEmail = baseFields.some(f => f.key === 'email');
        const finalFields = hasEmail ? baseFields : [{ key: 'email', label: 'Email', type: 'PII' }, ...baseFields];
        setFields(finalFields);

        const initialTestValues = {};
        finalFields.forEach(field => {
            initialTestValues[field.key] = testValues[field.key] || field.defaultValue || '';
        });
        if (!initialTestValues.email) {
             initialTestValues.email = 'teste@exemplo.com';
        }

        setTestValues(initialTestValues);
    }, [project.field_mapping]);
    
    const handleTestValueChange = (key, value) => {
        setTestValues(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="space-y-8 p-4">
             <div>
                <h4 className="font-semibold text-xl mb-2">Estrutura de Campos do Template</h4>
                <p className="text-sm text-muted-foreground mb-4">Estes são os campos definidos no seu template. Para alterá-los, edite o template no banco de dados.</p>
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 p-4 space-y-2">
                    {fields.map((field) => (
                        <div key={field.key} className="flex items-center justify-between p-2 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
                           <div>
                             <span className="font-mono text-sm bg-purple-100 text-purple-800 px-2 py-1 rounded">{field.key}</span>
                             <span className="ml-4 text-gray-700 dark:text-gray-300">{field.label}</span>
                           </div>
                           {field.key === 'email' && <Lock className="w-4 h-4 text-gray-400" title="Este campo é obrigatório e não pode ser removido." />}
                        </div>
                    ))}
                </div>
            </div>

            <div>
                <h4 className="font-semibold text-xl mb-2">Valores para Teste</h4>
                <p className="text-sm text-muted-foreground mb-4">Preencha com dados de exemplo para visualizar no preview e gerar um passe de demonstração.</p>
                <div className="space-y-4 max-w-lg">
                    {fields.map((field) => (
                        <div key={field.key} className="grid grid-cols-3 gap-4 items-center">
                            <Label htmlFor={`test-${field.key}`} className="text-right truncate">
                                {field.label}
                                {field.key === 'email' && <span className="text-red-500 ml-1">*</span>}
                            </Label>
                            <div className="col-span-2 relative">
                                <Input
                                    id={`test-${field.key}`}
                                    value={testValues[field.key] || ''}
                                    onChange={(e) => handleTestValueChange(field.key, e.target.value)}
                                    placeholder={`Ex: ${field.label === 'Pontos' ? '123' : 'Valor de exemplo'}`}
                                    className="pl-8"
                                />
                                {field.key === 'email' && <Mail className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default DataFieldsPanel;
