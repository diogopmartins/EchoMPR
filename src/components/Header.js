import React from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Activity, Upload, Box } from 'lucide-react';

const HeaderContainer = styled.header`
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 1.25rem;
  background: #2e2e2e;
  border-bottom: 1px solid #4a4a4a;
  flex-shrink: 0;
`;

const Logo = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #ffffff;
  font-family: Arial, Helvetica, sans-serif;
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-right: 0.5rem;
`;

const LogoIcon = styled(Activity)`
  color: #4caf50;
`;

const NavBtn = styled.button`
  background: ${(p) => (p.$active ? '#4caf50' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? '#4caf50' : '#4a4a4a')};
  color: #ffffff;
  border-radius: 6px;
  padding: 0.35rem 0.7rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.85rem;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &:hover:not(:disabled) {
    background: ${(p) => (p.$active ? '#45a049' : '#383838')};
  }
`;

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #c8c8c8;
  font-size: 0.8rem;
  margin-left: auto;
`;

const StatusDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => (p.$ready ? '#4caf50' : '#4a4a4a')};
`;

const Header = ({ hasVolume, activeView, onUploadClick, onMprClick }) => {
  return (
    <HeaderContainer>
      <Logo
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <LogoIcon size={20} />
        MPR
      </Logo>

      <NavBtn $active={activeView === 'upload'} onClick={onUploadClick}>
        <Upload size={14} />
        Upload
      </NavBtn>
      <NavBtn
        $active={activeView === 'mpr'}
        onClick={onMprClick}
        disabled={!hasVolume}
      >
        <Box size={14} />
        MPR
      </NavBtn>

      <StatusIndicator>
        <StatusDot $ready={hasVolume} />
        <span>{hasVolume ? 'Volume ready' : 'Awaiting DICOM'}</span>
      </StatusIndicator>
    </HeaderContainer>
  );
};

export default Header;
