import React from 'react';
import styled from 'styled-components';
import { ChevronDown } from 'lucide-react';

const ToolGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding-bottom: 0.85rem;
  border-bottom: 1px solid #243040;

  &:last-of-type {
    border-bottom: none;
    padding-bottom: 0;
  }
`;

const AccordionHeader = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.4rem;
  width: 100%;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7a8a99;
  font-weight: 600;
  font-family: inherit;

  svg {
    flex-shrink: 0;
    transition: transform 0.15s ease;
    transform: rotate(${(p) => (p.$open ? '0deg' : '-90deg')});
  }
`;

export default function SidebarSection({ title, open, onToggle, children }) {
  return (
    <ToolGroup>
      <AccordionHeader type="button" onClick={onToggle} $open={open}>
        <span>{title}</span>
        <ChevronDown size={13} />
      </AccordionHeader>
      {open ? children : null}
    </ToolGroup>
  );
}
