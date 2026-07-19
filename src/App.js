import React, { useState } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import ImageUploader from './components/ImageUploader';
import ImageViewer from './components/ImageViewer';
import MPRViewer from './components/MPRViewer';
import { EchoProvider, useEcho } from './context/EchoContext';

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background:
    linear-gradient(160deg, #1a222c 0%, #2d4a62 55%, #1e3a3a 100%);
`;

const MainContent = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const ContentArea = styled(motion.div)`
  flex: 1;
  background: rgba(255, 255, 255, 0.97);
  border-radius: 16px 16px 0 0;
  margin: 0 16px 16px 0;
  overflow: hidden;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
  min-width: 0;
`;

function AppShell() {
  const [activeView, setActiveView] = useState('upload');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { volume } = useEcho();

  const renderContent = () => {
    switch (activeView) {
      case 'upload':
        return (
          <ImageUploader
            onUploaded={() => setActiveView('mpr')}
          />
        );
      case 'viewer':
        return <ImageViewer />;
      case 'mpr':
        return <MPRViewer />;
      default:
        return (
          <ImageUploader onUploaded={() => setActiveView('mpr')} />
        );
    }
  };

  return (
    <AppContainer>
      <Header
        onMenuClick={() => setSidebarOpen(!sidebarOpen)}
        sidebarOpen={sidebarOpen}
        hasVolume={Boolean(volume)}
      />
      <MainContent>
        <Sidebar
          isOpen={sidebarOpen}
          activeView={activeView}
          onViewChange={setActiveView}
          hasVolume={Boolean(volume)}
        />
        <ContentArea
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          {renderContent()}
        </ContentArea>
      </MainContent>
    </AppContainer>
  );
}

function App() {
  return (
    <EchoProvider>
      <AppShell />
    </EchoProvider>
  );
}

export default App;
