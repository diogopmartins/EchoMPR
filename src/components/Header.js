import React from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Activity, Upload, Box } from 'lucide-react';

const HeaderContainer = styled.header`
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.65rem 1.25rem;
  background: #12181f;
  border-bottom: 1px solid #243040;
  flex-shrink: 0;
`;

const Logo = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #f4f6f8;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  margin-right: 0.5rem;
`;

const LogoIcon = styled(Activity)`
  color: #3d9a8b;
`;

const NavBtn = styled.button`
  background: ${(p) => (p.$active ? '#2d4a62' : 'transparent')};
  border: 1px solid ${(p) => (p.$active ? '#3d9a8b' : '#3a4a5c')};
  color: #e8e6e3;
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
    background: #243040;
  }
`;

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #9aa5b1;
  font-size: 0.8rem;
  margin-left: auto;
`;

const StatusDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => (p.$ready ? '#3d9a8b' : '#5a6a7a')};
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
        EchoMPR
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
