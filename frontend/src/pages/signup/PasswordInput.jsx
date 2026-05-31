import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function PasswordInput({
  id,
  value,
  visible,
  onChange,
  onBlur,
  onToggleVisibility,
  placeholder,
  ariaInvalid,
  showLabel = 'Mostrar senha',
  hideLabel = 'Ocultar senha',
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        className="h-12 pr-12"
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="new-password"
        aria-invalid={ariaInvalid}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-1 top-1 h-10 w-10 text-slate-500 hover:text-slate-800"
        onClick={onToggleVisibility}
        aria-label={visible ? hideLabel : showLabel}
      >
        {visible ? (
          <Eye className="h-4 w-4" aria-hidden="true" />
        ) : (
          <EyeOff className="h-4 w-4" aria-hidden="true" />
        )}
      </Button>
    </div>
  );
}

export default PasswordInput;
