import styled from 'styled-components';

export const Container = styled.div`
  height: 100%;
  display: flex;
  flex-direction: row;
  background: #0f1419;
  color: #e8e6e3;
  font-family: 'IBM Plex Sans', 'Segoe UI', sans-serif;
  min-height: 0;
`;

export const ControlSidebar = styled.aside`
  width: 248px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding: 0.85rem 0.8rem 1rem;
  background: #1a222c;
  border-right: 1px solid #2a3542;
  overflow-y: auto;
`;

export const Viewport = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
`;

export const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.45rem;
`;

export const ButtonRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
`;

export const Label = styled.label`
  font-size: 0.75rem;
  color: #9aa5b1;
  white-space: nowrap;
  min-width: ${(p) => p.$wide || '4.6rem'};
  flex-shrink: 0;
`;

export const Slider = styled.input`
  flex: 1;
  min-width: 0;
  accent-color: #3d9a8b;
`;

export const Button = styled.button`
  background: ${(p) => (p.$active ? '#3d9a8b' : '#243040')};
  border: 1px solid ${(p) => (p.$active ? '#4db8a6' : '#3a4a5c')};
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  font-size: 0.8rem;
  flex: ${(p) => (p.$grow ? '1 1 auto' : '0 1 auto')};
  min-width: 0;

  &:hover {
    background: ${(p) => (p.$active ? '#45a994' : '#2e3d50')};
  }

  &:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
`;

export const Select = styled.select`
  background: #243040;
  border: 1px solid #3a4a5c;
  color: #e8e6e3;
  border-radius: 6px;
  padding: 0.35rem 0.5rem;
  font-size: 0.85rem;
  cursor: pointer;
  width: 100%;
`;

export const Meta = styled.div`
  margin-top: auto;
  padding-top: 0.6rem;
  font-size: 0.72rem;
  color: #9aa5b1;
  line-height: 1.45;
`;

export const MeasureMetaLine = styled.span`
  display: block;
  font-size: 0.65rem;
  color: #7a8a99;
`;

export const Grid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  gap: 2px;
  min-height: 0;
  background: #2a3542;
  position: relative;
`;

export const Pane = styled.div`
  position: relative;
  background: #000;
  overflow: hidden;
  min-height: 0;
  box-shadow: inset 0 0 0 2px ${(p) => p.$borderColor || 'transparent'};
  ${(p) => (p.$hidden ? 'visibility: hidden; pointer-events: none;' : '')}
  ${(p) =>
    p.$maximized
      ? `
    position: absolute;
    inset: 0;
    z-index: 5;
    visibility: visible;
    pointer-events: auto;
  `
      : ''}
`;

export const PaneLabel = styled.div`
  position: absolute;
  top: 8px;
  left: 10px;
  z-index: 2;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #fff;
  background: ${(p) => p.$color || '#666'};
  padding: 0.2rem 0.45rem;
  border-radius: 3px;
  pointer-events: none;
  font-weight: 600;
`;

export const PaneTools = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 3;
  display: flex;
  gap: 4px;
`;

export const IconBtn = styled.button`
  background: rgba(0, 0, 0, 0.55);
  border: 1px solid #3a4a5c;
  color: #e8e6e3;
  border-radius: 4px;
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;

  &:hover {
    background: rgba(36, 48, 64, 0.92);
  }
`;

export const Empty = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9aa5b1;
  font-size: 1.05rem;
  padding: 2rem;
  text-align: center;
`;
