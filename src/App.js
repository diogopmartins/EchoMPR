import React, { useState } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import Header from './components/Header';
import ImageUploader from './components/ImageUploader';
import MPRViewer from './components/MPRViewer';
import { EchoProvider, useEcho } from './context/EchoContext';

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0e12;
`;

const ContentArea = styled(motion.div)`
  flex: 1;
  overflow: hidden;
  min-width: 0;
  background: #0a0e12;
`;

function AppShell() {
  const [activeView, setActiveView] = useState('upload');
  const { volume, clearImages } = useEcho();

  const goUpload = () => {
    clearImages();
    setActiveView('upload');
  };

  return (
    <AppContainer>
      <Header
        hasVolume={Boolean(volume)}
        activeView={activeView}
        onUploadClick={goUpload}
        onMprClick={() => volume && setActiveView('mpr')}
      />
      <ContentArea
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      >
        {activeView === 'mpr' && volume ? (
          <MPRViewer />
        ) : (
          <ImageUploader onUploaded={() => setActiveView('mpr')} />
        )}
      </ContentArea>
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
