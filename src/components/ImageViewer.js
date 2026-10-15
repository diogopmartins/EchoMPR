import React, { useEffect, useRef, useState } from 'react';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { ZoomIn, ZoomOut, RotateCw, Maximize, Settings, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEcho } from '../context/EchoContext';
import { createImageFromDicom } from '../utils/dicomParser';

const ViewerContainer = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #000;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(255, 255, 255, 0.2);
`;

const ToolGroup = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const ToolButton = styled(motion.button)`
  background: rgba(255, 255, 255, 0.2);
  border: none;
  border-radius: 8px;
  padding: 0.5rem;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.3);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ImageInfo = styled.div`
  color: white;
  font-size: 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
`;

const ViewerArea = styled.div`
  flex: 1;
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const ImageCanvas = styled.canvas`
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
`;

const NavigationOverlay = styled.div`
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  transform: translateY(-50%);
  display: flex;
  justify-content: space-between;
  padding: 0 1rem;
  pointer-events: none;
`;

const NavButton = styled(motion.button)`
  background: rgba(0, 0, 0, 0.7);
  border: none;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  transition: all 0.2s ease;

  &:hover {
    background: rgba(0, 0, 0, 0.9);
    transform: scale(1.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 1.2rem;
`;

const ImageViewer = () => {
  const canvasRef = useRef(null);
  const { images, currentImage, setCurrentImage, loading } = useEcho();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [windowLevel, setWindowLevel] = useState({ center: 128, width: 256 });

  useEffect(() => {
    if (images.length > 0 && !currentImage) {
      setCurrentImage(images[0]);
      setCurrentIndex(0);
    }
  }, [images, currentImage, setCurrentImage]);

  useEffect(() => {
    if (!currentImage || !canvasRef.current) return;

    try {
      const canvas = createImageFromDicom(currentImage);
      const ctx = canvasRef.current.getContext('2d');
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.save();
      ctx.translate(canvasRef.current.width / 2, canvasRef.current.height / 2);
      ctx.scale(zoom, zoom);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
      ctx.restore();
    } catch (error) {
      console.error('Error rendering image:', error);
    }
  }, [currentImage, zoom, rotation, windowLevel]);

  const nextImage = () => {
    if (currentIndex < images.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      setCurrentImage(images[newIndex]);
    }
  };

  const previousImage = () => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      setCurrentImage(images[newIndex]);
    }
  };

  const zoomIn = () => {
    setZoom(prev => Math.min(prev * 1.2, 5));
  };

  const zoomOut = () => {
    setZoom(prev => Math.max(prev / 1.2, 0.1));
  };

  const rotateImage = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const resetView = () => {
    setZoom(1);
    setRotation(0);
    setWindowLevel({ center: 128, width: 256 });
  };

  const fullscreen = () => {
    if (canvasRef.current) {
      if (canvasRef.current.requestFullscreen) {
        canvasRef.current.requestFullscreen();
      }
    }
  };

  if (images.length === 0) {
    return (
      <ViewerContainer>
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          height: '100%', 
          color: 'white',
          fontSize: '1.2rem'
        }}>
          No images loaded. Please upload DICOM files first.
        </div>
      </ViewerContainer>
    );
  }

  return (
    <ViewerContainer>
      <Toolbar>
        <ToolGroup>
          <ToolButton onClick={zoomOut} disabled={zoom <= 0.1}>
            <ZoomOut size={20} />
          </ToolButton>
          <ToolButton onClick={zoomIn} disabled={zoom >= 5}>
            <ZoomIn size={20} />
          </ToolButton>
          <ToolButton onClick={rotateImage}>
            <RotateCw size={20} />
          </ToolButton>
          <ToolButton onClick={resetView}>
            <Settings size={20} />
          </ToolButton>
          <ToolButton onClick={fullscreen}>
            <Maximize size={20} />
          </ToolButton>
        </ToolGroup>

        <ImageInfo>
          <div>Image {currentIndex + 1} of {images.length}</div>
          {currentImage && (
            <>
              <div>Zoom: {zoom.toFixed(2)}x</div>
              <div>Rotation: {rotation}°</div>
            </>
          )}
        </ImageInfo>

        <ToolGroup>
          <ToolButton onClick={previousImage} disabled={currentIndex === 0}>
            <ChevronLeft size={20} />
          </ToolButton>
          <ToolButton onClick={nextImage} disabled={currentIndex === images.length - 1}>
            <ChevronRight size={20} />
          </ToolButton>
        </ToolGroup>
      </Toolbar>

      <ViewerArea>
        {loading && (
          <LoadingOverlay>
            Loading image...
          </LoadingOverlay>
        )}
        
        <ImageCanvas
          ref={canvasRef}
          width={800}
          height={600}
        />

        <NavigationOverlay>
          <NavButton
            onClick={previousImage}
            disabled={currentIndex === 0}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronLeft size={24} />
          </NavButton>
          <NavButton
            onClick={nextImage}
            disabled={currentIndex === images.length - 1}
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
          >
            <ChevronRight size={24} />
          </NavButton>
        </NavigationOverlay>
      </ViewerArea>
    </ViewerContainer>
  );
};

export default ImageViewer;
