import { Switch, Route, Router } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import CreatePage from "@/pages/create";
import ResultPage from "@/pages/result";
import { AppStateProvider } from "@/lib/app-state";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/create" component={CreatePage} />
      <Route path="/result" component={ResultPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppStateProvider>
          <Toaster />
          <Router hook={useHashLocation}>
            <AppRouter />
          </Router>
        </AppStateProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
