import React, { useState } from 'react';
import styled from 'styled-components';
import Header from './components/Header';
import ImageUploader from './components/ImageUploader';
import MPRViewer from './components/MPRViewer';
import { EchoProvider, useEcho } from './context/EchoContext';
import { qlab } from './theme';

const AppContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: ${qlab.bg};
  color: ${qlab.text};
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
`;

const ContentArea = styled.div`
  flex: 1;
  overflow: hidden;
  min-width: 0;
  background: ${qlab.bg};
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
      <ContentArea>
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
