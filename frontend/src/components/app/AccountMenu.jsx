import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { CreditCard, Loader2, LogOut, Moon, Receipt, Sun } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
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
  billingOptionDisabled = false,
  menuPlacement = 'bottom-right',
  onOpenBilling,
  onOpenPlanChange,
  onSignOut,
  planChangeDisabled = false,
  profileLabel,
  profileMeta,
  projectName,
  showBillingOption = false,
  showPlanChangeOption = false,
  signingOut = false,
  userEmail,
}) {
  const { isDarkTheme, toggleTheme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);
  const displayLabel = profileLabel || userEmail || 'Conta';
  const initials = useMemo(() => getAccountInitials(displayLabel), [displayLabel]);
  const menuPositionClasses = {
    'top-left': 'bottom-full -left-2 mb-3',
    'top-right': 'bottom-full right-0 mb-3',
    'bottom-left': 'left-0 mt-3',
    'bottom-right': 'right-0 mt-3',
  };
  const menuPositionClass = menuPositionClasses[menuPlacement] || menuPositionClasses['bottom-right'];

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

  const handleBillingClick = () => {
    if (billingOptionDisabled || !onOpenBilling) return;
    setIsOpen(false);
    onOpenBilling();
  };

  const handleSignOutClick = () => {
    if (signingOut || !onSignOut) return;
    setIsOpen(false);
    onSignOut();
  };

  const menuItemClassName = 'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent';

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Abrir menu da conta"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={signingOut}
        onClick={() => setIsOpen((current) => !current)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground shadow-sm shadow-primary/20 transition hover:bg-primary/90 focus:outline-none focus:ring-4 focus:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : initials}
      </button>

      <AnimatePresence>
        {isOpen ? (
          <motion.div
            role="menu"
            aria-label="Menu da conta"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className={cn(
              'absolute z-50 w-72 overflow-hidden rounded-lg border border-border bg-popover text-left text-popover-foreground shadow-xl shadow-slate-950/10 dark:shadow-black/40',
              menuPositionClass
            )}
          >
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-popover-foreground">{displayLabel}</p>
                {profileMeta ? <p className="truncate text-xs text-muted-foreground">{profileMeta}</p> : null}
              </div>
            </div>

            <div className="p-2">
              {projectName ? (
                <div className="mb-2 rounded-md bg-muted px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Projeto</p>
                  <p className="mt-0.5 truncate text-sm font-semibold text-foreground">{projectName}</p>
                </div>
              ) : null}

              {showPlanChangeOption ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={planChangeDisabled}
                  onClick={handlePlanChangeClick}
                  className={menuItemClassName}
                >
                  <CreditCard className="h-4 w-4" />
                  <span>Mudar de plano</span>
                </button>
              ) : null}

              {showBillingOption ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={billingOptionDisabled}
                  onClick={handleBillingClick}
                  className={menuItemClassName}
                >
                  <Receipt className="h-4 w-4" />
                  <span>Faturamento</span>
                </button>
              ) : null}

              <div className="flex items-center justify-between gap-3 rounded-md px-3 py-2">
                <span className="text-sm font-medium text-muted-foreground">Tema</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={isDarkTheme}
                  aria-label={`Alternar para tema ${isDarkTheme ? 'claro' : 'escuro'}`}
                  title={`Alternar para tema ${isDarkTheme ? 'claro' : 'escuro'}`}
                  onClick={toggleTheme}
                  className={cn(
                    'relative flex h-8 w-[4.75rem] items-center rounded-full border border-border bg-muted p-1 text-muted-foreground transition focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-popover',
                    isDarkTheme && 'border-primary/40 bg-primary/15 text-primary'
                  )}
                >
                  <span className="absolute left-2 flex h-4 w-4 items-center justify-center text-amber-500">
                    <Sun className="h-3.5 w-3.5" />
                  </span>
                  <span className="absolute right-2 flex h-4 w-4 items-center justify-center text-indigo-300">
                    <Moon className="h-3.5 w-3.5" />
                  </span>
                  <span
                    className={cn(
                      'relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-background text-amber-500 shadow-sm transition-transform duration-200',
                      isDarkTheme && 'translate-x-10 bg-primary text-primary-foreground shadow-primary/30'
                    )}
                  >
                    {isDarkTheme ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                  </span>
                </button>
              </div>

              <button
                type="button"
                role="menuitem"
                disabled={signingOut}
                onClick={handleSignOutClick}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:text-muted-foreground/50 disabled:hover:bg-transparent',
                  signingOut && 'text-muted-foreground/50'
                )}
              >
                {signingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
                <span>Sair</span>
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export default AccountMenu;
