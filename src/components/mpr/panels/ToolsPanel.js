import React from 'react';
import { Button, ButtonRow } from '../styles';

const TOOLS = [
  { id: 'navigate', label: 'Nav', title: 'Move and rotate MPR lines' },
  { id: 'distance', label: 'Length', title: 'Measure distance on a 2D slice' },
  { id: 'area', label: 'Area', title: 'Measure area on a 2D slice' },
];

export default function ToolsPanel({ tool, onToolChange, onClear, canClear }) {
  return (
    <ButtonRow>
      {TOOLS.map((t) => (
        <Button
          key={t.id}
          $grow
          $active={tool === t.id}
          onClick={() => onToolChange(t.id)}
          title={t.title}
        >
          {t.label}
        </Button>
      ))}
      <Button
        $grow
        onClick={onClear}
        disabled={!canClear}
        title="Clear all measurements"
      >
        Clear
      </Button>
    </ButtonRow>
  );
}
