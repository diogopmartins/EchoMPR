import React from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Menu, Activity } from 'lucide-react';

const HeaderContainer = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.85rem 1.5rem;
  background: rgba(15, 20, 25, 0.35);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
`;

const Logo = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 0.55rem;
  color: #f4f6f8;
  font-family: 'Fraunces', Georgia, serif;
  font-size: 1.35rem;
  font-weight: 600;
  letter-spacing: -0.02em;
`;

const LogoIcon = styled(Activity)`
  color: #3d9a8b;
`;

const MenuButton = styled(motion.button)`
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 8px;
  padding: 0.45rem;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #d5dde5;
  font-size: 0.85rem;
`;

const StatusDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${(p) => (p.$ready ? '#3d9a8b' : '#9aa5b1')};
`;

const Header = ({ onMenuClick, hasVolume }) => {
  return (
    <HeaderContainer>
      <Logo
        initial={{ opacity: 0, x: -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4 }}
      >
        <LogoIcon size={22} />
        EchoMPR
      </Logo>

      <StatusIndicator>
        <StatusDot $ready={hasVolume} />
        <span>{hasVolume ? 'Volume ready' : 'Awaiting DICOM'}</span>
      </StatusIndicator>

      <MenuButton
        onClick={onMenuClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
      >
        <Menu size={20} />
      </MenuButton>
    </HeaderContainer>
  );
};

export default Header;
