import * as THREE from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { X } from 'lucide-react';
import { ModelOverrides } from '../config/themes';
import { extractPieceNode, ExtractPieceOptions } from '../utils/modelRegistry';
import { FOOTPRINT, SQUARE, TYPE_FOOTPRINT } from './constants';

/* =========================================================================
   2. TEMPLATE NORMALIZATION CACHE (BUILT ONCE PER MODEL SET & PIECE TYPE)
   ========================================================================= */

export const templateCache = new Map<string, THREE.Group>();
export const detectedSetUpAxis = new Map<string, 'y' | 'z' | 'x'>();

export function getNormalizedTemplate(
  setId: string,
  type: string,
  rawScene: THREE.Object3D,
  overrides?: ModelOverrides,
  pawnScene?: THREE.Object3D,
  isSingleFile?: boolean,
  extractOptions?: ExtractPieceOptions
): THREE.Group {
  const cacheKey = `${setId}:${type}`;
  const existing = templateCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  // 1. Isolate the specific piece mesh/node if single-file or multi-mesh scene
  const targetNode = isSingleFile || rawScene.children.length > 3
    ? extractPieceNode(rawScene, type, extractOptions)
    : rawScene;

  // 2. Determine orientation (up-axis)
  let upAxis: 'y' | 'z' | 'x' = overrides?.upAxis || detectedSetUpAxis.get(setId) || 'y';
  if (!overrides?.upAxis && !detectedSetUpAxis.has(setId)) {
    const probeTarget = pawnScene ? extractPieceNode(pawnScene, 'p') : targetNode;
    const probe = SkeletonUtils.clone(probeTarget);
    probe.updateMatrixWorld(true);
    const probeBox = new THREE.Box3().setFromObject(probe);
    const probeSize = new THREE.Vector3();
    probeBox.getSize(probeSize);

    if (probeSize.z > probeSize.y && probeSize.z > probeSize.x) {
      upAxis = 'z';
    } else if (probeSize.x > probeSize.y && probeSize.x > probeSize.z) {
      upAxis = 'x';
    } else {
      upAxis = 'y';
    }
    detectedSetUpAxis.set(setId, upAxis);
  }

  const root = SkeletonUtils.clone(targetNode) as THREE.Group;
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  root.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      if (mesh.geometry && !mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals();
      }
    }
  });

  // 3. Up-axis rotation correction BEFORE scaling
  if (upAxis === 'z' || overrides?.flipUp) {
    root.rotation.x = -Math.PI / 2;
  } else if (upAxis === 'x') {
    root.rotation.z = Math.PI / 2;
  }
  root.updateMatrixWorld(true);

  // 4. Scale to 70% of tile
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxHorizontal = Math.max(0.001, size.x, size.z);
  const scaleMult = overrides?.scaleMultiplier ?? 1.0;
  const typeScale = overrides?.footprintScale?.[type] ?? 1.0;
  const targetFootprint = SQUARE * FOOTPRINT * (TYPE_FOOTPRINT[type] || 1.0) * scaleMult * typeScale;
  const scale = targetFootprint / maxHorizontal;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  // 5. Center X/Z and place base flush at Y = 0
  box.setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  root.position.set(-center.x, -box.min.y, -center.z);
  root.updateMatrixWorld(true);

  const pivot = new THREE.Group();
  pivot.name = `template-${setId}-${type}`;
  pivot.add(root);

  templateCache.set(cacheKey, pivot);
  return pivot;
}
