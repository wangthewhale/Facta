import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useLayoutEffect } from 'react';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';
import { I18nProvider } from '@/lib/i18n';

import Home from '@/pages/home';
import Scan from '@/pages/scan';
import Report from '@/pages/report';
import Submit from '@/pages/submit';
import Alternatives from '@/pages/alternatives';
import Preferences from '@/pages/preferences';
import History from '@/pages/history';
import Admin from '@/pages/admin';
import ShareCard from '@/pages/share';
import Methodology from '@/pages/methodology';
import Onboarding from '@/pages/onboarding';
import GoalDetail from '@/pages/goalDetail';
import Search from '@/pages/search';
import FamilyCheck from '@/pages/familyCheck';

const queryClient = new QueryClient();

function Router() {
  const [pathname] = useLocation();

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname]);

  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/scan" component={Scan} />
      <Route path="/report/:id" component={Report} />
      <Route path="/submit" component={Submit} />
      <Route path="/alternatives/:id" component={Alternatives} />
      <Route path="/preferences" component={Preferences} />
      <Route path="/history" component={History} />
      <Route path="/admin" component={Admin} />
      <Route path="/share/:id" component={ShareCard} />
      <Route path="/methodology" component={Methodology} />
      <Route path="/family-check" component={FamilyCheck} />
      <Route path="/onboarding" component={Onboarding} />
      <Route path="/goals/:slug" component={GoalDetail} />
      <Route path="/search" component={Search} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <I18nProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
          <Toaster />
        </I18nProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
