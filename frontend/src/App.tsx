import React, { useState } from 'react';
import { MotionConfig } from 'motion/react';
import { ViewType } from './types';
import { Layout } from './components/Layout';
import { Landing } from './components/views/Landing';
import { Home } from './components/views/Home';
import { Deposit } from './components/views/Deposit';
import { Draw } from './components/views/Draw';
import { Result } from './components/views/Result';
import { Claim } from './components/views/Claim';
import { Privacy } from './components/views/Privacy';
import { AdminFundYieldSource } from './components/admin/AdminFundYieldSource';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('landing');

  return (

    <MotionConfig reducedMotion="user">
      <Layout currentView={currentView} setCurrentView={setCurrentView}>
        {currentView === 'landing' && <Landing setCurrentView={setCurrentView} />}
        {currentView === 'home' && <Home setCurrentView={setCurrentView} />}
        {currentView === 'deposit' && <Deposit />}
        {currentView === 'draw' && <Draw setCurrentView={setCurrentView} />}
        {currentView === 'result' && <Result setCurrentView={setCurrentView} />}
        {currentView === 'claim' && <Claim setCurrentView={setCurrentView} />}
        {currentView === 'privacy' && <Privacy />}
        {currentView === 'admin' && <AdminFundYieldSource />}
      </Layout>
    </MotionConfig>
  );
}

