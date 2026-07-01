import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Menu, PanelLeftClose, PanelLeftOpen, Wallet, X } from 'lucide-react';
import AccountMenu from '@/components/app/AccountMenu';
import { cn } from '@/lib/utils';

function DashboardNavItem({
  active,
  collapsed = false,
  disabled,
  expanded = false,
  hasChildren = false,
  icon: Icon,
  label,
  onClick,
}) {
  return (
    <button
      type="button"
      aria-label={collapsed ? label : undefined}
      aria-expanded={hasChildren ? expanded : undefined}
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-11 w-full items-center gap-3 overflow-hidden rounded-lg px-3 text-left text-sm font-medium transition',
        collapsed && 'justify-center px-2',
        'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background',
        active
          ? 'bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground'
      )}
    >
      {Icon ? <Icon className={cn('h-5 w-5 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} /> : null}
      <span className={cn('dashboard-shell-label min-w-0 flex-1 truncate', collapsed && 'sr-only')}>
        {label}
      </span>
      {hasChildren && !collapsed ? (
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
            expanded && 'rotate-180 text-primary'
          )}
        />
      ) : null}
    </button>
  );
}

function DashboardNavChildren({
  activeItem,
  activeSubItem,
  collapsed = false,
  disabled,
  items,
  onNavigate,
  parentValue,
}) {
  if (collapsed || !items?.length) return null;

  return (
    <div className="dashboard-nav-children ml-5 space-y-1 border-l border-border pl-3">
      {items.map((child) => {
        const childActive = activeItem === parentValue && activeSubItem === child.value;
        const ChildIcon = child.icon;
        const childDisabled = disabled || child.disabled;

        return (
          <button
            key={child.value}
            type="button"
            disabled={childDisabled}
            onClick={() => onNavigate(parentValue, childDisabled, child.value, true)}
            title={child.label}
            className={cn(
              'flex h-9 w-full items-center gap-2 overflow-hidden rounded-md px-3 text-left text-sm font-medium transition',
              'focus:outline-none focus-visible:bg-accent',
              childActive
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              childDisabled && 'cursor-not-allowed opacity-45 hover:bg-transparent hover:text-muted-foreground'
            )}
          >
            {ChildIcon ? (
              <ChildIcon className={cn('h-4 w-4 shrink-0', childActive ? 'text-primary' : 'text-muted-foreground')} />
            ) : null}
            <span className="min-w-0 flex-1 truncate">{child.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function DashboardSidebarContent({
  accountMenuProps,
  activeItem,
  activeSubItem,
  brandLabel,
  brandMeta,
  navGroups,
  onBrandClick,
  onCollapseSidebar,
  onExpandSidebar,
  onNavigate,
  onRequestClose,
  sidebarCollapsed = false,
  statusNotice,
}) {
  const [expandedNavItems, setExpandedNavItems] = useState([]);

  const toggleExpandedNavItem = (value) => {
    setExpandedNavItems((current) => (
      current.includes(value)
        ? current.filter((itemValue) => itemValue !== value)
        : [...current, value]
    ));
  };

  const handleNavigate = (value, disabled, subValue, closeAfterNavigate = true) => {
    if (disabled) return;
    onNavigate(value, subValue);
    setExpandedNavItems(subValue ? [value] : []);
    if (closeAfterNavigate) onRequestClose?.();
  };

  const handleParentNavigate = (value, disabled, hasChildren) => {
    if (disabled) return;

    if (hasChildren) {
      if (sidebarCollapsed) onExpandSidebar?.();
      toggleExpandedNavItem(value);
      return;
    }

    handleNavigate(value, disabled);
  };

  const handleBrandClick = () => {
    onBrandClick?.();
    onRequestClose?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card text-card-foreground">
      <div className={cn('border-b border-border py-4', sidebarCollapsed ? 'px-2' : 'px-5')}>
        <div className={cn('flex min-w-0 items-center gap-3', sidebarCollapsed && 'justify-center')}>
          {sidebarCollapsed ? (
            <button
              type="button"
              aria-label="Abrir barra lateral"
              title="Abrir barra lateral"
              onClick={onExpandSidebar}
              className="group/logo relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm shadow-purple-600/20 transition hover:bg-purple-700 hover:shadow-md hover:shadow-purple-600/25 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              <Wallet className="h-5 w-5 transition-opacity group-hover/logo:opacity-0 group-focus-visible/logo:opacity-0" />
              <PanelLeftOpen className="dashboard-shell-logo-open-icon absolute h-5 w-5 opacity-0 transition-opacity group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100" />
            </button>
          ) : (
            <>
              <button
                type="button"
                aria-label="Ir para inicio"
                onClick={handleBrandClick}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white shadow-sm shadow-purple-600/20 transition hover:bg-purple-700 hover:shadow-md hover:shadow-purple-600/25"
                title={brandLabel}
              >
                <Wallet className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold text-card-foreground">{brandLabel}</p>
                {brandMeta ? <p className="truncate text-xs font-medium text-muted-foreground">{brandMeta}</p> : null}
              </div>
              {onCollapseSidebar ? (
                <button
                  type="button"
                  aria-label="Fechar barra lateral"
                  title="Fechar barra lateral"
                  onClick={onCollapseSidebar}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <PanelLeftClose className="h-5 w-5" />
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <nav aria-label="Navegacao do dashboard" className="space-y-5">
          {navGroups.map((group) => {
            const visibleItems = (group.items || []).filter(Boolean);
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label || visibleItems.map((item) => item.value).join('-')} className="space-y-2">
                {group.label && !sidebarCollapsed ? (
                  <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {group.label}
                  </p>
                ) : null}
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const hasChildren = Boolean(item.children?.length);
                    const itemActive = activeItem === item.value;
                    const expanded = expandedNavItems.includes(item.value);

                    return (
                      <div key={item.value} className="space-y-1">
                        <DashboardNavItem
                          active={itemActive}
                          collapsed={sidebarCollapsed}
                          disabled={item.disabled}
                          expanded={expanded}
                          hasChildren={hasChildren}
                          icon={item.icon}
                          label={item.label}
                          onClick={() => handleParentNavigate(item.value, item.disabled, hasChildren)}
                        />
                        <AnimatePresence initial={false}>
                          {expanded ? (
                            <motion.div
                              key={`${item.value}-children`}
                              initial={{ height: 0, opacity: 0, y: -4 }}
                              animate={{ height: 'auto', opacity: 1, y: 0 }}
                              exit={{ height: 0, opacity: 0, y: -4 }}
                              transition={{ duration: 0.18, ease: 'easeOut' }}
                              className="overflow-hidden"
                            >
                              <DashboardNavChildren
                                activeItem={activeItem}
                                activeSubItem={activeSubItem}
                                collapsed={sidebarCollapsed}
                                disabled={item.disabled}
                                items={item.children}
                                onNavigate={handleNavigate}
                                parentValue={item.value}
                              />
                            </motion.div>
                          ) : null}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      {statusNotice && !sidebarCollapsed ? (
        <div className="border-t border-rose-500/20 bg-rose-500/10 px-5 py-3 text-xs leading-relaxed text-rose-700 dark:text-rose-200">
          <p>
            <span className="font-semibold">Assinatura suspensa.</span> {statusNotice}
          </p>
        </div>
      ) : null}

      <div id="dashboard-shell-account" className={cn('dashboard-shell-account border-t border-border py-4', sidebarCollapsed ? 'px-2' : 'px-4')}>
        <div className={cn('flex min-w-0 items-center gap-3 rounded-lg bg-muted py-3', sidebarCollapsed ? 'justify-center px-2' : 'px-3')}>
          <div className="dashboard-shell-account-avatar shrink-0">
            <AccountMenu {...accountMenuProps} menuPlacement="top-left" />
          </div>
          {!sidebarCollapsed ? (
            <div className="dashboard-shell-account-copy min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {accountMenuProps?.profileLabel || accountMenuProps?.userEmail || 'Conta'}
              </p>
              {accountMenuProps?.profileMeta ? (
                <p className="truncate text-xs font-medium text-muted-foreground">{accountMenuProps.profileMeta}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DashboardShell({
  accountMenuProps,
  activeItem,
  activeSubItem,
  brandLabel = 'Allin Pass',
  brandMeta,
  children,
  contentHeader,
  navGroups = [],
  onBrandClick,
  onNavigate,
  statusNotice,
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const hasContentHeader = Boolean(contentHeader);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <aside
        className={cn(
          'hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:flex lg:flex-col lg:border-r lg:border-border lg:bg-card lg:shadow-sm lg:transition-all lg:duration-200',
          sidebarCollapsed ? 'lg:w-16' : 'lg:w-72'
        )}
      >
        <DashboardSidebarContent
          accountMenuProps={accountMenuProps}
          activeItem={activeItem}
          activeSubItem={activeSubItem}
          brandLabel={brandLabel}
          brandMeta={brandMeta}
          navGroups={navGroups}
          onBrandClick={onBrandClick}
          onCollapseSidebar={() => setSidebarCollapsed(true)}
          onExpandSidebar={() => setSidebarCollapsed(false)}
          onNavigate={onNavigate}
          sidebarCollapsed={sidebarCollapsed}
          statusNotice={statusNotice}
        />
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-[180] lg:hidden" role="dialog" aria-modal="true" aria-label="Navegacao">
          <button
            type="button"
            aria-label="Fechar navegacao"
            className="absolute inset-0 bg-slate-950/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="relative flex h-full w-[min(22rem,88vw)] flex-col border-r border-border bg-card shadow-2xl">
            <div className="absolute right-3 top-3 z-10">
              <button
                type="button"
                aria-label="Fechar navegacao"
                onClick={() => setMobileNavOpen(false)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <DashboardSidebarContent
              accountMenuProps={accountMenuProps}
              activeItem={activeItem}
              activeSubItem={activeSubItem}
              brandLabel={brandLabel}
              brandMeta={brandMeta}
              navGroups={navGroups}
              onBrandClick={onBrandClick}
              onNavigate={onNavigate}
              onRequestClose={() => setMobileNavOpen(false)}
              sidebarCollapsed={false}
              statusNotice={statusNotice}
            />
          </div>
        </div>
      ) : null}

      <div className={cn('transition-[padding] duration-200', sidebarCollapsed ? 'lg:pl-16' : 'lg:pl-72')}>
        <header
          className={cn(
            hasContentHeader ? 'sticky top-0 z-30' : 'sticky top-0 z-30 lg:hidden',
            'relative bg-card/90 backdrop-blur'
          )}
        >
          <div className="flex min-h-16 items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <button
              type="button"
              aria-label="Abrir navegacao"
              onClick={() => setMobileNavOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-input bg-background text-muted-foreground shadow-sm transition hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            {hasContentHeader ? <div className="min-w-0 flex-1">{contentHeader}</div> : null}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border" aria-hidden="true" />
        </header>

        <main className={cn(
          'min-h-[calc(100vh-4rem)] overflow-x-hidden px-4 py-6 sm:px-6 lg:px-8',
          !hasContentHeader && 'lg:min-h-screen'
        )}>
          <div className="mx-auto max-w-7xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default DashboardShell;
