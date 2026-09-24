import React from 'react';
import styled from 'styled-components';
import { Trash2 } from 'lucide-react';
import {
  hexToRgba,
  isSliceMeasurementVisible,
  measureColor,
  measurementCaption,
} from '../../../utils/measurements';
import { AXIS_META } from '../constants';
import { MeasureMetaLine } from '../styles';

const MeasureList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  max-height: 11rem;
  overflow-y: auto;
`;

const MeasureRow = styled.div`
  display: grid;
  grid-template-columns: 2.1rem 1fr auto;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  text-align: left;
  background: ${(p) => (p.$active ? hexToRgba(p.$color, 0.22) : '#243040')};
  border: 1px solid ${(p) => (p.$active ? p.$color : p.$visible ? '#3a4a5c' : '#2a3542')};
  box-shadow: inset 3px 0 0 ${(p) => p.$color || '#ffd54f'};
  color: ${(p) => (p.$visible ? '#e8e6e3' : '#7a8a99')};
  border-radius: 6px;
  padding: 0.28rem 0.35rem 0.28rem 0.55rem;
  cursor: pointer;
  font-size: 0.75rem;
`;

const MeasureLabel = styled.strong`
  color: ${(p) => p.$color || '#ffd54f'};
  font-weight: 700;
`;

const MeasureValue = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MeasureDelete = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: #9aa5b1;

  &:hover {
    background: #3a2a30;
    color: #f0b4b4;
  }
`;

export default function MeasurementsPanel({
  measurements,
  selectedId,
  volume,
  timeIndex,
  mprCenter,
  mprBasis,
  onRestore,
  onDelete,
}) {
  if (measurements.length === 0) {
    return <MeasureMetaLine>None yet · Length or Area on a 2D view</MeasureMetaLine>;
  }
  return (
    <MeasureList>
      {measurements.map((m) => {
        const visible2d = isSliceMeasurementVisible(
          m,
          m.axis,
          timeIndex,
          volume,
          mprCenter,
          mprBasis
        );
        const visible3d = m.timeIndex === timeIndex;
        return (
          <MeasureRow
            key={m.id}
            $active={m.id === selectedId}
            $visible={visible2d || visible3d}
            $color={measureColor(m)}
            onClick={() => onRestore(m)}
            title="Jump to this measurement"
          >
            <MeasureLabel $color={measureColor(m)}>{m.label}</MeasureLabel>
            <MeasureValue>
              {measurementCaption(m)}
              <MeasureMetaLine>
                T{m.timeIndex + 1} · {AXIS_META[m.axis]?.short || m.axis}
              </MeasureMetaLine>
            </MeasureValue>
            <MeasureDelete
              role="button"
              title={`Delete ${m.label}`}
              onClick={(e) => {
                e.stopPropagation();
                onDelete(m.id);
              }}
            >
              <Trash2 size={13} />
            </MeasureDelete>
          </MeasureRow>
        );
      })}
    </MeasureList>
  );
}
