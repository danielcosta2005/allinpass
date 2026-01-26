import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Helmet } from 'react-helmet';

export default function Unauthorized() {
  return (
    <>
      <Helmet>
        <title>Acesso Negado - Carteira 4.9</title>
        <meta name="description" content="Página de acesso não autorizado." />
      </Helmet>
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-red-50 via-white to-red-100 text-center p-4">
        <ShieldAlert className="h-16 w-16 text-red-500 mb-6" />
        <h1 className="text-3xl font-bold text-gray-800 mb-2">Acesso Não Autorizado</h1>
        <p className="text-lg text-gray-600 max-w-md">
          Você não tem permissão para acessar este recurso. Por favor, entre em contato com o estabelecimento para se cadastrar no programa de fidelidade.
        </p>
      </div>
    </>
  );
}