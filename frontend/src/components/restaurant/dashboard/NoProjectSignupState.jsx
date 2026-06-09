import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

function NoProjectSignupState({
  onRefreshStatus,
  statusError,
  statusLoading,
}) {
  if (statusLoading) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-lg"
      >
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-purple-600" />
        <p className="mt-3 font-semibold text-slate-900">Verificando sua conta...</p>
        <p className="mt-1 text-sm text-slate-600">Estamos conferindo se existe um projeto liberado para seu acesso.</p>
      </motion.div>
    );
  }

  if (statusError) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-red-900 shadow-lg"
      >
        <AlertCircle className="mx-auto h-8 w-8" />
        <p className="mt-3 font-bold">Nao foi possivel verificar sua assinatura</p>
        <p className="mt-1 text-sm">{statusError}</p>
        <Button
          type="button"
          variant="outline"
          onClick={onRefreshStatus}
          className="mt-5 border-red-200 bg-white text-red-700 hover:bg-red-100"
        >
          Tentar novamente
        </Button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 rounded-md shadow-lg"
    >
      <p className="font-bold">Atencao</p>
      <p>Seu usuario nao esta associado a nenhum projeto, fale com um administrador.</p>
    </motion.div>
  );
}

export default NoProjectSignupState;
