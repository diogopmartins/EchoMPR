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
uniform int renderMode;   // 0 = MIP, 1 = DVR
uniform int colorStyle;   // 0 = gray, 1 = philips, 2 = glass
uniform vec3 cutPlane;
uniform bool useCutPlanes;
uniform vec3 lightDir;
uniform float lightIntensity;
uniform float ambient;
uniform float specularPower;
uniform vec3 volumeDims;

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

float sampleDensity(vec3 uv) {
  return texture(map, uv).r;
}

vec3 sampleGradient(vec3 uv) {
  vec3 e = 1.25 / max(volumeDims, vec3(1.0));
  float dx = sampleDensity(uv + vec3(e.x, 0.0, 0.0)) - sampleDensity(uv - vec3(e.x, 0.0, 0.0));
  float dy = sampleDensity(uv + vec3(0.0, e.y, 0.0)) - sampleDensity(uv - vec3(0.0, e.y, 0.0));
  float dz = sampleDensity(uv + vec3(0.0, 0.0, e.z)) - sampleDensity(uv - vec3(0.0, 0.0, e.z));
  return vec3(dx, dy, dz);
}

// Philips QLAB-like warm tissue LUT (black → brown → copper → peach → cream)
vec3 philipsColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.02, 0.01, 0.01);
  vec3 c1 = vec3(0.28, 0.08, 0.04);
  vec3 c2 = vec3(0.72, 0.32, 0.12);
  vec3 c3 = vec3(0.95, 0.62, 0.38);
  vec3 c4 = vec3(1.0, 0.92, 0.78);
  if (t < 0.25) return mix(c0, c1, t / 0.25);
  if (t < 0.5) return mix(c1, c2, (t - 0.25) / 0.25);
  if (t < 0.75) return mix(c2, c3, (t - 0.5) / 0.25);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

// Translucent glass / crystal tissue
vec3 glassColor(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 deep = vec3(0.05, 0.12, 0.18);
  vec3 mid = vec3(0.25, 0.55, 0.62);
  vec3 hi = vec3(0.85, 0.95, 1.0);
  if (t < 0.55) return mix(deep, mid, t / 0.55);
  return mix(mid, hi, (t - 0.55) / 0.45);
}

vec3 applyStyle(float t) {
  if (colorStyle == 1) return philipsColor(t);
  if (colorStyle == 2) return glassColor(t);
  return vec3(t);
}

