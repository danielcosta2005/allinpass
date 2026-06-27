import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CreditCard, Loader2, LogOut, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';

function getAccountInitials(label) {
  const text = String(label || '').trim();
  if (!text) return 'AP';

  const readableText = text.includes('@') ? text.split('@')[0] : text;
  const parts = readableText.replace(/[._-]+/g, ' ').split(/\s+/).filter(Boolean);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0].slice(0, 2);

  return initials.toUpperCase();
}

function AccountMenu({
  onOpenPlanChange,
  onSignOut,
  planChangeDisabled = false,
  profileLabel,
  profileMeta,
  showPlanChangeOption = false,
  signingOut = false,
  userEmail,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const displayLabel = profileLabel || userEmail || 'Conta';
  const initials = useMemo(() => getAccountInitials(displayLabel), [displayLabel]);

  useEffect(() => {
    if (!isOpen) return undefined;

    function handlePointerDown(event) {
      if (menuRef.current?.contains(event.target)) return;
      setIsOpen(false);
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') setIsOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handlePlanChangeClick = () => {
    if (planChangeDisabled || !onOpenPlanChange) return;
    setIsOpen(false);
    onOpenPlanChange();
  };

  const handleSignOutClick = () => {
    if (signingOut || !onSignOut) return;
    setIsOpen(false);
    onSignOut();
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Abrir menu da conta"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={signingOut}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[#72577c] text-sm font-semibold text-white shadow-sm transition hover:bg-[#654d6f] focus:outline-none focus:ring-4 focus:ring-[#72577c]/25 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : initials}
      </button>

      {isOpen ? (
        <div
          role="menu"
          aria-label="Menu da conta"
          className="absolute right-0 z-50 mt-3 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white text-left text-slate-900 shadow-xl shadow-slate-950/10"
        >
          <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#72577c] text-sm font-semibold text-white">
              {initials}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{displayLabel}</p>
              {profileMeta ? <p className="truncate text-xs text-slate-500">{profileMeta}</p> : null}
            </div>
          </div>

          <div className="p-2">
            {showPlanChangeOption ? (
              <button
                type="button"
                role="menuitem"
                disabled={planChangeDisabled}
                onClick={handlePlanChangeClick}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-purple-50 hover:text-purple-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent"
              >
                <CreditCard className="h-4 w-4" />
                <span>Mudar de plano</span>
              </button>
            ) : null}

            <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2">
              <span className="text-sm font-medium text-slate-700">Tema</span>
              <button
                type="button"
                disabled
                aria-label="Tema visual indisponivel"
                className="flex h-8 w-[4.75rem] cursor-default items-center rounded-full border border-slate-200 bg-slate-100 p-1 opacity-90"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white text-amber-500 shadow-sm">
                  <Sun className="h-4 w-4" />
                </span>
                <span className="ml-auto flex h-6 w-6 items-center justify-center rounded-full text-slate-500">
                  <Moon className="h-4 w-4" />
                </span>
              </button>
            </div>

            <button
              type="button"
              role="menuitem"
              disabled={signingOut}
              onClick={handleSignOutClick}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-rose-50 hover:text-rose-700 disabled:cursor-not-allowed disabled:text-slate-400 disabled:hover:bg-transparent',
                signingOut && 'text-slate-400'
              )}
            >
              {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
              <span>Sair</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AccountMenu;
