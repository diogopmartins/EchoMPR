import React from 'react';
import { Camera, Download, Film } from 'lucide-react';
import { Button, ButtonRow } from '../styles';

export default function ExportPanel({ exporting, frameCount, onPng, onAvi, onNrrd }) {
  return (
    <>
      <ButtonRow>
        <Button
          $grow
          onClick={onPng}
          disabled={Boolean(exporting)}
          title="Screenshot of the current views (PNG)"
        >
          <Camera size={14} />
          PNG
        </Button>
        <Button
          $grow
          onClick={onAvi}
          disabled={Boolean(exporting) || frameCount <= 1}
          title="Cine clip as Motion-JPEG AVI"
        >
          <Film size={14} />
          {exporting?.kind === 'avi' ? `${exporting.i}/${exporting.n}` : 'AVI'}
        </Button>
      </ButtonRow>
      <Button $grow onClick={onNrrd} disabled={Boolean(exporting)}>
        <Download size={16} />
        NRRD
      </Button>
    </>
  );
}
