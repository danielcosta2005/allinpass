import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

import PasswordInput from './PasswordInput';
import PasswordStrengthMeter from './PasswordStrengthMeter';

function SetPasswordForm({
  onPasswordConfirmationChange,
  onPasswordConfirmationTouched,
  onPasswordChange,
  onPasswordTouched,
  onSubmit,
  passwordSetupConfirmationError,
  passwordSetupConfirmationValue,
  passwordSetupError,
  passwordSetupLoading,
  passwordSetupState,
  passwordSetupValue,
  showPasswordSetupConfirmation,
  showPasswordSetup,
  togglePasswordSetupConfirmationVisibility,
  togglePasswordSetupVisibility,
}) {
  return (
    <motion.form
      key="set-password"
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
        <h2 className="text-2xl font-bold text-emerald-950">E-mail confirmado</h2>
        <p className="text-emerald-800 mt-2">
          Agora crie a senha que você usará para entrar no painel do estabelecimento.
        </p>
      </div>

      <div className="space-y-3">
        <Label htmlFor="password-setup">Senha</Label>
        <PasswordInput
          id="password-setup"
          value={passwordSetupValue}
          visible={showPasswordSetup}
          onChange={(event) => onPasswordChange(event.target.value)}
          onBlur={onPasswordTouched}
          onToggleVisibility={togglePasswordSetupVisibility}
          placeholder="Crie uma senha forte"
          ariaInvalid={Boolean(passwordSetupError)}
        />
        {passwordSetupError && (
          <p className="text-sm text-rose-600">{passwordSetupError}</p>
        )}

        <Label htmlFor="password-setup-confirmation">Confirmação de senha</Label>
        <PasswordInput
          id="password-setup-confirmation"
          value={passwordSetupConfirmationValue}
          visible={showPasswordSetupConfirmation}
          onChange={(event) => onPasswordConfirmationChange(event.target.value)}
          onBlur={onPasswordConfirmationTouched}
          onToggleVisibility={togglePasswordSetupConfirmationVisibility}
          placeholder="Digite a senha novamente"
          ariaInvalid={Boolean(passwordSetupConfirmationError)}
          showLabel="Mostrar confirmação de senha"
          hideLabel="Ocultar confirmação de senha"
        />
        {passwordSetupConfirmationError && (
          <p className="text-sm text-rose-600">{passwordSetupConfirmationError}</p>
        )}

        <PasswordStrengthMeter passwordState={passwordSetupState} />
      </div>

      <Button
        type="submit"
        disabled={passwordSetupLoading}
        className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
      >
        {passwordSetupLoading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Criando senha...
          </span>
        ) : 'Criar senha e continuar'}
      </Button>
    </motion.form>
  );
}

export default SetPasswordForm;
