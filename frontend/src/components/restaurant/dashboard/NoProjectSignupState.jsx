import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';

function NoProjectSignupState() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-md border-l-4 border-yellow-500 bg-yellow-100 p-4 text-center text-yellow-700 shadow-lg"
    >
      <AlertCircle className="mx-auto mb-3 h-7 w-7" />
      <p className="font-bold">Atencao</p>
      <p>Seu usuario nao esta associado a nenhum projeto ativo. Fale com um administrador.</p>
    </motion.div>
  );
}

export default NoProjectSignupState;
