import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { Upload, AlertCircle, Loader } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { parseDicomFile } from '../utils/dicomParser';
import { qlab } from '../theme';

const UploadContainer = styled.div`
  padding: 2rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: ${qlab.bg};
`;

const UploadArea = styled.div`
  width: 100%;
  max-width: 520px;
  min-height: 260px;
  border: 1px solid ${(p) => (p.$isDragOver ? qlab.amber : qlab.border)};
  background: ${(p) => (p.$isDragOver ? '#1c1810' : qlab.panel)};
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 2rem;
  transition: border-color 0.15s ease, background 0.15s ease;
`;

const UploadIcon = styled(Upload)`
  color: ${qlab.amber};
  margin-bottom: 1rem;
`;

const UploadTitle = styled.h2`
  font-size: 1.15rem;
  font-weight: 600;
  margin: 0 0 0.45rem;
  color: ${qlab.amberBright};
  letter-spacing: 0.04em;
`;

const UploadSubtitle = styled.p`
  font-size: 0.85rem;
  color: ${qlab.textMuted};
  margin: 0 0 1.25rem;
  text-align: center;
  max-width: 24rem;
  line-height: 1.45;
`;

const FileInput = styled.input`
  display: none;
`;

const UploadButton = styled.button`
  background: ${qlab.amberDim};
  color: #fff8e6;
  border: 1px solid ${qlab.amber};
  padding: 0.55rem 1.4rem;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: ${qlab.amber};
    color: #111;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ProgressWrap = styled.div`
  width: 100%;
  max-width: 520px;
  margin-top: 1.25rem;
`;

const ProgressBar = styled.div`
  height: 4px;
  background: #333;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  width: ${(p) => p.$value * 100}%;
  background: ${qlab.amber};
  transition: width 0.15s ease;
`;

const StatusText = styled.div`
  margin-top: 0.5rem;
  font-size: 0.78rem;
  color: ${qlab.textMuted};
  display: flex;
  align-items: center;
  gap: 0.45rem;
`;

const ErrorBox = styled.div`
  margin-top: 1rem;
  padding: 0.7rem 0.85rem;
  background: #2a1515;
  color: #f0a0a0;
  border: 1px solid #6a3030;
  max-width: 520px;
  width: 100%;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.82rem;
`;

const Note = styled.p`
  margin-top: 1.25rem;
  font-size: 0.72rem;
  color: #666;
  max-width: 520px;
  text-align: center;
  line-height: 1.4;
`;

const ImageUploader = ({ onUploaded }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState('');
  const {
    setLoading,
    setLoadProgress,
    setError,
    setVolume,
    loading,
    loadProgress,
    error,
  } = useEcho();

  const processFiles = useCallback(
    async (files) => {
      const file = files.find(
        (f) =>
          f.type === 'application/dicom' ||
          f.name.toLowerCase().endsWith('.dcm') ||
          f.name.toLowerCase().endsWith('.dicom')
      );

      if (!file) {
        setError('Please upload a .dcm DICOM file');
        return;
      }

      setLoading(true);
      setLoadProgress(0);
      setError(null);
      setStatus(`Reading ${file.name} (${formatFileSize(file.size)})…`);

      try {
        const dicomData = await parseDicomFile(file, {
          onProgress: (ratio) => {
            setLoadProgress(ratio * 0.7);
            setStatus(`Reading file… ${Math.round(ratio * 100)}%`);
          },
        });

        setStatus('Building volume…');
        setLoadProgress(0.85);

        if (!dicomData.volume || dicomData.volume.dims.z < 2) {
          throw new Error(
            'This file does not contain a 3D/4D Cartesian volume. Use a Philips QLAB Cartesian export.'
          );
        }

        setVolume({
          volume: dicomData.volume,
          dicomData,
          meta: dicomData.volume.meta,
        });
        setLoadProgress(1);
        setStatus(
          `Loaded ${dicomData.volume.dims.x}×${dicomData.volume.dims.y}×${dicomData.volume.dims.z} × ${dicomData.volume.dims.t}`
        );
        if (onUploaded) onUploaded();
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to parse DICOM');
        setStatus('');
      } finally {
        setLoading(false);
      }
    },
    [onUploaded, setError, setLoadProgress, setLoading, setVolume]
  );

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e) => {
      e.preventDefault();
      setIsDragOver(false);
      await processFiles(Array.from(e.dataTransfer.files));
    },
    [processFiles]
  );

  const handleFileSelect = useCallback(
    async (e) => {
      await processFiles(Array.from(e.target.files || []));
      e.target.value = '';
    },
    [processFiles]
  );

  return (
    <UploadContainer>
      <UploadArea
        $isDragOver={isDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !loading && document.getElementById('file-input').click()}
      >
        <UploadIcon size={40} />
        <UploadTitle>3DQ — LOAD VOLUME</UploadTitle>
        <UploadSubtitle>
          Drop a Philips QLAB Cartesian 4D DICOM. Parsing stays in your browser.
        </UploadSubtitle>
        <UploadButton
          type="button"
          disabled={loading}
          onClick={(e) => {
            e.stopPropagation();
            document.getElementById('file-input').click();
          }}
        >
          {loading ? 'Loading…' : 'Select DICOM'}
        </UploadButton>
        <FileInput
          id="file-input"
          type="file"
          accept=".dcm,.dicom,application/dicom"
          onChange={handleFileSelect}
          disabled={loading}
        />
      </UploadArea>

      {(loading || loadProgress > 0) && (
        <ProgressWrap>
          <ProgressBar>
            <ProgressFill $value={loadProgress} />
          </ProgressBar>
          <StatusText>
            {loading && <Loader size={14} className="spin" />}
            {status || 'Working…'}
          </StatusText>
        </ProgressWrap>
      )}

      {error && (
        <ErrorBox>
          <AlertCircle size={18} />
          <span>{error}</span>
        </ErrorBox>
      )}

      <Note>
        Supported: PMS QLAB Cart Export with Philips3D private geometry tags.
      </Note>
    </UploadContainer>
  );
};

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export default ImageUploader;
