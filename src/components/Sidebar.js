import React from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Upload, Eye, Box } from 'lucide-react';

const SidebarContainer = styled(motion.div)`
  width: ${(p) => (p.$isOpen ? '220px' : '0')};
  background: rgba(244, 246, 248, 0.96);
  border-radius: 0 16px 16px 0;
  margin: 0 12px 16px 16px;
  overflow: hidden;
  transition: width 0.25s ease;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  flex-shrink: 0;
`;

const SidebarContent = styled.div`
  padding: 1.5rem 0.85rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-width: 220px;
`;

const MenuItem = styled(motion.div)`
  display: flex;
  align-items: center;
  gap: 0.85rem;
  padding: 0.85rem;
  margin: 0.35rem 0;
  border-radius: 10px;
  cursor: ${(p) => (p.$disabled ? 'not-allowed' : 'pointer')};
  opacity: ${(p) => (p.$disabled ? 0.45 : 1)};
  background: ${(p) => (p.$active ? '#2d4a62' : 'transparent')};
  color: ${(p) => (p.$active ? '#fff' : '#1a222c')};

  &:hover {
    background: ${(p) =>
      p.$disabled ? 'transparent' : p.$active ? '#2d4a62' : 'rgba(45, 74, 98, 0.1)'};
  }
`;

const MenuIcon = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
`;

const MenuText = styled.span`
  font-weight: ${(p) => (p.$active ? '600' : '500')};
  font-size: 0.92rem;
`;

const Footer = styled.div`
  margin-top: auto;
  padding: 0.85rem;
  font-size: 0.75rem;
  color: #7a8a99;
`;

const Sidebar = ({ isOpen, activeView, onViewChange, hasVolume }) => {
  const menuItems = [
    { id: 'upload', label: 'Upload', icon: Upload, needsVolume: false },
    { id: 'mpr', label: 'MPR Viewer', icon: Box, needsVolume: true },
    { id: 'viewer', label: '2D Preview', icon: Eye, needsVolume: true },
  ];

  return (
    <SidebarContainer
      $isOpen={isOpen}
      initial={{ x: -200 }}
      animate={{ x: isOpen ? 0 : -200 }}
      transition={{ duration: 0.25 }}
    >
      <SidebarContent>
        {menuItems.map((item) => {
          const IconComponent = item.icon;
          const disabled = item.needsVolume && !hasVolume;
          return (
            <MenuItem
              key={item.id}
              $active={activeView === item.id}
              $disabled={disabled}
              onClick={() => !disabled && onViewChange(item.id)}
              whileHover={disabled ? undefined : { scale: 1.01 }}
              whileTap={disabled ? undefined : { scale: 0.99 }}
            >
              <MenuIcon>
                <IconComponent size={18} />
              </MenuIcon>
              <MenuText $active={activeView === item.id}>{item.label}</MenuText>
            </MenuItem>
          );
        })}

        <Footer>EchoMPR · client-side only</Footer>
      </SidebarContent>
    </SidebarContainer>
  );
};

export default Sidebar;
