import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { easeInOutCubic } from './animationUtils';

/* =========================================================================
   8. CAMERA CONTROLLER & SMART DEMAND PACER
   ========================================================================= */

export interface CameraTransitionRequest {
  id: number;
  targetPos: THREE.Vector3;
  targetLook: THREE.Vector3;
  duration: number;
  /** Only swing around to the target's side; keep the current distance and tilt (used by the
   *  PvP auto-flip so the user's own zoom/tilt are not reset). */
  keepDistanceAndTilt?: boolean;
}

export interface CameraControllerProps {
  cameraMode: 'free' | 'locked';
  fov: number;
  zoomSpeed: number;
  autoRotate: boolean;
  transitionRequest: CameraTransitionRequest | null;
  onTransitionEnd?: () => void;
  controlsRef: React.RefObject<any>;
}

export function CameraController({
  cameraMode,
  fov,
  zoomSpeed,
  autoRotate,
  transitionRequest,
  onTransitionEnd,
  controlsRef,
}: CameraControllerProps) {
  const { camera, invalidate } = useThree();
  // Transitions orbit the camera around the look-at point (spherical interpolation) instead of
  // moving it in a straight line, so a side-to-side flip swings around the board rather than
  // passing over the top of it.
  const transitionRef = useRef<{
    startSph: THREE.Spherical;
    endSph: THREE.Spherical;
    startTheta: number;
    deltaTheta: number;
    startLook: THREE.Vector3;
    endLook: THREE.Vector3;
    startTime: number;
    duration: number;
  } | null>(null);

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
      invalidate();
    }
  }, [camera, fov, invalidate]);

  useEffect(() => {
    if (transitionRequest) {
      const controls = controlsRef.current;
      const currentLook = controls?.target ? controls.target.clone() : new THREE.Vector3(0, 0, 0);
      const endLook = transitionRequest.targetLook.clone();
      const startSph = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(currentLook)
      );
      const endSph = new THREE.Spherical().setFromVector3(
        transitionRequest.targetPos.clone().sub(endLook)
      );
      if (transitionRequest.keepDistanceAndTilt) {
        endSph.radius = startSph.radius;
        endSph.phi = startSph.phi;
      }
      // Azimuth is meaningless when looking straight down (top-down view): keep the other one.
      const NEAR_POLE = 0.02;
      let startTheta = startSph.theta;
      let endTheta = endSph.theta;
      if (startSph.phi < NEAR_POLE) startTheta = endTheta;
      if (endSph.phi < NEAR_POLE) endTheta = startTheta;
      // Shortest way around; an exact half turn (board flip) always swings the same direction.
      let deltaTheta = endTheta - startTheta;
      while (deltaTheta <= -Math.PI) deltaTheta += Math.PI * 2;
      while (deltaTheta > Math.PI) deltaTheta -= Math.PI * 2;
      transitionRef.current = {
        startSph,
        endSph,
        startTheta,
        deltaTheta,
        startLook: currentLook,
        endLook,
        startTime: performance.now(),
        duration: transitionRequest.duration || 700,
      };
      invalidate();
    }
  }, [transitionRequest, camera, controlsRef, invalidate]);

  useFrame(() => {
    const active = transitionRef.current;
    if (active) {
      const now = performance.now();
      const elapsed = now - active.startTime;
      const progress = Math.min(1, Math.max(0, elapsed / active.duration));
      const t = easeInOutCubic(progress);

      const look = new THREE.Vector3().lerpVectors(active.startLook, active.endLook, t);
      const sph = new THREE.Spherical(
        THREE.MathUtils.lerp(active.startSph.radius, active.endSph.radius, t),
        THREE.MathUtils.lerp(active.startSph.phi, active.endSph.phi, t),
        active.startTheta + active.deltaTheta * t
      );
      camera.position.setFromSpherical(sph).add(look);
      camera.lookAt(look);

      if (controlsRef.current) {
        controlsRef.current.target.copy(look);
        controlsRef.current.update();
      }

      invalidate();

      if (progress >= 1) {
        transitionRef.current = null;
        if (onTransitionEnd) onTransitionEnd();
      }
    }
  });

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping={false} // no inertia: the camera stops exactly when you let go
      minDistance={8}
      maxDistance={34}
      maxPolarAngle={Math.PI / 2.05}
      enabled={cameraMode === 'free' && !transitionRef.current}
      autoRotate={autoRotate}
      autoRotateSpeed={0.8}
      zoomSpeed={zoomSpeed}
      onChange={() => invalidate()}
      onStart={() => {
        transitionRef.current = null;
        invalidate();
      }}
    />
  );
}

// Calls invalidate() while busy so GPU idles when no animation is running
export function DemandFramePacer({ isBusy }: { isBusy: boolean }) {
  const { invalidate } = useThree();
  useFrame(() => {
    if (isBusy) {
      invalidate();
    }
  });
  return null;
}
