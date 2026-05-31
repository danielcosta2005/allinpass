import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

function PrivacyPolicyModal({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">Política de Privacidade</DialogTitle>
          <DialogDescription>
            Como tratamos seus dados nesta página
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-900">
            <strong>Texto preliminar.</strong> Esta versão está pendente de revisão
            jurídica. Em caso de divergência com a versão final, prevalecerá a versão
            revisada publicada.
          </p>
        </div>

        <div className="space-y-5 text-sm text-gray-700 leading-relaxed">
          <section>
            <h3 className="font-semibold text-gray-900 mb-1">1. Quem somos</h3>
            <p>
              A Allin Pass é uma plataforma de fidelidade digital. Esta página
              ("landing page") apresenta nossos planos e recursos e usa tecnologias
              de mensuração de campanhas descritas abaixo.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">2. Dados coletados</h3>
            <p className="mb-2">
              Ao aceitar cookies, esta página ativa o <strong>Meta Pixel</strong>
              (tecnologia da Meta Platforms, Inc.), que coleta:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>endereço IP, user-agent e identificador de navegador;</li>
              <li>
                ações na página (cliques em CTAs, profundidade de rolagem, abertura
                de perguntas frequentes, visualização da seção de planos);
              </li>
              <li>
                cookie <code className="text-xs bg-gray-100 px-1 rounded">_fbp</code>{' '}
                gerado pela Meta, que correlaciona sua navegação com sua conta no
                Facebook/Instagram (se houver).
              </li>
            </ul>
            <p className="mt-2">
              Nenhum dado pessoal direto (nome, e-mail, telefone) é coletado por esta
              página antes do cadastro.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">3. Finalidade</h3>
            <p>
              Mensurar a eficácia de campanhas de marketing, entender o
              comportamento de visitantes na página e otimizar nossos anúncios na
              Meta. Não vendemos seus dados a terceiros.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">4. Base legal</h3>
            <p>
              O tratamento ocorre com base no seu <strong>consentimento</strong>{' '}
              livre, informado e inequívoco (LGPD, Art. 7º, I), manifestado pelo
              clique em "Aceitar" no banner de cookies. Você pode revogar o
              consentimento a qualquer momento pelo link "Cookies" no rodapé desta
              página — a revogação não afeta dados já coletados antes da retirada.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">5. Compartilhamento</h3>
            <p>
              Os dados coletados pelo Meta Pixel são processados pela Meta Platforms
              segundo a{' '}
              <a
                href="https://www.facebook.com/privacy/policy/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-700 underline"
              >
                Política de Privacidade da Meta
              </a>
              . Não compartilhamos dados com outros operadores nesta página.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">
              6. Seus direitos (LGPD)
            </h3>
            <p className="mb-2">Você tem direito a, a qualquer tempo:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>confirmação da existência de tratamento;</li>
              <li>acesso aos seus dados;</li>
              <li>correção de dados incompletos, inexatos ou desatualizados;</li>
              <li>anonimização, bloqueio ou eliminação de dados desnecessários;</li>
              <li>portabilidade dos dados;</li>
              <li>eliminação dos dados tratados com base no consentimento;</li>
              <li>revogação do consentimento;</li>
              <li>oposição a tratamento em desacordo com a LGPD.</li>
            </ul>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">7. Contato</h3>
            <p>
              Para exercer qualquer um dos direitos acima ou tirar dúvidas, escreva
              para{' '}
              <a
                href="mailto:privacidade@allinpass.com.br"
                className="text-purple-700 underline"
              >
                privacidade@allinpass.com.br
              </a>{' '}
              <span className="text-gray-500">[endereço a confirmar]</span>.
            </p>
          </section>

          <section>
            <h3 className="font-semibold text-gray-900 mb-1">8. Atualizações</h3>
            <p>
              Esta política pode ser atualizada. A data da última revisão será
              indicada aqui na versão final.
            </p>
          </section>
        </div>

        <DialogFooter>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default PrivacyPolicyModal;
