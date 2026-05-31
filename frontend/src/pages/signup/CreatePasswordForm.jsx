import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import PasswordInput from './PasswordInput';
import PasswordStrengthMeter from './PasswordStrengthMeter';

function CreatePasswordForm({
  errors,
  formData,
  onBack,
  onFieldChange,
  onFieldTouched,
  onSubmit,
  passwordState,
  shouldShowError,
  showPassword,
  showPasswordConfirmation,
  signupError,
  signupLoading,
  togglePasswordConfirmationVisibility,
  togglePasswordVisibility,
}) {
  return (
    <motion.form
      key="create-password"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      onSubmit={onSubmit}
      className="space-y-5"
      noValidate
    >
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
        <CheckCircle2 className="w-9 h-9 text-emerald-600 mb-3" />
        <h2 className="text-2xl font-bold text-emerald-950">E-mail liberado</h2>
        <p className="text-emerald-800 mt-2">
          Agora crie a senha que você usará para entrar no painel do estabelecimento.
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="password">Senha</Label>
        <PasswordInput
          id="password"
          value={formData.password}
          visible={showPassword}
          onChange={(event) => onFieldChange('password', event.target.value)}
          onBlur={() => onFieldTouched('password')}
          onToggleVisibility={togglePasswordVisibility}
          placeholder="Crie uma senha forte"
          ariaInvalid={shouldShowError('password')}
        />
        {shouldShowError('password') && (
          <p className="text-sm text-rose-600">{errors.password}</p>
        )}

        <Label htmlFor="password-confirmation">Confirmação de senha</Label>
        <PasswordInput
          id="password-confirmation"
          value={formData.passwordConfirmation}
          visible={showPasswordConfirmation}
          onChange={(event) => onFieldChange('passwordConfirmation', event.target.value)}
          onBlur={() => onFieldTouched('passwordConfirmation')}
          onToggleVisibility={togglePasswordConfirmationVisibility}
          placeholder="Digite a senha novamente"
          ariaInvalid={shouldShowError('passwordConfirmation')}
          showLabel="Mostrar confirmação de senha"
          hideLabel="Ocultar confirmação de senha"
        />
        {shouldShowError('passwordConfirmation') && (
          <p className="text-sm text-rose-600">{errors.passwordConfirmation}</p>
        )}

        <PasswordStrengthMeter passwordState={passwordState} />
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="h-12 sm:w-40"
        >
          Voltar
        </Button>
        <Button
          type="submit"
          className="h-12 flex-1 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
          disabled={signupLoading}
        >
          {signupLoading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              Criando conta...
            </span>
          ) : 'Criar conta'}
        </Button>
      </div>
      {signupError && (
        <p className="text-sm text-rose-600 text-center">{signupError}</p>
      )}
    </motion.form>
  );
}

export default CreatePasswordForm;
