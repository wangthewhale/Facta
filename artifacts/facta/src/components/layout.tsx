import React from 'react';
import { Link } from 'wouter';
import { Home, ScanLine, Clock, Settings, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from '../lib/i18n';

export function Layout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background text-foreground max-w-md mx-auto w-full border-x border-border/50 relative shadow-sm">
      <main className="flex-1 overflow-y-auto pb-20 w-full relative">
        {children}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-background/95 backdrop-blur-sm border-t border-border z-50">
        <div className="flex justify-around items-center h-16 px-4">
          <Link href="/" className="flex flex-col items-center justify-center w-full h-full text-muted-foreground hover:text-foreground">
            <Home className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium tracking-wider">首頁</span>
          </Link>
          <Link href="/scan" className="flex flex-col items-center justify-center w-full h-full text-muted-foreground hover:text-primary-strong">
            <div className="bg-foreground text-background p-2 -mt-4 shadow-md flex items-center justify-center">
              <ScanLine className="w-6 h-6" />
            </div>
            <span className="text-[10px] font-medium mt-1 tracking-wider text-foreground">掃描</span>
          </Link>
          <Link href="/history" className="flex flex-col items-center justify-center w-full h-full text-muted-foreground hover:text-foreground">
            <Clock className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium tracking-wider">紀錄</span>
          </Link>
          <Link href="/preferences" className="flex flex-col items-center justify-center w-full h-full text-muted-foreground hover:text-foreground">
            <Settings className="w-5 h-5 mb-1" />
            <span className="text-[10px] font-medium tracking-wider">設定</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
