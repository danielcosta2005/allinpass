
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { getPassDetailsBySlug } from '@/lib/api';
import { Loader2, AlertTriangle, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import AddToWalletButton from '@/components/AddToWalletButton';

const PassPage = () => {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [passData, setPassData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!slug) {
      setError('Identificador do passe não encontrado.');
      setLoading(false);
      return;
    }

    const fetchPass = async () => {
      try {
        const data = await getPassDetailsBySlug(slug);
        if (!data) {
          throw new Error('Passe não encontrado ou inválido.');
        }
        setPassData(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchPass();
  }, [slug]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <Loader2 className="h-12 w-12 animate-spin text-purple-600" />
      </div>
    );
  }

  if (error || !passData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 text-red-700 p-4 text-center">
        <AlertTriangle className="h-12 w-12 mb-4" />
        <h1 className="text-2xl font-bold mb-2">Ocorreu um Erro</h1>
        <p className="mb-6">{error || 'Não foi possível carregar os dados do passe.'}</p>
        <Button onClick={() => navigate('/')}>
            <ArrowLeft className="mr-2 h-4 w-4"/> Voltar ao Início
        </Button>
      </div>
    );
  }

  const { title, description, apple_pass_base64, google_jwt } = passData;

  return (
    <>
      <Helmet>
        <title>{title || 'Seu Passe Digital'}</title>
        <meta name="description" content={description || 'Adicione seu passe à sua carteira digital.'} />
      </Helmet>
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex flex-col items-center justify-center p-4">
        <div className="text-center mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800 dark:text-white mb-2">{title || 'Seu Passe Digital'}</h1>
            <p className="text-gray-600 dark:text-gray-400 max-w-md">{description || 'Adicione à sua carteira digital preferida para acesso rápido e fácil.'}</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
            {apple_pass_base64 && (
                <AddToWalletButton
                    passType="apple"
                    pkPass={apple_pass_base64}
                    className="!w-full !flex-1"
                />
            )}
             {google_jwt && (
                <AddToWalletButton
                    passType="google"
                    jwt={google_jwt}
                    className="!w-full !flex-1"
                />
            )}
        </div>
        {!apple_pass_base64 && !google_jwt && (
            <p className="mt-4 text-amber-600 bg-amber-50 p-3 rounded-md border border-amber-200 text-sm">
                <AlertTriangle className="inline-block w-4 h-4 mr-2"/>
                Os links para a carteira ainda não foram gerados para este passe.
            </p>
        )}
      </div>
    </>
  );
};

export default PassPage;
