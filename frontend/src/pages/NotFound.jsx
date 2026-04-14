import React from 'react';
import { Helmet } from 'react-helmet';
import { Frown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';

const NotFound = () => {
  return (
    <>
      <Helmet>
        <title>404: Página não encontrada</title>
      </Helmet>
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-purple-50 via-white to-indigo-50 text-center p-4">
        <Frown className="h-24 w-24 text-primary mb-6" />
        <h1 className="text-6xl font-extrabold text-primary">404</h1>
        <h2 className="text-2xl font-semibold text-gray-800 mt-4 mb-2">Página não encontrada</h2>
        <p className="text-gray-600 max-w-sm mb-8">
          A página que você está procurando não existe ou foi movida.
        </p>
        <Button asChild>
          <Link to="/">Voltar para a página inicial</Link>
        </Button>
      </div>
    </>
  );
};

export default NotFound;