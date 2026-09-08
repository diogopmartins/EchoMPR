import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
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
uniform int renderMode;
uniform int colorStyle;
uniform vec3 cutPlane;
uniform bool useCutPlanes;
uniform vec3 lightPos;
uniform float lightIntensity;
uniform float ambient;
uniform float specularPower;
uniform vec3 volumeDims;
uniform vec3 volumeScale;
uniform vec2 resolution;
uniform vec3 bgColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hitBox(vec3 orig, vec3 dir, vec3 bmin, vec3 bmax) {
  vec3 invDir = 1.0 / dir;
  vec3 t0 = (bmin - orig) * invDir;
  vec3 t1 = (bmax - orig) * invDir;
  vec3 tmin = min(t0, t1);
  vec3 tmax = max(t0, t1);
  float tNear = max(max(tmin.x, tmin.y), tmin.z);
  float tFar = min(min(tmax.x, tmax.y), tmax.z);
  return vec2(tNear, tFar);
}

bool inUnit(vec3 uv) {
  return all(greaterThanEqual(uv, vec3(0.0))) && all(lessThanEqual(uv, vec3(1.0)));
}

float sampleDensity(vec3 uv) {
  return texture(map, uv).r;
}

vec3 sampleGradient(vec3 uv) {
  vec3 e = 1.0 / max(volumeDims, vec3(1.0));
  float dx = sampleDensity(uv + vec3(e.x, 0.0, 0.0)) - sampleDensity(uv - vec3(e.x, 0.0, 0.0));
  float dy = sampleDensity(uv + vec3(0.0, e.y, 0.0)) - sampleDensity(uv - vec3(0.0, e.y, 0.0));
  float dz = sampleDensity(uv + vec3(0.0, 0.0, e.z)) - sampleDensity(uv - vec3(0.0, 0.0, e.z));
  return vec3(dx, dy, dz) / max(volumeScale, vec3(0.05));
}

vec3 philipsHeat(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.18, 0.06, 0.04);
  vec3 c1 = vec3(0.62, 0.22, 0.10);
  vec3 c2 = vec3(0.92, 0.52, 0.28);
  vec3 c3 = vec3(1.00, 0.78, 0.55);
  vec3 c4 = vec3(1.00, 0.93, 0.82);
  if (t < 0.22) return mix(c0, c1, t / 0.22);
  if (t < 0.48) return mix(c1, c2, (t - 0.22) / 0.26);
  if (t < 0.75) return mix(c2, c3, (t - 0.48) / 0.27);
  return mix(c3, c4, (t - 0.75) / 0.25);
}

vec3 transillumination(vec3 pos, vec3 toLight) {
  vec3 p = pos + toLight * 0.025;
  float od = 0.0;
  float dt = 0.055;
  for (int i = 0; i < 8; i++) {
    p += toLight * dt;
    vec3 uv = p + 0.5;
    if (!inUnit(uv)) break;
    if (useCutPlanes && (uv.x < cutPlane.x || uv.y < cutPlane.y || uv.z < cutPlane.z)) continue;
    float intensity = smoothstep(clim.x + 0.05, clim.y, sampleDensity(uv));
    od += intensity * dt * 3.0;
  }
  return exp(-od * vec3(0.35, 0.8, 1.35));
}

vec3 filmic(vec3 x) {
  x = max(x, vec3(0.0)) * 1.35;
  return pow(clamp(x, vec3(0.0), vec3(1.15)), vec3(0.88));
}

