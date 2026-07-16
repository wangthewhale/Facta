import React from 'react';
import { Link, useLocation } from 'wouter';
import { Home, ScanLine, Clock, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { href: '/', label: '首頁', icon: Home, match: (p: string) => p === '/' },
  { href: '/scan', label: '掃描', icon: ScanLine, match: (p: string) => p === '/scan' },
  { href: '/history', label: '紀錄', icon: Clock, match: (p: string) => p.startsWith('/history') },
  { href: '/preferences', label: '設定', icon: Settings, match: (p: string) => p.startsWith('/preferences') },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const [pathname] = useLocation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground max-w-md mx-auto w-full border-x border-border/50 relative shadow-sm">
      <main className="flex-1 overflow-y-auto pb-20 w-full relative">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-background/95 backdrop-blur-sm border-t border-border z-50" aria-label="主要導覽">
        <div className="flex justify-around items-center h-16 px-4">
          {navItems.map(({ href, label, icon: Icon, match }) => {
            const active = match(pathname);
            if (href === '/scan') {
              return (
                <Link key={href} href={href} aria-label={label} aria-current={active ? 'page' : undefined}
                  className="flex flex-col items-center justify-center w-full h-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                  <div className={cn(
                    'p-2 -mt-4 shadow-md flex items-center justify-center transition-colors',
                    active ? 'bg-primary text-black' : 'bg-foreground text-background'
                  )}>
                    <Icon className="w-6 h-6" />
                  </div>
                  <span className={cn('text-[10px] mt-1 tracking-wider', active ? 'font-bold text-foreground' : 'font-medium text-muted-foreground')}>{label}</span>
                </Link>
              );
            }
            return (
              <Link key={href} href={href} aria-label={label} aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex flex-col items-center justify-center w-full h-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}>
                <Icon className={cn('w-5 h-5 mb-1', active && 'stroke-[2.5]')} />
                <span className={cn('text-[10px] tracking-wider', active ? 'font-bold' : 'font-medium')}>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
