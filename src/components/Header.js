import React from 'react';
import styled from 'styled-components';
import { Upload, Box } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { qlab } from '../theme';

const Wrap = styled.div`
  flex-shrink: 0;
  background: ${qlab.bg};
`;

const PatientBar = styled.div`
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 0.35rem 0.85rem;
  background: linear-gradient(180deg, #7a6848 0%, ${qlab.patientBar} 100%);
  color: #f5f0e6;
  font-size: 0.78rem;
  font-family: 'Segoe UI', Tahoma, sans-serif;
  letter-spacing: 0.01em;
`;

const PatientItem = styled.span`
  white-space: nowrap;

  strong {
    font-weight: 600;
    margin-right: 0.25rem;
    opacity: 0.85;
  }
`;

const TabBar = styled.div`
  display: flex;
  align-items: center;
  gap: 0;
  background: ${qlab.panel};
  border-bottom: 1px solid ${qlab.border};
  padding: 0 0.5rem;
  min-height: 34px;
`;

const Brand = styled.div`
  color: ${qlab.amberBright};
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 0 0.75rem 0 0.35rem;
  border-right: 1px solid ${qlab.border};
  margin-right: 0.35rem;
`;

const Tab = styled.button`
  appearance: none;
  border: none;
  background: ${(p) => (p.$active ? qlab.bg : 'transparent')};
  color: ${(p) => (p.$active ? qlab.amberBright : qlab.textMuted)};
  border-top: 2px solid ${(p) => (p.$active ? qlab.amber : 'transparent')};
  padding: 0.4rem 0.9rem;
  font-size: 0.78rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;

  &:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    color: ${qlab.text};
  }
`;

const Spacer = styled.div`
  flex: 1;
`;

const MetaRight = styled.div`
  color: ${qlab.textMuted};
  font-size: 0.72rem;
  padding-right: 0.5rem;
`;

function formatPN(name) {
  if (!name) return '—';
  return name.replace(/\^/g, ' ').trim();
}

const Header = ({ hasVolume, activeView, onUploadClick, onMprClick }) => {
  const { volume, currentImage } = useEcho();
  const meta = volume?.meta || {};
  const patient = formatPN(meta.patientName || currentImage?.patientName);
  const id = meta.patientId || currentImage?.patientId || '—';
  const date = meta.studyDate || currentImage?.studyDate || '';

  return (
    <Wrap>
      <PatientBar>
        <PatientItem>
          <strong>Name</strong>
          {patient}
        </PatientItem>
        <PatientItem>
          <strong>ID</strong>
          {id}
        </PatientItem>
        <PatientItem>
          <strong>Study</strong>
          {date || '—'}
        </PatientItem>
        <PatientItem style={{ marginLeft: 'auto' }}>
          <strong>EchoMPR</strong>
          3DQ
        </PatientItem>
      </PatientBar>
      <TabBar>
        <Brand>QLAB</Brand>
        <Tab $active={activeView === 'upload'} onClick={onUploadClick}>
          <Upload size={13} />
          Load
        </Tab>
        <Tab
          $active={activeView === 'mpr'}
          onClick={onMprClick}
          disabled={!hasVolume}
        >
          <Box size={13} />
          3DQ
        </Tab>
        <Spacer />
        <MetaRight>
          {hasVolume
            ? `${volume.dims.x}×${volume.dims.y}×${volume.dims.z} · ${volume.dims.t} frames`
            : 'No volume'}
        </MetaRight>
      </TabBar>
    </Wrap>
  );
};

export default Header;
