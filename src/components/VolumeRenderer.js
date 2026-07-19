import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getVolumeAtTime, physicalSizeMm } from '../utils/philipsVolume';

const vertexShader = /* glsl */ `
out vec3 vOrigin;
out vec3 vDirection;

uniform vec3 cameraPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vOrigin = (inverse(modelMatrix) * vec4(cameraPos, 1.0)).xyz;
  vDirection = position - vOrigin;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;

in vec3 vOrigin;
in vec3 vDirection;
out vec4 fragColor;

uniform sampler3D map;
uniform float opacity;
uniform float threshold;
uniform float steps;
uniform vec3 clim;
uniform int renderMode;
uniform vec3 cutPlane;
uniform bool useCutPlanes;

vec2 hitBox(vec3 orig, vec3 dir) {
  vec3 boxMin = vec3(-0.5);
  vec3 boxMax = vec3(0.5);
  vec3 invDir = 1.0 / dir;
  vec3 t0 = (boxMin - orig) * invDir;
  vec3 t1 = (boxMax - orig) * invDir;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

void main() {
  vec3 rayDir = normalize(vDirection);
  vec2 bounds = hitBox(vOrigin, rayDir);
  if (bounds.x >= bounds.y) discard;
  bounds.x = max(bounds.x, 0.0);

  vec3 p = vOrigin + bounds.x * rayDir;
  vec3 inc = 1.0 / abs(rayDir);
  float delta = min(inc.x, min(inc.y, inc.z));
  delta /= steps;

  float maxVal = 0.0;
  vec4 ac = vec4(0.0);

  for (float i = 0.0; i < 512.0; i++) {
    if (i >= steps) break;
    vec3 uv = p + 0.5;

    if (all(greaterThanEqual(uv, vec3(0.0))) && all(lessThanEqual(uv, vec3(1.0)))) {
      bool visible = true;
      if (useCutPlanes) {
        if (uv.x < cutPlane.x - 0.002 || uv.y < cutPlane.y - 0.002 || uv.z < cutPlane.z - 0.002) {
          visible = false;
        }
      }

      if (visible) {
        float d = texture(map, uv).r;
        if (renderMode == 0) {
          maxVal = max(maxVal, d);
        } else {
          float intensity = smoothstep(clim.x, clim.y, d);
          float a = intensity * opacity * 0.08;
          vec3 col = vec3(intensity);
          ac.rgb += (1.0 - ac.a) * a * col;
          ac.a += (1.0 - ac.a) * a;
          if (ac.a > 0.95) break;
        }
      }
    }

    p += rayDir * delta;
    if (distance(p, vOrigin) > bounds.y) break;
  }

  if (renderMode == 0) {
    if (maxVal < threshold) discard;
    float intensity = smoothstep(clim.x, clim.y, maxVal);
    fragColor = vec4(vec3(intensity), opacity * intensity);
  } else {
    if (ac.a < 0.01) discard;
    fragColor = ac;
  }
}
`;

function VolumeMesh({
  volume,
  timeIndex,
  windowCenter,
  windowWidth,
  opacity,
  renderMode,
  crosshair,
  useCutPlanes,
}) {
  const materialRef = useRef();

  const sizeMm = useMemo(() => physicalSizeMm(volume), [volume]);
  const maxDim = Math.max(sizeMm.x, sizeMm.y, sizeMm.z);
  const scale = useMemo(
    () => [sizeMm.x / maxDim, sizeMm.y / maxDim, sizeMm.z / maxDim],
    [sizeMm, maxDim]
  );

  const texture = useMemo(() => {
    const { dims } = volume;
    const data = getVolumeAtTime(volume, timeIndex);
    const tex = new THREE.Data3DTexture(data, dims.x, dims.y, dims.z);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }, [volume, timeIndex]);

  useEffect(() => () => texture.dispose(), [texture]);

  const clim = useMemo(() => {
    const wc = windowCenter ?? 128;
    const ww = Math.max(1, windowWidth ?? 256);
    const min = Math.max(0, (wc - ww / 2) / 255);
    const max = Math.min(1, (wc + ww / 2) / 255);
    return new THREE.Vector3(min, max, 0);
  }, [windowCenter, windowWidth]);

  const cutPlane = useMemo(() => {
    return new THREE.Vector3(
      (crosshair.x + 0.5) / volume.dims.x,
      (crosshair.y + 0.5) / volume.dims.y,
      (crosshair.z + 0.5) / volume.dims.z
    );
  }, [volume, crosshair]);

  useFrame(({ camera }) => {
    if (materialRef.current) {
      materialRef.current.uniforms.cameraPos.value.copy(camera.position);
    }
  });

  const uniforms = useMemo(
    () => ({
      map: { value: texture },
      cameraPos: { value: new THREE.Vector3() },
      opacity: { value: opacity },
      threshold: { value: 0.05 },
      steps: { value: 180 },
      clim: { value: clim },
      renderMode: { value: renderMode },
      cutPlane: { value: cutPlane },
      useCutPlanes: { value: useCutPlanes },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.map.value = texture;
    u.opacity.value = opacity;
    u.clim.value = clim;
    u.renderMode.value = renderMode;
    u.cutPlane.value = cutPlane;
    u.useCutPlanes.value = useCutPlanes;
  }, [texture, opacity, clim, renderMode, cutPlane, useCutPlanes]);

  return (
    <mesh scale={scale}>
      <boxGeometry args={[1, 1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
        glslVersion={THREE.GLSL3}
      />
    </mesh>
  );
}

const VolumeRenderer = ({
  volume,
  timeIndex,
  windowCenter,
  windowWidth,
  opacity = 0.9,
  renderMode = 0,
  crosshair,
  useCutPlanes = false,
}) => {
  if (!volume) return null;

  return (
    <>
      <VolumeMesh
        volume={volume}
        timeIndex={timeIndex}
        windowCenter={windowCenter}
        windowWidth={windowWidth}
        opacity={opacity}
        renderMode={renderMode}
        crosshair={crosshair}
        useCutPlanes={useCutPlanes}
      />
      <OrbitControls makeDefault enablePan enableZoom enableRotate />
    </>
  );
};

export default VolumeRenderer;
