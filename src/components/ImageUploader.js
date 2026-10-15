import React, { useState, useCallback, useEffect, useRef } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { Upload, AlertCircle, Loader } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { parseDicomFile } from '../utils/dicomParser';
import { EXAMPLES, loadExampleStudy } from '../utils/exampleStudy';

const UploadContainer = styled.div`
  padding: 2rem;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #212121;
`;

const UploadArea = styled(motion.div)`
  width: 100%;
  max-width: 560px;
  min-height: 280px;
  border: 2px dashed ${(p) => (p.$isDragOver ? '#4caf50' : '#4a4a4a')};
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: ${(p) =>
    p.$isDragOver ? 'rgba(76, 175, 80, 0.12)' : '#2e2e2e'};
  transition: border-color 0.2s ease, background 0.2s ease;
  cursor: pointer;
  padding: 2rem;
`;

const UploadIcon = styled(Upload)`
  color: #4caf50;
  margin-bottom: 1rem;
`;

const UploadTitle = styled.h2`
  font-family: Arial, Helvetica, sans-serif;
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: #ffffff;
`;

const UploadSubtitle = styled.p`
  font-size: 0.95rem;
  color: #c8c8c8;
  margin: 0 0 1.25rem;
  text-align: center;
  max-width: 26rem;
  line-height: 1.45;
`;

const FileInput = styled.input`
  display: none;
`;

const ExampleSelect = styled.select`
  background: #212121;
  color: #ffffff;
  border: 1px solid #4a4a4a;
  border-radius: 8px;
  padding: 0.85rem 0.9rem;
  font-size: 0.95rem;
  font-family: Arial, Helvetica, sans-serif;
  min-width: 11rem;
  cursor: pointer;
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  justify-content: center;
`;

const UploadButton = styled(motion.button)`
  background: ${(p) => (p.$secondary ? '#383838' : '#4caf50')};
  color: white;
  border: 1px solid ${(p) => (p.$secondary ? '#4a4a4a' : '#4caf50')};
  padding: 0.85rem 1.75rem;
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: ${(p) => (p.$secondary ? '#4a4a4a' : '#45a049')};
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const ProgressWrap = styled.div`
  width: 100%;
  max-width: 560px;
  margin-top: 1.5rem;
`;

const ProgressBar = styled.div`
  height: 8px;
  background: #383838;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  width: ${(p) => p.$value * 100}%;
  background: #4caf50;
  transition: width 0.15s ease;
`;

const StatusText = styled.div`
  margin-top: 0.6rem;
  font-size: 0.85rem;
  color: #c8c8c8;
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ErrorBox = styled.div`
  margin-top: 1rem;
  padding: 0.85rem 1rem;
  background: #383838;
  color: #e57373;
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
  color: #c8c8c8;
  max-width: 560px;
  text-align: center;
  line-height: 1.4;
`;

const ImageUploader = ({ onUploaded, autoLoad = false }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [status, setStatus] = useState('');
  const [exampleId, setExampleId] = useState(EXAMPLES[0].id);
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

  const apiRef = useRef({});
  apiRef.current = { setLoading, setLoadProgress, setError, setVolume, onUploaded };

  const openExample = useCallback(async (signal) => {
    const api = apiRef.current;
    const chosen = exampleId;
    setStatus('Loading the example study…');
    try {
      await loadExampleStudy(
        {
          setLoading: api.setLoading,
          setLoadProgress: api.setLoadProgress,
          setVolume: api.setVolume,
        },
        chosen,
        {
          signal,
          onStatus: (text) => {
            if (!signal || !signal.aborted) setStatus(text);
          },
        }
      );
      if (!signal || !signal.aborted) api.onUploaded?.();
    } catch (err) {
      if (signal && signal.aborted) return;
      if (err && err.name === 'AbortError') return;
      console.error(err);
      api.setError(err.message || 'The example study could not be loaded.');
      setStatus('');
    } finally {
      if (!signal || !signal.aborted) api.setLoading(false);
    }
  }, [exampleId]);

  useEffect(() => {
    if (!autoLoad) return undefined;
    const controller = new AbortController();
    openExample(controller.signal);
    return () => controller.abort();
  }, [autoLoad, openExample]);

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
        <UploadTitle>MPR</UploadTitle>
        <UploadSubtitle>
          Choose an anonymised example, or open a Philips QLAB Cartesian DICOM
          from this computer. Your file is parsed in this browser and is not
          sent to the server.
        </UploadSubtitle>
        <ButtonRow>
          <ExampleSelect
            value={exampleId}
            disabled={loading}
            aria-label="Example study"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onChange={(e) => setExampleId(e.target.value)}
          >
            {EXAMPLES.map((example) => (
              <option key={example.id} value={example.id}>
                {example.label}
              </option>
            ))}
          </ExampleSelect>
          <UploadButton
            type="button"
            disabled={loading}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={(e) => {
              e.stopPropagation();
              openExample();
            }}
          >
            {loading ? 'Loading…' : 'Load example'}
          </UploadButton>
          <UploadButton
            type="button"
            $secondary
            disabled={loading}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById('file-input').click();
            }}
          >
            Load from computer
          </UploadButton>
        </ButtonRow>
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
