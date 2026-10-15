import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getVolumeAtTime, physicalSizeMm } from '../utils/philipsVolume';
import { mmToUnitBox, voxelToMm } from '../utils/mprGeometry';
import { localToWorld, valveFrames } from '../utils/valveModel';

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
uniform float stepScale;
uniform vec3 clim;
uniform int renderMode;
uniform int colorStyle;
uniform vec3 cropOrigin;
uniform vec3 cropNormal;
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

// Linear texture filter plus a neighborhood blend so voxels fuse
// instead of rendering as a dotted grid with gaps between them.
float sampleDensity(vec3 uv) {
  vec3 texel = 1.0 / max(volumeDims, vec3(1.0));
  float c = texture(map, uv).r;
  float px = texture(map, uv + vec3(texel.x, 0.0, 0.0)).r;
  float nx = texture(map, uv - vec3(texel.x, 0.0, 0.0)).r;
  float py = texture(map, uv + vec3(0.0, texel.y, 0.0)).r;
  float ny = texture(map, uv - vec3(0.0, texel.y, 0.0)).r;
  float pz = texture(map, uv + vec3(0.0, 0.0, texel.z)).r;
  float nz = texture(map, uv - vec3(0.0, 0.0, texel.z)).r;
  float avg = c * 0.34 + (px + nx + py + ny + pz + nz) * 0.11;
  float peak = max(c, max(max(px, nx), max(max(py, ny), max(pz, nz))));
  return mix(avg, peak, 0.42);
}

float sampleRaw(vec3 uv) {
  return texture(map, uv).r;
}

float voxelStep(vec3 dir) {
  vec3 ad = abs(dir);
  vec3 vs = 1.0 / max(volumeDims, vec3(1.0));
  vec3 t = vs / max(ad, vec3(1e-5));
  return min(t.x, min(t.y, t.z)) * max(stepScale, 0.25);
}

vec3 sampleGradient(vec3 uv) {
  vec3 e = 1.0 / max(volumeDims, vec3(1.0));
  float dx = sampleRaw(uv + vec3(e.x, 0.0, 0.0)) - sampleRaw(uv - vec3(e.x, 0.0, 0.0));
  float dy = sampleRaw(uv + vec3(0.0, e.y, 0.0)) - sampleRaw(uv - vec3(0.0, e.y, 0.0));
  float dz = sampleRaw(uv + vec3(0.0, 0.0, e.z)) - sampleRaw(uv - vec3(0.0, 0.0, e.z));
  return vec3(dx, dy, dz) / max(volumeScale, vec3(0.05));
}

// Philips Live 3D depth bar: near cream/yellow → gold → orange → far dark brown.
vec3 philipsDepth(float far) {
  far = clamp(far, 0.0, 1.0);
  vec3 c0 = vec3(0.99, 0.96, 0.80);
  vec3 c1 = vec3(0.98, 0.80, 0.26);
  vec3 c2 = vec3(0.92, 0.50, 0.12);
  vec3 c3 = vec3(0.68, 0.26, 0.08);
  vec3 c4 = vec3(0.30, 0.09, 0.04);
  vec3 c5 = vec3(0.03, 0.01, 0.008);
  if (far < 0.16) return mix(c0, c1, far / 0.16);
  if (far < 0.36) return mix(c1, c2, (far - 0.16) / 0.20);
  if (far < 0.58) return mix(c2, c3, (far - 0.36) / 0.22);
  if (far < 0.80) return mix(c3, c4, (far - 0.58) / 0.22);
  return mix(c4, c5, (far - 0.80) / 0.20);
}

vec3 transillumination(vec3 pos, vec3 toLight) {
  vec3 p = pos + toLight * 0.025;
  float od = 0.0;
  float dt = 0.055;
  for (int i = 0; i < 8; i++) {
    p += toLight * dt;
    vec3 uv = p + 0.5;
    if (!inUnit(uv)) break;
    if (useCutPlanes && dot(p - cropOrigin, cropNormal) < 0.0) continue;
    float intensity = smoothstep(clim.x + 0.05, clim.y, sampleDensity(uv));
    od += intensity * dt * 3.0;
  }
  return exp(-od * vec3(0.55, 0.78, 1.05));
}