void main() {
  vec3 rayDir = normalize(vDirection);
  vec3 bmin = vec3(-0.5);
  vec3 bmax = vec3(0.5);
  if (useCutPlanes) {
    bmin = max(bmin, cutPlane - 0.5);
  }
  vec2 bounds = hitBox(vOrigin, rayDir, bmin, bmax);
  if (bounds.x >= bounds.y) {
    fragColor = vec4(bgColor, 1.0);
    return;
  }
  bounds.x = max(bounds.x, 0.0);

  vec3 inc = 1.0 / abs(rayDir);
  float delta = min(inc.x, min(inc.y, inc.z)) / max(steps, 8.0);
  float jitter = hash12(gl_FragCoord.xy) * 0.22;
  vec3 p = vOrigin + (bounds.x + jitter * delta) * rayDir;
  float rayLen = max(bounds.y - bounds.x, 1e-4);

  float maxVal = 0.0;
  vec3 maxPos = p;
  vec4 ac = vec4(0.0);

  float glassOpacity = clamp(opacity, 0.18, 1.0);
  float solidScale = opacity * (colorStyle == 1 ? 0.28 : 0.18);
  float localThreshold = colorStyle == 2 ? 0.06 : max(threshold, 0.04);
  bool firstHit = true;

  for (float i = 0.0; i < 512.0; i++) {
    if (i >= steps) break;
    vec3 uv = p + 0.5;

    if (inUnit(uv)) {
      bool visible = true;
      if (useCutPlanes && (uv.x < cutPlane.x - 0.001 || uv.y < cutPlane.y - 0.001 || uv.z < cutPlane.z - 0.001)) {
        visible = false;
      }

      if (visible) {
        float d = sampleDensity(uv);
        float lo = clim.x + (colorStyle == 2 ? 0.07 : 0.03);
        float intensity = smoothstep(lo, clim.y, d);
        intensity = pow(intensity, colorStyle == 2 ? 1.35 : 1.05);

        if (renderMode == 0) {
          if (d > maxVal) {
            maxVal = d;
            maxPos = p;
          }
        } else if (intensity > localThreshold * 0.45) {
          vec3 grad = sampleGradient(uv);
          float gLen = length(grad);
          vec3 N = gLen > 1e-4 ? normalize(grad) : -rayDir;
          vec3 viewDir = -rayDir;
          vec3 toLight = normalize(lightPos - p);
          float wrap = clamp((dot(N, toLight) + 0.38) / 1.38, 0.0, 1.0);
          float ndotl = wrap * lightIntensity;
          float fresnel = pow(1.0 - clamp(abs(dot(N, viewDir)), 0.0, 1.0), 2.4);
          float depthFog = clamp((distance(p, vOrigin) - bounds.x) / rayLen, 0.0, 1.0);
          float surface = smoothstep(0.018, 0.14, gLen);
          vec3 beer = transillumination(p, toLight);

          if (firstHit && useCutPlanes) {
            vec3 sliceCol = colorStyle == 0
              ? vec3(intensity)
              : (colorStyle == 1 ? philipsHeat(intensity) : mix(vec3(0.18, 0.38, 0.72), vec3(0.96, 0.70, 0.48), intensity));
            float sa = clamp(intensity * 0.62, 0.0, 0.72);
            ac.rgb += (1.0 - ac.a) * sa * sliceCol * (0.55 + 0.45 * ndotl);
            ac.a += (1.0 - ac.a) * sa;
          }
          firstHit = false;

          if (colorStyle == 2) {
            vec3 peach = vec3(1.00, 0.78, 0.56);
            vec3 copper = vec3(0.90, 0.42, 0.22);
            vec3 blueHi = vec3(0.38, 0.68, 1.00);
            vec3 blueLo = vec3(0.04, 0.14, 0.40);
            vec3 warm = mix(copper, peach, clamp(intensity * 0.55 + ndotl * 0.45, 0.0, 1.0));
            vec3 cool = mix(blueLo, blueHi, clamp(fresnel * 0.55 + (1.0 - wrap) * 0.45, 0.0, 1.0));
            float frontness = mix(0.12, 1.0, wrap) * (1.0 - depthFog * 0.55);
            vec3 col = mix(cool, warm, frontness);
            col *= mix(vec3(0.70, 0.82, 1.05), vec3(1.08, 1.0, 0.92), beer);
            vec3 H = normalize(toLight + viewDir);
            float spec = pow(max(dot(N, H), 0.0), 36.0) * surface * lightIntensity * 0.55;
            col += vec3(1.0, 0.97, 0.90) * spec;

            float tissue = smoothstep(0.05, 0.28, intensity);
            float a = tissue * mix(0.012, 0.14, pow(surface, 0.55)) * glassOpacity;
            a *= (1.0 - ac.a * 0.28);
            ac.rgb += (1.0 - ac.a) * a * col;
            ac.a += (1.0 - ac.a) * a;
            if (ac.a > 0.86) break;
          } else {
            vec3 base = colorStyle == 1 ? philipsHeat(intensity) : vec3(pow(intensity, 0.85));
            if (colorStyle == 1) {
              vec3 deep = vec3(0.42, 0.10, 0.06);
              base = mix(base, deep, depthFog * 0.45);
              base *= mix(vec3(0.55, 0.28, 0.16), vec3(1.05, 0.95, 0.85), beer);
            } else {
              base *= mix(0.45, 1.0, beer.g);
            }
            float diff = ambient + ndotl * (0.55 + 0.45 * surface);
            vec3 H = normalize(toLight + viewDir);
            float spec = pow(max(dot(N, H), 0.0), specularPower) * surface * lightIntensity * 0.28;
            vec3 col = base * diff + vec3(1.0, 0.96, 0.9) * spec;
            col += base * fresnel * 0.12;

            float a = pow(intensity, 1.25) * mix(0.45, 1.55, surface) * solidScale;
            ac.rgb += (1.0 - ac.a) * a * col;
            ac.a += (1.0 - ac.a) * a;
            if (ac.a > 0.97) break;
          }
        }
      }
    }

    p += rayDir * delta;
    if (distance(p, vOrigin) > bounds.y) break;
  }

  vec3 outRgb;
  float outA;

  if (renderMode == 0) {
    if (maxVal < localThreshold) {
      fragColor = vec4(bgColor, 1.0);
      return;
    }
    float intensity = smoothstep(clim.x, clim.y, maxVal);
    vec3 uv = maxPos + 0.5;
    vec3 grad = sampleGradient(uv);
    vec3 N = length(grad) > 1e-4 ? normalize(grad) : -rayDir;
    vec3 toLight = normalize(lightPos - maxPos);
    float wrap = clamp((dot(N, toLight) + 0.3) / 1.3, 0.0, 1.0);
    vec3 beer = transillumination(maxPos, toLight);
    vec3 col;
    if (colorStyle == 2) {
      col = mix(vec3(0.10, 0.28, 0.62), vec3(0.96, 0.68, 0.46), intensity * wrap);
      col *= mix(vec3(0.6, 0.8, 1.0), vec3(1.0), beer);
      outA = clamp(intensity * glassOpacity * 0.9, 0.0, 0.92);
    } else if (colorStyle == 1) {
      col = philipsHeat(intensity) * (ambient + wrap * lightIntensity);
      col *= mix(vec3(0.55, 0.28, 0.16), vec3(1.0), beer);
      outA = clamp(opacity * intensity, 0.0, 1.0);
    } else {
      col = vec3(intensity) * (ambient + wrap * lightIntensity) * mix(0.5, 1.0, beer.g);
      outA = clamp(opacity * intensity, 0.0, 1.0);
    }
    outRgb = col * outA;
  } else {
    if (ac.a < 0.004) {
      fragColor = vec4(bgColor, 1.0);
      return;
    }
    outRgb = ac.rgb;
    outA = colorStyle == 2 ? min(ac.a, 0.93) : ac.a;
  }

  vec2 q = gl_FragCoord.xy / max(resolution, vec2(1.0));
  float vig = smoothstep(1.18, 0.22, length(q - 0.5));
  outRgb *= mix(0.84, 1.0, vig);
  vec3 composed = filmic(outRgb) + (1.0 - outA) * bgColor;
  fragColor = vec4(composed, 1.0);
}
`;

const STYLE_MAP = { gray: 0, philips: 1, glass: 2 };
const MODE_MAP = { mip: 0, dvr: 1 };

const STYLE_BG = {
  glass: '#061018',
  philips: '#0a0706',
  gray: '#05070a',
};

const STYLE_BG_VEC = {
  glass: new THREE.Color('#061018'),
  philips: new THREE.Color('#0a0706'),
  gray: new THREE.Color('#05070a'),
};

function VolumeFrame({ useCutPlanes, cutPlane }) {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges]
  );

  const minx = useCutPlanes ? cutPlane.x - 0.5 : -0.5;
  const miny = useCutPlanes ? cutPlane.y - 0.5 : -0.5;
  const minz = useCutPlanes ? cutPlane.z - 0.5 : -0.5;
  const size = [0.5 - minx, 0.5 - miny, 0.5 - minz];
  const pos = [(minx + 0.5) / 2, (miny + 0.5) / 2, (minz + 0.5) / 2];

  return (
    <lineSegments position={pos} scale={size} geometry={edges}>
      <lineBasicMaterial color="#5ec8b8" transparent opacity={0.38} />
    </lineSegments>
  );
}

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
  interactive,
}) {
  const materialRef = useRef();
  const { gl, size } = useThree();

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

  const volumeScale = useMemo(
    () => new THREE.Vector3(scale[0], scale[1], scale[2]),
    [scale]
  );

  const texture = useMemo(() => {
    const { dims } = volume;
    const data = getVolumeAtTime(volume, timeIndex);
    const tex = new THREE.Data3DTexture(data, dims.x, dims.y, dims.z);
    tex.format = THREE.RedFormat;
    tex.type = THREE.UnsignedByteType;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.unpackAlignment = 1;
    tex.colorSpace = THREE.NoColorSpace;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
    // timeIndex is applied in the effect below so cine does not rebuild the texture
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [volume]);

  useEffect(() => {
    const data = getVolumeAtTime(volume, timeIndex);
    texture.image.data = data;
    texture.needsUpdate = true;
  }, [volume, timeIndex, texture]);

  useEffect(() => () => texture.dispose(), [texture]);

  const clim = useMemo(() => {
    const wc = windowCenter ?? 100;
    const ww = Math.max(1, windowWidth ?? 160);
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

  const lightPos = useMemo(
    () => lightDir.clone().multiplyScalar(0.82),
    [lightDir]
  );

  const stepCount = interactive
    ? colorStyle === 'glass'
      ? 180
      : 140
    : colorStyle === 'glass'
      ? 420
      : 320;

  useEffect(() => {
    const bg = STYLE_BG[colorStyle] || STYLE_BG.glass;
    gl.setClearColor(bg, 1);
  }, [gl, colorStyle]);

  useFrame(({ camera }) => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.cameraPos.value.copy(camera.position);
    u.resolution.value.set(size.width, size.height);
  });

  const uniforms = useMemo(
    () => ({
      map: { value: texture },
      cameraPos: { value: new THREE.Vector3() },
      opacity: { value: opacity },
      threshold: { value: 0.035 },
      steps: { value: stepCount },
      clim: { value: clim },
      renderMode: { value: MODE_MAP[renderMode] ?? 1 },
      colorStyle: { value: STYLE_MAP[colorStyle] ?? 2 },
      cutPlane: { value: cutPlane },
      useCutPlanes: { value: useCutPlanes },
      lightPos: { value: lightPos },
      lightIntensity: { value: lightIntensity },
      ambient: { value: colorStyle === 'glass' ? 0.42 : 0.26 },
      specularPower: { value: colorStyle === 'glass' ? 48.0 : 26.0 },
      volumeDims: { value: volumeDims },
      volumeScale: { value: volumeScale },
      resolution: { value: new THREE.Vector2(size.width, size.height) },
      bgColor: { value: STYLE_BG_VEC[colorStyle] || STYLE_BG_VEC.glass },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!materialRef.current) return;
    const u = materialRef.current.uniforms;
    u.map.value = texture;
    u.opacity.value = opacity;
    u.threshold.value = 0.035;
    u.steps.value = stepCount;
    u.clim.value = clim;
    u.renderMode.value = MODE_MAP[renderMode] ?? 1;
    u.colorStyle.value = STYLE_MAP[colorStyle] ?? 2;
    u.cutPlane.value = cutPlane;
    u.useCutPlanes.value = useCutPlanes;
    u.lightPos.value = lightPos;
    u.lightIntensity.value = lightIntensity;
    u.ambient.value = colorStyle === 'glass' ? 0.42 : 0.26;
    u.specularPower.value = colorStyle === 'glass' ? 48.0 : 26.0;
    u.volumeDims.value = volumeDims;
    u.volumeScale.value = volumeScale;
    u.bgColor.value = STYLE_BG_VEC[colorStyle] || STYLE_BG_VEC.glass;
  }, [
    texture,
    opacity,
    clim,
    renderMode,
    colorStyle,
    cutPlane,
    useCutPlanes,
    lightPos,
    lightIntensity,
    volumeDims,
    volumeScale,
    stepCount,
  ]);

  return (
    <group scale={scale}>
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <shaderMaterial
          ref={materialRef}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          side={THREE.BackSide}
          transparent={false}
          depthWrite
          toneMapped={false}
          glslVersion={THREE.GLSL3}
        />
      </mesh>
      <VolumeFrame useCutPlanes={useCutPlanes} cutPlane={cutPlane} />
      <axesHelper args={[0.16]} position={[-0.46, -0.46, -0.46]} />
      <mesh position={lightPos}>
        <sphereGeometry args={[0.028, 16, 16]} />
        <meshBasicMaterial color="#ffe6c4" transparent opacity={0.85} />
      </mesh>
    </group>
  );
}

const VolumeRenderer = ({
  volume,
  timeIndex,
  windowCenter,
  windowWidth,
  opacity = 0.55,
  renderMode = 'dvr',
  colorStyle = 'glass',
  crosshair,
  useCutPlanes = false,
  lightAzimuth = 30,
  lightElevation = 48,
  lightIntensity = 1.35,
}) => {
  const [interactive, setInteractive] = useState(false);

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
        interactive={interactive}
      />
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        rotateSpeed={0.72}
        zoomSpeed={0.85}
        onStart={() => setInteractive(true)}
        onEnd={() => setInteractive(false)}
      />
    </>
  );
};

export default VolumeRenderer;
export { STYLE_BG };
