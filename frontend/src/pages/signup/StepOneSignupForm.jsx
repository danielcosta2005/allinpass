import React from 'react';
import { motion } from 'framer-motion';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import TurnstileWidget from './TurnstileWidget';

function StepOneSignupForm({
  captchaToken,
  errors,
  formData,
  onCaptchaTokenChange,
  onFieldChange,
  onFieldTouched,
  onSubmit,
  onTurnstileResetReady,
  paidPlan,
  shouldShowError,
  signupCaptchaEnabled,
  signupError,
  signupLoading,
  turnstileSiteKey,
}) {
  return (
    <motion.form
      key="step-1"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2 }}
      onSubmit={onSubmit}
      className="space-y-5"
      noValidate
    >
      <div className="space-y-2">
        <Label htmlFor="establishment-name">Nome do estabelecimento</Label>
        <Input
          id="establishment-name"
          type="text"
          className="h-12"
          value={formData.establishmentName}
          onChange={(event) => onFieldChange('establishmentName', event.target.value)}
          onBlur={() => onFieldTouched('establishmentName')}
          placeholder="Ex.: Padaria Bom Dia"
          aria-invalid={shouldShowError('establishmentName')}
        />
        {shouldShowError('establishmentName') && (
          <p className="text-sm text-rose-600">{errors.establishmentName}</p>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            className="h-12"
            value={formData.email}
            onChange={(event) => onFieldChange('email', event.target.value)}
            onBlur={() => onFieldTouched('email')}
            placeholder="contato@empresa.com"
            aria-invalid={shouldShowError('email')}
          />
          {shouldShowError('email') && (
            <p className="text-sm text-rose-600">{errors.email}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="email-confirmation">Confirmação de e-mail</Label>
          <Input
            id="email-confirmation"
            type="email"
            className="h-12"
            value={formData.emailConfirmation}
            onChange={(event) => onFieldChange('emailConfirmation', event.target.value)}
            onBlur={() => onFieldTouched('emailConfirmation')}
            placeholder="repita seu e-mail"
            aria-invalid={shouldShowError('emailConfirmation')}
          />
          {shouldShowError('emailConfirmation') && (
            <p className="text-sm text-rose-600">{errors.emailConfirmation}</p>
          )}
        </div>
      </div>

      {signupCaptchaEnabled && (
        <TurnstileWidget
          siteKey={turnstileSiteKey}
          onTokenChange={onCaptchaTokenChange}
          onResetReady={onTurnstileResetReady}
        />
      )}

      <Button
        type="submit"
        className="w-full h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white"
        disabled={signupLoading || (signupCaptchaEnabled && !captchaToken)}
      >
        {signupLoading ? (
          <span className="inline-flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Iniciando...
          </span>
        ) : paidPlan ? 'Continuar para senha' : 'Continuar'}
      </Button>
      {signupError && (
        <p className="text-sm text-rose-600 text-center">{signupError}</p>
      )}
    </motion.form>
  );
}

export default StepOneSignupForm;