vec3 filmic(vec3 x) {
  x = max(x, vec3(0.0)) * 1.35;
  return pow(clamp(x, vec3(0.0), vec3(1.15)), vec3(0.88));
}

void main() {
  vec3 rayDir = normalize(vDirection);
  vec3 bmin = vec3(-0.5);
  vec3 bmax = vec3(0.5);
  vec2 bounds = hitBox(vOrigin, rayDir, bmin, bmax);
  if (useCutPlanes) {
    float dn = dot(rayDir, cropNormal);
    float dist = dot(cropOrigin - vOrigin, cropNormal);
    if (abs(dn) > 1e-6) {
      float tHit = dist / dn;
      if (dn > 0.0) bounds.x = max(bounds.x, tHit);
      else bounds.y = min(bounds.y, tHit);
    } else if (dot(vOrigin - cropOrigin, cropNormal) < 0.0) {
      fragColor = vec4(bgColor, 1.0);
      return;
    }
  }
  if (bounds.x >= bounds.y) {
    fragColor = vec4(bgColor, 1.0);
    return;
  }
  bounds.x = max(bounds.x, 0.0);

  float delta = voxelStep(rayDir);
  float jitter = hash12(gl_FragCoord.xy) * 0.08;
  vec3 p = vOrigin + (bounds.x + jitter * delta) * rayDir;
  float rayLen = max(bounds.y - bounds.x, 1e-4);

  float maxVal = 0.0;
  vec3 maxPos = p;
  vec4 ac = vec4(0.0);

  float glassOpacity = clamp(opacity, 0.18, 1.0);
  float solidScale = opacity * 0.24;
  float localThreshold = colorStyle == 2 ? 0.045 : max(threshold, 0.045);

  for (float i = 0.0; i < 1024.0; i++) {
    vec3 uv = p + 0.5;

    if (inUnit(uv)) {
      bool visible = true;
      if (useCutPlanes && dot(p - cropOrigin, cropNormal) < -0.001) {
        visible = false;
      }

      if (visible) {
        float d = sampleDensity(uv);
        float lo = clim.x + (colorStyle == 0 ? 0.03 : 0.07);
        float intensity = smoothstep(lo, clim.y, d);
        intensity = pow(intensity, colorStyle == 0 ? 1.05 : 1.35);

        if (renderMode == 0) {
          if (d > maxVal) {
            maxVal = d;
            maxPos = p;
          }
        } else if (intensity > localThreshold * 0.22) {
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

            float tissue = smoothstep(0.04, 0.24, intensity);
            float a = tissue * mix(0.02, 0.18, pow(surface, 0.5)) * glassOpacity;
            a *= (1.0 - ac.a * 0.28);
            ac.rgb += (1.0 - ac.a) * a * col;
            ac.a += (1.0 - ac.a) * a;
            if (ac.a > 0.86) break;
          } else if (colorStyle == 1) {
            vec3 look = normalize(-vOrigin);
            float ext = 0.5 * (abs(look.x) + abs(look.y) + abs(look.z));
            float z = dot(p - vOrigin, look);
            float far = clamp(
              (z - (length(vOrigin) - ext)) / max(2.0 * ext, 0.15),
              0.0,
              1.0
            );
            vec3 warm = philipsDepth(far * 0.72);
            vec3 cool = philipsDepth(min(far * 0.72 + 0.38, 1.0)) * vec3(0.55, 0.42, 0.32);
            float frontness = mix(0.12, 1.0, wrap) * (1.0 - depthFog * 0.55);
            vec3 col = mix(cool, warm, frontness);
            col *= mix(vec3(0.48, 0.32, 0.16), vec3(1.08, 1.0, 0.88), beer);
            vec3 H = normalize(toLight + viewDir);
            float spec = pow(max(dot(N, H), 0.0), 36.0) * surface * lightIntensity * 0.55;
            col += vec3(1.0, 0.94, 0.78) * spec;

            float tissue = smoothstep(0.04, 0.24, intensity);
            float a = tissue * mix(0.02, 0.18, pow(surface, 0.5)) * glassOpacity;
            a *= (1.0 - ac.a * 0.28);
            ac.rgb += (1.0 - ac.a) * a * col;
            ac.a += (1.0 - ac.a) * a;
            if (ac.a > 0.86) break;
          } else {
            vec3 base = vec3(pow(intensity, 0.85));
            base *= mix(0.45, 1.0, beer.g);
            float diff = ambient + ndotl * (0.55 + 0.45 * surface);
            vec3 H = normalize(toLight + viewDir);
            float spec = pow(max(dot(N, H), 0.0), specularPower) * surface * lightIntensity * 0.28;
            vec3 col = base * diff + vec3(0.96, 0.90, 0.74) * spec;
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
      vec3 look = normalize(-vOrigin);
      float ext = 0.5 * (abs(look.x) + abs(look.y) + abs(look.z));
      float z = dot(maxPos - vOrigin, look);
      float far = clamp(
        (z - (length(vOrigin) - ext)) / max(2.0 * ext, 0.15),
        0.0,
        1.0
      );
      vec3 warm = philipsDepth(far * 0.72);
      vec3 cool = philipsDepth(min(far * 0.72 + 0.38, 1.0)) * vec3(0.55, 0.42, 0.32);
      col = mix(cool, warm, wrap);
      col *= mix(vec3(0.48, 0.32, 0.16), vec3(1.0), beer);
      outA = clamp(intensity * glassOpacity * 0.9, 0.0, 0.92);
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
    outA = colorStyle != 0 ? min(ac.a, 0.93) : ac.a;
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
  glass: '#212121',
  philips: '#212121',
  gray: '#212121',
};

const STYLE_BG_VEC = {
  glass: new THREE.Color('#212121'),
  philips: new THREE.Color('#212121'),
  gray: new THREE.Color('#212121'),
};

const MPR_PLANE_COLORS = {
  x: '#e57373',
  y: '#4caf50',
  z: '#ffb74d',
};

function clipLineToUnitBox(origin, dir) {
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  let tmin = -1e4;
  let tmax = 1e4;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-8) {
      if (o[i] < -0.505 || o[i] > 0.505) return null;
      continue;
    }
    let t0 = (-0.5 - o[i]) / d[i];
    let t1 = (0.5 - o[i]) / d[i];
    if (t0 > t1) {
      const tmp = t0;
      t0 = t1;
      t1 = tmp;
    }
    tmin = Math.max(tmin, t0);
    tmax = Math.min(tmax, t1);
  }
  if (tmax - tmin < 1e-4) return null;
  return [
    [o[0] + d[0] * tmin, o[1] + d[1] * tmin, o[2] + d[2] * tmin],
    [o[0] + d[0] * tmax, o[1] + d[1] * tmax, o[2] + d[2] * tmax],
  ];
}

function MprPlanes({ volume, mprCenter, mprBasis, cropPlaneKey }) {
  const sizeMm = useMemo(() => physicalSizeMm(volume), [volume]);
  const dims = volume.dims;

  const origin = useMemo(
    () =>
      new THREE.Vector3(
        (mprCenter.x + 0.5) / dims.x - 0.5,
        (mprCenter.y + 0.5) / dims.y - 0.5,
        (mprCenter.z + 0.5) / dims.z - 0.5
      ),
    [mprCenter, dims]
  );

  const axes = useMemo(
    () =>
      ['x', 'y', 'z'].map((key) => {
        const nMm = mprBasis[key];
        const dir = new THREE.Vector3(
          nMm[0] / Math.max(sizeMm.x, 1e-6),
          nMm[1] / Math.max(sizeMm.y, 1e-6),
          nMm[2] / Math.max(sizeMm.z, 1e-6)
        );
        if (dir.lengthSq() < 1e-10) {
          return { key, color: MPR_PLANE_COLORS[key], points: [] };
        }
        dir.normalize();
        return {
          key,
          color: MPR_PLANE_COLORS[key],
          points: clipLineToUnitBox(origin, dir) || [],
        };
      }),
    [mprBasis, origin, sizeMm]
  );

  return (
    <group>
      {axes.map((a) =>
        a.points.length === 2 ? (
          <Line
            key={a.key}
            points={a.points}
            color={a.color}
            lineWidth={cropPlaneKey === a.key ? 2.4 : 1.6}
            renderOrder={4}
            depthTest={false}
            transparent
            opacity={0.9}
          />
        ) : null
      )}
    </group>
  );
}

function VolumeFrame() {
  const geometry = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geometry), [geometry]);

  useEffect(
    () => () => {
      geometry.dispose();
      edges.dispose();
    },
    [geometry, edges]
  );

  return (
    <lineSegments geometry={edges}>
      <lineBasicMaterial color="#4caf50" transparent opacity={0.38} />
    </lineSegments>
  );
}

