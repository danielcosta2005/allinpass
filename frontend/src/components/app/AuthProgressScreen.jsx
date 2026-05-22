import React from 'react';
import { Loader2 } from 'lucide-react';

function AuthProgressScreen({
  title = 'Confirmando seu e-mail',
  description = 'Estamos validando sua sessão e finalizando seu cadastro.',
}) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-4">
      <div className="text-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto mb-6" />
        <h1 className="text-2xl font-semibold text-gray-700">{title}</h1>
        <p className="text-gray-500 mt-2">{description}</p>
      </div>
    </div>
  );
}

export default AuthProgressScreen;
