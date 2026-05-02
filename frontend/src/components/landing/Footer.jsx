import React from 'react';
import { Wallet, Instagram, Linkedin, Twitter, Facebook } from 'lucide-react';

const FOOTER_LINKS = [
  {
    title: 'Produto',
    links: [
      { label: 'Recursos', href: '#recursos' },
      { label: 'Planos', href: '#planos' },
      { label: 'Integrações', href: '#' },
      { label: 'Atualizações', href: '#' },
    ],
  },
  {
    title: 'Empresa',
    links: [
      { label: 'Sobre nós', href: '#' },
      { label: 'Carreiras', href: '#' },
      { label: 'Imprensa', href: '#' },
      { label: 'Parceiros', href: '#' },
    ],
  },
  {
    title: 'Suporte',
    links: [
      { label: 'Central de ajuda', href: '#' },
      { label: 'Contato', href: '#contato' },
      { label: 'Status', href: '#' },
      { label: 'Privacidade', href: '#' },
    ],
  },
];

const SOCIAL_LINKS = [
  { icon: Instagram, href: '#', label: 'Instagram' },
  { icon: Linkedin, href: '#', label: 'LinkedIn' },
  { icon: Twitter, href: '#', label: 'Twitter' },
  { icon: Facebook, href: '#', label: 'Facebook' },
];

const handlePlaceholderClick = (e) => {
  // Placeholder links until real destinations exist; prevent the default jump-to-top.
  if (e.currentTarget.getAttribute('href') === '#') {
    e.preventDefault();
  }
};

const Footer = () => {
  return (
    <footer className="bg-white border-t border-purple-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 md:gap-8">
          <div className="col-span-2">
            <a href="#topo" className="inline-flex items-center gap-2 group">
              <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl shadow-md group-hover:shadow-lg transition-shadow">
                <Wallet className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
                Allin Pass
              </span>
            </a>
            <p className="mt-4 text-sm text-gray-600 max-w-xs leading-relaxed">
              Comunicação multicanal, sustentável e inteligente. Transforme QR Codes em canais diretos com seu público.
            </p>
            <div className="mt-6 flex items-center gap-3">
              {SOCIAL_LINKS.map(({ icon: Icon, href, label }) => (
                <a
                  key={label}
                  href={href}
                  onClick={handlePlaceholderClick}
                  aria-label={label}
                  className="w-9 h-9 rounded-full flex items-center justify-center bg-purple-50 text-purple-700 hover:bg-purple-600 hover:text-white transition-colors"
                >
                  <Icon className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          {FOOTER_LINKS.map((column) => (
            <div key={column.title}>
              <h4 className="text-sm font-semibold text-gray-900 mb-4 uppercase tracking-wider">{column.title}</h4>
              <ul className="space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <a
                      href={link.href}
                      onClick={handlePlaceholderClick}
                      className="text-sm text-gray-600 hover:text-purple-700 transition-colors"
                    >
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-purple-100 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500">
            © 2026 Allin Pass. Todos os direitos reservados.
          </p>
          <div className="flex items-center gap-6 text-sm text-gray-500">
            <a href="#" onClick={handlePlaceholderClick} className="hover:text-purple-700 transition-colors">Termos</a>
            <a href="#" onClick={handlePlaceholderClick} className="hover:text-purple-700 transition-colors">Privacidade</a>
            <a href="#" onClick={handlePlaceholderClick} className="hover:text-purple-700 transition-colors">Cookies</a>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
