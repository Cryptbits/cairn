import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from './config/web3';
import { DrawIdProvider } from './context/DrawIdContext';
import { DecryptedBalancesProvider } from './context/DecryptedBalancesContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import App from './App.tsx';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 2 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <DrawIdProvider>
            <DecryptedBalancesProvider>
              <App />
            </DecryptedBalancesProvider>
          </DrawIdProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </ErrorBoundary>
  </StrictMode>,
);
