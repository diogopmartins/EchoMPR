import { parseDicomFile } from './dicomParser';

export const EXAMPLES = [
  { id: 'aov', label: 'Aortic valve' },
  { id: 'mv', label: 'Mitral valve' },
];

function inEchoWizard() {
  return typeof window !== 'undefined' && window.location.pathname.includes('/static/echompr');
}

function publicFile(path) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return `${base}${path}`;
}

export function exampleUrl(id) {
  if (inEchoWizard()) return `/mpr/examples/${id}`;
  return publicFile(`/examples/${id}.dcm`);
}

export function valveUrl(key) {
  if (inEchoWizard()) return `/mpr/valves/${key}`;
  return publicFile(`/valves/${key}.stl`);
}

/**
 * Fetch the anonymised example study and load it into Echo context.
 * The file stays a browser-side parse; this only downloads the example.
 */
export async function loadExampleStudy(echo, exampleId, { onStatus, signal } = {}) {
  const example = EXAMPLES.find((item) => item.id === exampleId) || EXAMPLES[0];
  const { setLoading, setLoadProgress, setVolume } = echo;
  setLoading(true);
  setLoadProgress(0.02);
  onStatus?.(`Loading the ${example.label.toLowerCase()} example…`);

  const response = await fetch(exampleUrl(example.id), { signal });
  if (!response.ok) {
    throw new Error('The example study could not be loaded.');
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body && response.body.getReader ? response.body.getReader() : null;
  let blob;
  if (reader) {
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (total) {
        setLoadProgress(Math.min(0.4, (received / total) * 0.4));
      }
    }
    blob = new Blob(chunks, { type: 'application/dicom' });
  } else {
    blob = await response.blob();
    setLoadProgress(0.4);
  }

  onStatus?.(`Reading the ${example.label.toLowerCase()} example…`);
  const file = new File([blob], `${example.id}.dcm`, { type: 'application/dicom' });
  const dicomData = await parseDicomFile(file, {
    onProgress: (ratio) => {
      setLoadProgress(0.4 + ratio * 0.55);
      onStatus?.(`Reading the ${example.label.toLowerCase()} example… ${Math.round(ratio * 100)}%`);
    },
  });

  if (!dicomData.volume || dicomData.volume.dims.z < 2) {
    throw new Error('The example file is not a Cartesian volume.');
  }

  setVolume({
    volume: dicomData.volume,
    dicomData,
    meta: dicomData.volume.meta,
  });
  setLoadProgress(1);
  onStatus?.(
    `${example.label} · ${dicomData.volume.dims.x}×${dicomData.volume.dims.y}×${dicomData.volume.dims.z} · ${dicomData.volume.dims.t} frames`
  );
}