vec3 shade(vec3 base, vec3 grad, vec3 viewDir) {
  float gLen = length(grad);
  if (gLen < 1e-4) {
    return base * (ambient + 0.15 * lightIntensity);
  }
  vec3 N = normalize(grad);
  // Two-sided lighting (ultrasound volumes have no consistent outside)
  float ndotl = abs(dot(N, normalize(lightDir)));
  vec3 H = normalize(normalize(lightDir) + normalize(viewDir));
  float spec = pow(abs(dot(N, H)), specularPower);

  float diffuse = ambient + lightIntensity * ndotl;
  float rim = 0.0;
  if (colorStyle == 2) {
    rim = pow(1.0 - abs(dot(N, normalize(viewDir))), 2.2) * 0.55;
  }

  vec3 lit = base * diffuse + vec3(1.0) * spec * lightIntensity * 0.45 + vec3(0.7, 0.9, 1.0) * rim;
  return lit;
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
  vec3 maxPos = p;
  vec4 ac = vec4(0.0);

  // Glass uses thinner accumulation; Philips DVR denser tissue
  float alphaScale = colorStyle == 2 ? 0.035 : (colorStyle == 1 ? 0.11 : 0.08);
  alphaScale *= opacity;

  for (float i = 0.0; i < 640.0; i++) {
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
        float d = sampleDensity(uv);
        float intensity = smoothstep(clim.x, clim.y, d);

        if (renderMode == 0) {
          if (d > maxVal) {
            maxVal = d;
            maxPos = p;
          }
        } else if (intensity > threshold) {
          vec3 grad = sampleGradient(uv);
          vec3 base = applyStyle(intensity);
          vec3 col = shade(base, grad, -rayDir);
          float a = intensity * alphaScale;
          if (colorStyle == 2) {
            a *= mix(0.35, 1.0, intensity);
          }
          ac.rgb += (1.0 - ac.a) * a * col;
          ac.a += (1.0 - ac.a) * a;
          if (ac.a > 0.97) break;
        }
      }
    }

    p += rayDir * delta;
    if (distance(p, vOrigin) > bounds.y) break;
  }

  if (renderMode == 0) {
    if (maxVal < threshold) discard;
    float intensity = smoothstep(clim.x, clim.y, maxVal);
    vec3 uv = maxPos + 0.5;
    vec3 grad = sampleGradient(uv);
    vec3 base = applyStyle(intensity);
    vec3 col = shade(base, grad, -rayDir);
    fragColor = vec4(col, clamp(opacity * mix(0.4, 1.0, intensity), 0.0, 1.0));
  } else {
    if (ac.a < 0.01) discard;
    fragColor = vec4(ac.rgb, ac.a);
  }
}
`;

const STYLE_MAP = { gray: 0, philips: 1, glass: 2 };
const MODE_MAP = { mip: 0, dvr: 1 };

function VolumeMesh({
  volume,
  timeIndex,
  windowCenter,
  windowWidth,
  opacity,
  renderMode,
  colorStyle,
  crosshair,
  useCutPlanes,
  lightAzimuth,
  lightElevation,
  lightIntensity,
}) {
  const materialRef = useRef();

  const sizeMm = useMemo(() => physicalSizeMm(volume), [volume]);
  const maxDim = Math.max(sizeMm.x, sizeMm.y, sizeMm.z);
  const scale = useMemo(
    () => [sizeMm.x / maxDim, sizeMm.y / maxDim, sizeMm.z / maxDim],
    [sizeMm, maxDim]
  );

  const volumeDims = useMemo(
    () => new THREE.Vector3(volume.dims.x, volume.dims.y, volume.dims.z),
    [volume.dims]
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

  const cutPlane = useMemo(
    () =>
      new THREE.Vector3(
        (crosshair.x + 0.5) / volume.dims.x,
        (crosshair.y + 0.5) / volume.dims.y,
        (crosshair.z + 0.5) / volume.dims.z
      ),
    [volume, crosshair]
  );

  const lightDir = useMemo(() => {
    const az = (lightAzimuth * Math.PI) / 180;
    const el = (lightElevation * Math.PI) / 180;
    const cosEl = Math.cos(el);
    return new THREE.Vector3(
      cosEl * Math.sin(az),
      Math.sin(el),
      cosEl * Math.cos(az)
    ).normalize();
  }, [lightAzimuth, lightElevation]);

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
      threshold: { value: colorStyle === 'glass' ? 0.08 : 0.04 },
      steps: { value: colorStyle === 'glass' ? 220 : 200 },
      clim: { value: clim },
      renderMode: { value: MODE_MAP[renderMode] ?? 1 },
      colorStyle: { value: STYLE_MAP[colorStyle] ?? 1 },
      cutPlane: { value: cutPlane },
      useCutPlanes: { value: useCutPlanes },
      lightDir: { value: lightDir },
      lightIntensity: { value: lightIntensity },
      ambient: { value: colorStyle === 'glass' ? 0.22 : 0.28 },
      specularPower: { value: colorStyle === 'glass' ? 48.0 : 22.0 },
      volumeDims: { value: volumeDims },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.map.value = texture;
    u.opacity.value = opacity;
    u.threshold.value = colorStyle === 'glass' ? 0.08 : 0.04;
    u.steps.value = colorStyle === 'glass' ? 220 : 200;
    u.clim.value = clim;
    u.renderMode.value = MODE_MAP[renderMode] ?? 1;
    u.colorStyle.value = STYLE_MAP[colorStyle] ?? 1;
    u.cutPlane.value = cutPlane;
    u.useCutPlanes.value = useCutPlanes;
    u.lightDir.value = lightDir;
    u.lightIntensity.value = lightIntensity;
    u.ambient.value = colorStyle === 'glass' ? 0.22 : 0.28;
    u.specularPower.value = colorStyle === 'glass' ? 48.0 : 22.0;
    u.volumeDims.value = volumeDims;
  }, [
    texture,
    opacity,
    clim,
    renderMode,
    colorStyle,
    cutPlane,
    useCutPlanes,
    lightDir,
    lightIntensity,
    volumeDims,
  ]);

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
  renderMode = 'dvr',
  colorStyle = 'philips',
  crosshair,
  useCutPlanes = false,
  lightAzimuth = 35,
  lightElevation = 40,
  lightIntensity = 1.1,
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
        colorStyle={colorStyle}
        crosshair={crosshair}
        useCutPlanes={useCutPlanes}
        lightAzimuth={lightAzimuth}
        lightElevation={lightElevation}
        lightIntensity={lightIntensity}
      />
      <OrbitControls makeDefault enablePan enableZoom enableRotate />
    </>
  );
};

export default VolumeRenderer;
