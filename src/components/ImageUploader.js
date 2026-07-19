import React, { useState, useCallback } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Upload, AlertCircle, Loader } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { parseDicomFile } from '../utils/dicomParser';

const UploadContainer = styled.div`
  padding: 2rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(ellipse at 20% 0%, rgba(61, 154, 139, 0.12), transparent 50%),
    radial-gradient(ellipse at 80% 100%, rgba(45, 74, 98, 0.2), transparent 45%),
    #f4f6f8;
`;

const UploadArea = styled(motion.div)`
  width: 100%;
  max-width: 560px;
  min-height: 280px;
  border: 2px dashed ${(p) => (p.$isDragOver ? '#3d9a8b' : '#b8c4ce')};
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: ${(p) =>
    p.$isDragOver ? 'rgba(61, 154, 139, 0.08)' : 'rgba(255, 255, 255, 0.75)'};
  transition: border-color 0.2s ease, background 0.2s ease;
  cursor: pointer;
  padding: 2rem;
`;

const UploadIcon = styled(Upload)`
  color: #2d4a62;
  margin-bottom: 1rem;
`;

const UploadTitle = styled.h2`
  font-family: 'Fraunces', 'Georgia', serif;
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: #1a222c;
`;

const UploadSubtitle = styled.p`
  font-size: 0.95rem;
  color: #5a6a7a;
  margin: 0 0 1.25rem;
  text-align: center;
  max-width: 26rem;
  line-height: 1.45;
`;

const FileInput = styled.input`
  display: none;
`;

const UploadButton = styled(motion.button)`
  background: #2d4a62;
  color: white;
  border: none;
  padding: 0.85rem 1.75rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    background: #3d9a8b;
  }
`;

const ProgressWrap = styled.div`
  width: 100%;
  max-width: 560px;
  margin-top: 1.5rem;
`;

const ProgressBar = styled.div`
  height: 8px;
  background: #d5dde5;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  width: ${(p) => p.$value * 100}%;
  background: #3d9a8b;
  transition: width 0.15s ease;
`;

const StatusText = styled.div`
  margin-top: 0.6rem;
  font-size: 0.85rem;
  color: #5a6a7a;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ErrorBox = styled.div`
  margin-top: 1rem;
  padding: 0.85rem 1rem;
  background: #fdecea;
  color: #8a1f1a;
  border-radius: 8px;
  max-width: 560px;
  width: 100%;
  display: flex;
  gap: 0.5rem;
  align-items: flex-start;
  font-size: 0.9rem;
`;

const Note = styled.p`
  margin-top: 1.5rem;
  font-size: 0.8rem;
  color: #7a8a99;
  max-width: 560px;
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
            'This file does not contain a 3D/4D Cartesian volume. Use a Philips QLAB Cartesian export (private tag 3001,1001).'
          );
        }

        setVolume({
          volume: dicomData.volume,
          dicomData,
          meta: dicomData.volume.meta,
        });
        setLoadProgress(1);
        setStatus(
          `Loaded ${dicomData.volume.dims.x}×${dicomData.volume.dims.y}×${dicomData.volume.dims.z} × ${dicomData.volume.dims.t} volumes`
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
        whileHover={loading ? undefined : { scale: 1.01 }}
        whileTap={loading ? undefined : { scale: 0.99 }}
      >
        <UploadIcon size={44} />
        <UploadTitle>EchoMPR</UploadTitle>
        <UploadSubtitle>
          Drop a Philips QLAB Cartesian 4D DICOM here. Parsing and MPR run entirely
          in your browser — nothing is uploaded to a server.
        </UploadSubtitle>
        <UploadButton
          type="button"
          disabled={loading}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
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
        Supported: Philips QLAB Cartesian exports (PMS QLAB Cart Export) with
        Philips3D private geometry. Large files (~100MB+) are normal for 4D echo.
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
