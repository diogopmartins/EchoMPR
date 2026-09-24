import React from 'react';
import styled from 'styled-components';
import { clampMenuPos } from '../../utils/paneGeometry';

const MenuRoot = styled.div`
  position: fixed;
  z-index: 40;
  min-width: 188px;
  padding: 0.3rem 0;
  background: #1c2632;
  border: 1px solid #3a4a5c;
  border-radius: 8px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
`;

const MenuItem = styled.button.attrs({ type: 'button' })`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  width: 100%;
  background: ${(p) => (p.$active ? 'rgba(61, 154, 139, 0.28)' : 'transparent')};
  border: none;
  color: ${(p) => (p.$active ? '#d7fff6' : '#e8e6e3')};
  text-align: left;
  padding: 0.38rem 0.75rem;
  font-size: 0.8rem;
  font-family: inherit;
  cursor: pointer;

  &:hover {
    background: ${(p) => (p.$active ? 'rgba(61, 154, 139, 0.38)' : '#243040')};
  }
`;

const MenuSep = styled.div`
  height: 1px;
  background: #2a3542;
  margin: 0.28rem 0;
`;

const MenuHint = styled.div`
  padding: 0.2rem 0.75rem 0.35rem;
  font-size: 0.65rem;
  color: #7a8a99;
  letter-spacing: 0.04em;
  text-transform: uppercase;
`;

export default function ViewContextMenu({
  menu,
  tool,
  maximized,
  showMprLines,
  useCutPlanes,
  onAction,
  onClose,
}) {
  if (!menu) return null;
  const pos = clampMenuPos(menu.x, menu.y);
  const is3d = menu.pane === 'volume';

  return (
    <>
      <div
        role="presentation"
        onMouseDown={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 39 }}
      />
      <MenuRoot
        style={{ left: pos.x, top: pos.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <MenuHint>{is3d ? '3D view' : '2D view'}</MenuHint>
        {!is3d && (
          <>
            <MenuItem $active={tool === 'navigate'} onClick={() => onAction('nav')}>
              Nav
            </MenuItem>
            <MenuItem $active={tool === 'distance'} onClick={() => onAction('length')}>
              Length
            </MenuItem>
            <MenuItem $active={tool === 'area'} onClick={() => onAction('area')}>
              Area
            </MenuItem>
            <MenuSep />
          </>
        )}
        <MenuItem onClick={() => onAction('max')}>
          {maximized ? 'Restore 2×2' : 'Maximize'}
        </MenuItem>
        {!is3d && (
          <>
            <MenuItem onClick={() => onAction('fit')}>Fit zoom</MenuItem>
            <MenuItem onClick={() => onAction('resetTilt')}>Reset tilt</MenuItem>
          </>
        )}
        {is3d && (
          <>
            <MenuItem onClick={() => onAction('reset3d')}>Reset 3D camera</MenuItem>
            <MenuItem $active={showMprLines} onClick={() => onAction('mprLines')}>
              {showMprLines ? 'Hide MPR lines' : 'Show MPR lines'}
            </MenuItem>
            <MenuItem $active={useCutPlanes} onClick={() => onAction('cuts')}>
              {useCutPlanes ? 'Cuts off' : 'Cuts on'}
            </MenuItem>
          </>
        )}
        <MenuSep />
        <MenuItem onClick={() => onAction('png')}>Save PNG</MenuItem>
      </MenuRoot>
    </>
  );
}
