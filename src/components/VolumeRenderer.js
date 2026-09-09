import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { getVolumeAtTime, physicalSizeMm } from '../utils/philipsVolume';
import { cross as cross3, mmToUnitBox, normalize as normalize3 } from '../utils/mprGeometry';

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

const MPR_PLANE_COLORS = {
  x: '#e53935',
  y: '#43a047',
  z: '#1e88e5',
};

const UNIT_BOX_CORNERS = [
  [-0.5, -0.5, -0.5],
  [0.5, -0.5, -0.5],
  [0.5, 0.5, -0.5],
  [-0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5],
  [0.5, -0.5, 0.5],
  [0.5, 0.5, 0.5],
  [-0.5, 0.5, 0.5],
];

const UNIT_BOX_EDGES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

function clipPlaneToUnitBox(origin, normal) {
  const hits = [];
  const eps = 1e-5;
  for (const [i0, i1] of UNIT_BOX_EDGES) {
    const a = UNIT_BOX_CORNERS[i0];
    const b = UNIT_BOX_CORNERS[i1];
    const da =
      (a[0] - origin.x) * normal.x +
      (a[1] - origin.y) * normal.y +
      (a[2] - origin.z) * normal.z;
    const db =
      (b[0] - origin.x) * normal.x +
      (b[1] - origin.y) * normal.y +
      (b[2] - origin.z) * normal.z;
    if (da * db > eps) continue;
    const denom = da - db;
    if (Math.abs(denom) < 1e-8) continue;
    const t = da / denom;
    if (t < -eps || t > 1 + eps) continue;
    hits.push([
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
    ]);
  }

  const uniq = [];
  for (const p of hits) {
    if (
      !uniq.some(
        (q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < 1.5e-3
      )
    ) {
      uniq.push(p);
    }
  }
  if (uniq.length < 3) return [];

  const c = uniq
    .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
    .map((v) => v / uniq.length);
  const n = [normal.x, normal.y, normal.z];
  const tmp = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = normalize3(cross3(n, tmp));
  const v = normalize3(cross3(n, u));
  uniq.sort((a, b) => {
    const angA = Math.atan2(
      (a[0] - c[0]) * v[0] + (a[1] - c[1]) * v[1] + (a[2] - c[2]) * v[2],
      (a[0] - c[0]) * u[0] + (a[1] - c[1]) * u[1] + (a[2] - c[2]) * u[2]
    );
    const angB = Math.atan2(
      (b[0] - c[0]) * v[0] + (b[1] - c[1]) * v[1] + (b[2] - c[2]) * v[2],
      (b[0] - c[0]) * u[0] + (b[1] - c[1]) * u[1] + (b[2] - c[2]) * u[2]
    );
    return angA - angB;
  });
  return uniq;
}

function MprPlaneOverlay({ points, color }) {
  const fillGeom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    if (!points || points.length < 3) return g;
    const c = points
      .reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
      .map((v) => v / points.length);
    const verts = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      verts.push(c[0], c[1], c[2], a[0], a[1], a[2], b[0], b[1], b[2]);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    g.computeVertexNormals();
    return g;
  }, [points]);

  useEffect(() => () => fillGeom.dispose(), [fillGeom]);

  if (!points || points.length < 3) return null;
  const loop = [...points, points[0]];

  return (
    <group>
      <mesh geometry={fillGeom} renderOrder={2}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.13}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <Line
        points={loop}
        color={color}
        lineWidth={2.4}
        renderOrder={3}
        depthTest
        transparent
        opacity={0.95}
      />
    </group>
  );
}

function MprPlanes({ volume, mprCenter, mprBasis }) {
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

  const planes = useMemo(
    () =>
      ['x', 'y', 'z'].map((key) => {
        const nMm = mprBasis[key];
        const normal = new THREE.Vector3(
          nMm[0] / Math.max(sizeMm.x, 1e-6),
          nMm[1] / Math.max(sizeMm.y, 1e-6),
          nMm[2] / Math.max(sizeMm.z, 1e-6)
        );
        if (normal.lengthSq() < 1e-10) return { key, color: MPR_PLANE_COLORS[key], points: [] };
        normal.normalize();
        return {
          key,
          color: MPR_PLANE_COLORS[key],
          points: clipPlaneToUnitBox(origin, normal),
        };
      }),
    [mprBasis, origin, sizeMm]
  );

  return (
    <group>
      {planes.map((p) => (
        <MprPlaneOverlay key={p.key} points={p.points} color={p.color} />
      ))}
    </group>
  );
}

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
        const color = m.color || '#ffd54f';
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
                font: '600 11px "IBM Plex Sans", "Segoe UI", sans-serif',
                color,
                background: 'rgba(8, 12, 16, 0.78)',
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
              color="#ffcc80"
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
              color="#7ee8ff"
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
              color="#00e5ff"
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
  crosshair,
  useCutPlanes,
  lightAzimuth,
  lightElevation,
  lightIntensity,
  interactive,
  showMprLines,
  mprCenter,
  mprBasis,
  measurements,
  selectedMeasurementId,
  liveDraft,
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
      {showMprLines && mprCenter && mprBasis && (
        <MprPlanes
          volume={volume}
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
      <axesHelper args={[0.16]} position={[-0.46, -0.46, -0.46]} />
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
  showMprLines = false,
  mprCenter,
  mprBasis,
  measurements,
  selectedMeasurementId,
  liveDraft,
}) => {
  const [interactive, setInteractive] = useState(false);

  if (!volume) return null;

  return (
    <>
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#f2fff8', '#243040', 0.75]} />
      <directionalLight position={[1.15, 1.45, 1.05]} intensity={1.4} />
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
        showMprLines={showMprLines}
        mprCenter={mprCenter}
        mprBasis={mprBasis}
        measurements={measurements}
        selectedMeasurementId={selectedMeasurementId}
        liveDraft={liveDraft}
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