function ValveSolid({ volume, positions, pose, mprCenter, mprBasis }) {
  const geometry = useMemo(() => {
    if (!positions || !pose || !mprCenter || !mprBasis) return null;
    const frame = valveFrames(volume, mprCenter, mprBasis, pose).valve;
    const out = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      const world = localToWorld(frame, [positions[i], positions[i + 1], positions[i + 2]]);
      const unit = mmToUnitBox(volume, world);
      out[i] = unit[0];
      out[i + 1] = unit[1];
      out[i + 2] = unit[2];
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(out, 3));
    next.computeVertexNormals();
    return next;
  }, [volume, positions, pose, mprCenter, mprBasis]);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  if (!geometry) return null;

  return (
    <mesh geometry={geometry} renderOrder={6}>
      <meshStandardMaterial
        color="#ffb74d"
        transparent
        opacity={pose.opacity ?? 0.45}
        roughness={0.42}
        metalness={0.06}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function MeasureBall({ position, color, radius, invScale, live }) {
  return (
    <group position={position} scale={invScale}>
      <mesh scale={[radius, radius, radius]} renderOrder={8}>
        <sphereGeometry args={[1, 40, 32]} />
        <meshPhongMaterial
          color={color}
          emissive={color}
          emissiveIntensity={live ? 0.18 : 0.06}
          specular="#ffffff"
          shininess={live ? 140 : 95}
          toneMapped={false}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
      <mesh
        position={[radius * 0.32, radius * 0.38, radius * 0.28]}
        scale={[radius * 0.26, radius * 0.26, radius * 0.26]}
        renderOrder={9}
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={live ? 0.72 : 0.55}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function MeasurementOverlay({
  volume,
  measurements,
  timeIndex,
  selectedId,
  liveDraft,
  scale,
}) {
  const visible = (measurements || []).filter((m) => m.timeIndex === timeIndex);
  const invScale = useMemo(
    () => [1 / (scale[0] || 1), 1 / (scale[1] || 1), 1 / (scale[2] || 1)],
    [scale]
  );

  const draftPts = liveDraft?.points || [];
  const cursor = liveDraft?.cursor;
  const hasLive = Boolean(cursor || draftPts.length);
  if (!visible.length && !hasLive) return null;

  const toBox = (mm) => mmToUnitBox(volume, mm);

  return (
    <group>
      {visible.map((m) => {
        const pts = m.points.map(toBox);
        const selected = m.id === selectedId;
        const color = m.color || '#ffb74d';
        const closed = m.type === 'area' && pts.length >= 3;
        const linePts = closed ? [...pts, pts[0]] : pts;
        const mid = pts
          .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
          .map((v) => v / pts.length);
        return (
          <group key={m.id}>
            {linePts.length >= 2 && (
              <Line
                points={linePts}
                color={color}
                lineWidth={selected ? 2.6 : 2}
                renderOrder={5}
                depthTest={false}
                transparent
                opacity={0.95}
              />
            )}
            {pts.map((p, i) => (
              <MeasureBall
                key={i}
                position={p}
                color={color}
                radius={selected ? 0.0095 : 0.0085}
                invScale={invScale}
              />
            ))}
            <Html
              position={mid}
              center
              sprite
              style={{
                pointerEvents: 'none',
                font: '600 11px Arial, Helvetica, sans-serif',
                color,
                background: 'rgba(33, 33, 33, 0.88)',
                padding: '2px 5px',
                borderRadius: 3,
                border: `1px solid ${color}`,
                whiteSpace: 'nowrap',
              }}
            >
              {m.label}
            </Html>
          </group>
        );
      })}

      {hasLive && (
        <group>
          {draftPts.length >= 2 && (
            <Line
              points={
                liveDraft.type === 'area' && draftPts.length >= 3
                  ? [...draftPts.map(toBox), toBox(draftPts[0])]
                  : draftPts.map(toBox)
              }
              color="#ffb74d"
              lineWidth={1.8}
              renderOrder={6}
              depthTest={false}
              transparent
              opacity={0.85}
            />
          )}
          {cursor && draftPts.length >= 1 && (
            <Line
              points={[toBox(draftPts[draftPts.length - 1]), toBox(cursor)]}
              color="#ffffff"
              lineWidth={1.6}
              renderOrder={6}
              depthTest={false}
              transparent
              opacity={0.8}
            />
          )}
          {draftPts.map((p, i) => (
            <MeasureBall
              key={`draft-${i}`}
              position={toBox(p)}
              color="#ffb74d"
              radius={0.0085}
              invScale={invScale}
            />
          ))}
          {cursor && (
            <MeasureBall
              position={toBox(cursor)}
              color="#ffb74d"
              radius={0.0115}
              invScale={invScale}
              live
            />
          )}
        </group>
      )}
    </group>
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
  useCutPlanes,
  cropPlaneKey,
  cropFlip,
  lightAzimuth,
  lightElevation,
  lightIntensity,
  interactive,
  forceHighQuality,
  showMprLines,
  mprCenter,
  mprBasis,
  measurements,
  selectedMeasurementId,
  liveDraft,
  valvePositions,
  valvePose,
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
    const packed = new Uint8Array(dims.x * dims.y * dims.z);
    packed.set(getVolumeAtTime(volume, timeIndex));
    const tex = new THREE.Data3DTexture(packed, dims.x, dims.y, dims.z);
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
    const dest = texture.image.data;
    if (dest.length === data.length) dest.set(data);
    else texture.image.data = new Uint8Array(data);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
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

  const cropOrigin = useMemo(() => {
    const o = mmToUnitBox(volume, voxelToMm(volume, mprCenter));
    return new THREE.Vector3(o[0], o[1], o[2]);
  }, [volume, mprCenter]);

  const cropNormal = useMemo(() => {
    const key = cropPlaneKey === 'x' || cropPlaneKey === 'y' ? cropPlaneKey : 'z';
    const nMm = mprBasis?.[key] || [0, 0, 1];
    const n = new THREE.Vector3(
      nMm[0] / Math.max(sizeMm.x, 1e-6),
      nMm[1] / Math.max(sizeMm.y, 1e-6),
      nMm[2] / Math.max(sizeMm.z, 1e-6)
    );
    if (n.lengthSq() < 1e-10) n.set(0, 0, 1);
    n.normalize();
    if (cropFlip) n.multiplyScalar(-1);
    return n;
  }, [mprBasis, sizeMm, cropPlaneKey, cropFlip]);

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

  // Fraction of a voxel per ray sample (< 1 means extra samples so voxels fuse)
  const stepScale =
    interactive && !forceHighQuality
      ? 0.72
      : colorStyle === 'gray'
        ? 0.45
        : 0.38;

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
      stepScale: { value: stepScale },
      clim: { value: clim },
      renderMode: { value: MODE_MAP[renderMode] ?? 1 },
      colorStyle: { value: STYLE_MAP[colorStyle] ?? 2 },
      cropOrigin: { value: cropOrigin },
      cropNormal: { value: cropNormal },
      useCutPlanes: { value: useCutPlanes },
      lightPos: { value: lightPos },
      lightIntensity: { value: lightIntensity },
      ambient: { value: colorStyle === 'gray' ? 0.26 : 0.42 },
      specularPower: { value: colorStyle === 'gray' ? 26.0 : 48.0 },
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
    u.stepScale.value = stepScale;
    u.clim.value = clim;
    u.renderMode.value = MODE_MAP[renderMode] ?? 1;
    u.colorStyle.value = STYLE_MAP[colorStyle] ?? 2;
    u.cropOrigin.value = cropOrigin;
    u.cropNormal.value = cropNormal;
    u.useCutPlanes.value = useCutPlanes;
    u.lightPos.value = lightPos;
    u.lightIntensity.value = lightIntensity;
    u.ambient.value = colorStyle === 'gray' ? 0.26 : 0.42;
    u.specularPower.value = colorStyle === 'gray' ? 26.0 : 48.0;
    u.volumeDims.value = volumeDims;
    u.volumeScale.value = volumeScale;
    u.bgColor.value = STYLE_BG_VEC[colorStyle] || STYLE_BG_VEC.glass;
  }, [
    texture,
    opacity,
    clim,
    renderMode,
    colorStyle,
    cropOrigin,
    cropNormal,
    useCutPlanes,
    lightPos,
    lightIntensity,
    volumeDims,
    volumeScale,
    stepScale,
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
      <VolumeFrame />
      {showMprLines && mprCenter && mprBasis && (
        <MprPlanes
          volume={volume}
          mprCenter={mprCenter}
          mprBasis={mprBasis}
          cropPlaneKey={cropPlaneKey}
        />
      )}
      {valvePositions && valvePose && (
        <ValveSolid
          volume={volume}
          positions={valvePositions}
          pose={valvePose}
          mprCenter={mprCenter}
          mprBasis={mprBasis}
        />
      )}
      <MeasurementOverlay
        volume={volume}
        measurements={measurements}
        timeIndex={timeIndex}
        selectedId={selectedMeasurementId}
        liveDraft={liveDraft}
        scale={scale}
      />
    </group>
  );
}

function CameraRig({ resetToken, onInteractive }) {
  const controls = useRef();
  const drag = useRef(null);
  const { camera, gl } = useThree();
  const prev = useRef(resetToken);

  useEffect(() => {
    if (resetToken === prev.current) return;
    prev.current = resetToken;
    camera.position.set(1.15, 0.82, 1.25);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const c = controls.current;
    if (c) {
      c.target.set(0, 0, 0);
      c.update();
    }
  }, [resetToken, camera]);

  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = 'none';

    const ballOf = (event) => {
      const bounds = el.getBoundingClientRect();
      const w = Math.max(1, bounds.width);
      const h = Math.max(1, bounds.height);
      const x = (2 * ((event.clientX - bounds.left) / w) - 1) * 1.1;
      const y = -(2 * ((event.clientY - bounds.top) / h) - 1) * 1.1;
      const lengthSq = x * x + y * y;
      if (lengthSq > 1) {
        const scale = Math.sqrt(lengthSq);
        return { x: x / scale, y: y / scale, z: 0 };
      }
      return { x, y, z: Math.sqrt(Math.max(0, 1 - lengthSq)) };
    };

    const rotate = (vx, vy, vz, ax, ay, az, angle) => {
      const len = Math.hypot(ax, ay, az) || 1;
      const ix = ax / len;
      const iy = ay / len;
      const iz = az / len;
      const s = Math.sin(angle);
      const c = Math.cos(angle);
      const t = 1 - c;
      const dot = ix * vx + iy * vy + iz * vz;
      return {
        x: ix * dot * t + vx * c + (-iz * vy + iy * vz) * s,
        y: iy * dot * t + vy * c + (iz * vx - ix * vz) * s,
        z: iz * dot * t + vz * c + (-iy * vx + ix * vy) * s,
      };
    };

    const onDown = (event) => {
      if (event.pointerType !== 'touch' && event.button !== 0) return;
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.target.closest && event.target.closest('button')) return;
      drag.current = { ball: ballOf(event) };
      onInteractive(true);
      try {
        el.setPointerCapture(event.pointerId);
      } catch (err) {
        /* The canvas can reject capture when the pointer is already gone. */
      }
    };

    const onMove = (event) => {
      const current = drag.current;
      if (!current) return;
      const ctrl = controls.current;
      const target = ctrl ? ctrl.target : { x: 0, y: 0, z: 0 };
      const next = ballOf(event);
      const prevBall = current.ball;
      current.ball = next;
      const ax = prevBall.y * next.z - prevBall.z * next.y;
      const ay = prevBall.z * next.x - prevBall.x * next.z;
      const az = prevBall.x * next.y - prevBall.y * next.x;
      const axisLen = Math.hypot(ax, ay, az);
      const adot = Math.max(
        -1,
        Math.min(1, prevBall.x * next.x + prevBall.y * next.y + prevBall.z * next.z)
      );
      const angle = axisLen < 1e-6 ? 0 : -Math.acos(adot);
      if (Math.abs(angle) < 1e-6 || axisLen < 1e-6) return;

      camera.updateMatrixWorld();
      const m = camera.matrixWorld.elements;
      const right = { x: m[0], y: m[1], z: m[2] };
      const up = { x: m[4], y: m[5], z: m[6] };
      const back = { x: m[8], y: m[9], z: m[10] };
      const wax = right.x * ax + up.x * ay + back.x * az;
      const way = right.y * ax + up.y * ay + back.y * az;
      const waz = right.z * ax + up.z * ay + back.z * az;
      const offset = rotate(
        camera.position.x - target.x,
        camera.position.y - target.y,
        camera.position.z - target.z,
        wax,
        way,
        waz,
        angle
      );
      camera.position.set(target.x + offset.x, target.y + offset.y, target.z + offset.z);
      const nextUp = rotate(camera.up.x, camera.up.y, camera.up.z, wax, way, waz, angle);
      camera.up.set(nextUp.x, nextUp.y, nextUp.z).normalize();
      camera.lookAt(target.x, target.y, target.z);
      camera.updateMatrixWorld();
    };

    const onUp = (event) => {
      if (!drag.current) return;
      drag.current = null;
      onInteractive(false);
      try {
        el.releasePointerCapture(event.pointerId);
      } catch (err) {
        /* Capture may already have been released. */
      }
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [gl, camera, onInteractive]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan
      enableZoom
      enableRotate={false}
      zoomSpeed={0.85}
      enableDamping={false}
      onStart={() => onInteractive(true)}
      onEnd={() => onInteractive(false)}
    />
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
  useCutPlanes = false,
  cropPlaneKey = 'z',
  cropFlip = false,
  lightAzimuth = 30,
  lightElevation = 48,
  lightIntensity = 1.35,
  showMprLines = false,
  mprCenter,
  mprBasis,
  measurements,
  selectedMeasurementId,
  liveDraft,
  valvePositions = null,
  valvePose = null,
  cameraResetToken = 0,
  forceHighQuality = false,
}) => {
  const [interactive, setInteractive] = useState(false);

  if (!volume) return null;

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#ffffff', '#2e2e2e', 0.75]} />
      <directionalLight position={[1.15, 1.45, 1.05]} intensity={1.4} />
      <VolumeMesh
        volume={volume}
        timeIndex={timeIndex}
        windowCenter={windowCenter}
        windowWidth={windowWidth}
        opacity={opacity}
        renderMode={renderMode}
        colorStyle={colorStyle}
        useCutPlanes={useCutPlanes}
        cropPlaneKey={cropPlaneKey}
        cropFlip={cropFlip}
        lightAzimuth={lightAzimuth}
        lightElevation={lightElevation}
        lightIntensity={lightIntensity}
        interactive={interactive}
        forceHighQuality={forceHighQuality}
        showMprLines={showMprLines}
        mprCenter={mprCenter}
        mprBasis={mprBasis}
        measurements={measurements}
        selectedMeasurementId={selectedMeasurementId}
        liveDraft={liveDraft}
        valvePositions={valvePositions}
        valvePose={valvePose}
      />
      <CameraRig
        resetToken={cameraResetToken}
        onInteractive={setInteractive}
      />
    </>
  );
};

export default VolumeRenderer;
export { STYLE_BG };
