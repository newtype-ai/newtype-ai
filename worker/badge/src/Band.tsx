/**
 * 3D lanyard + badge card component
 * Adapted from the Vercel Ship '24 badge (https://vercel.com/blog/building-an-interactive-3d-event-badge-with-react-three-fiber)
 * and BuouUI reference (https://buouui.com/docs/animations/3d-badge)
 */

import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
import { createBadgeTexture } from './texture';

interface AgentData {
  protocolVersion: string;
  name: string;
  description: string;
  version: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
  provider?: {
    organization: string;
    url?: string;
  };
}

export function Band({
  agentData,
}: {
  agentData: AgentData;
}) {
  const band = useRef<THREE.Mesh<MeshLineGeometry, MeshLineMaterial>>(null);
  const cardGroup = useRef<THREE.Group>(null);

  const vec = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const target = new THREE.Vector3();
  const attach = new THREE.Vector3();

  const [dragged, drag] = useState<THREE.Vector3 | false>(false);
  const [hovered, hover] = useState(false);

  const cardTexture = useMemo(() => createBadgeTexture(agentData), [agentData]);
  const bodyGeometry = useMemo(() => new THREE.BoxGeometry(1.6, 2.25, 0.05), []);
  const lineGeometry = useMemo(() => new MeshLineGeometry(), []);
  const lineMaterial = useMemo(
    () => {
      const material = new MeshLineMaterial({
        color: new THREE.Color('white'),
        resolution: new THREE.Vector2(2, 1),
        lineWidth: 1,
      });
      material.depthTest = false;
      return material;
    },
    []
  );
  const restPosition = useRef(new THREE.Vector3(2, 3.35, -0.05));
  const cardPosition = useRef(restPosition.current.clone());
  const cardVelocity = useRef(new THREE.Vector3());

  const [curve] = useState(
    () =>
      new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 4.6, 0),
        new THREE.Vector3(0.65, 4.25, 0),
        new THREE.Vector3(1.35, 4.25, 0),
        new THREE.Vector3(2, 4.6, 0),
      ])
  );

  // Cursor feedback
  useEffect(() => {
    if (hovered) {
      document.body.style.cursor = dragged ? 'grabbing' : 'grab';
      return () => void (document.body.style.cursor = 'auto');
    }
    return () => void (document.body.style.cursor = 'auto');
  }, [hovered, dragged]);

  useEffect(() => {
    return () => {
      bodyGeometry.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
    };
  }, [bodyGeometry, lineGeometry, lineMaterial]);

  useEffect(() => {
    return () => {
      cardTexture.dispose();
    };
  }, [cardTexture]);

  // Animation loop: update lanyard curve + handle dragging
  useFrame((state, delta) => {
    if (!band.current || !cardGroup.current) return;

    const dt = Math.min(delta, 1 / 30);
    const position = cardPosition.current;
    const velocity = cardVelocity.current;

    if (dragged) {
      vec.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      dir.copy(vec).sub(state.camera.position).normalize();
      const distance = (position.z - state.camera.position.z) / dir.z;
      target.copy(state.camera.position).add(dir.multiplyScalar(distance)).sub(dragged);
      target.x = THREE.MathUtils.clamp(target.x, -4.5, 4.5);
      target.y = THREE.MathUtils.clamp(target.y, -1.8, 5.2);
      velocity.copy(target).sub(position).multiplyScalar(18);
      position.lerp(target, 1 - Math.exp(-24 * dt));
    } else {
      target.copy(restPosition.current);
      velocity.addScaledVector(target.clone().sub(position), 36 * dt);
      velocity.multiplyScalar(Math.exp(-7 * dt));
      position.addScaledVector(velocity, dt);
    }

    cardGroup.current.position.copy(position);
    cardGroup.current.rotation.x = THREE.MathUtils.damp(
      cardGroup.current.rotation.x,
      THREE.MathUtils.clamp(-velocity.y * 0.015, -0.25, 0.25),
      8,
      dt
    );
    cardGroup.current.rotation.y = THREE.MathUtils.damp(
      cardGroup.current.rotation.y,
      THREE.MathUtils.clamp(velocity.x * 0.015, -0.35, 0.35),
      8,
      dt
    );
    cardGroup.current.rotation.z = THREE.MathUtils.damp(
      cardGroup.current.rotation.z,
      THREE.MathUtils.clamp(-velocity.x * 0.02, -0.45, 0.45),
      6,
      dt
    );

    attach.copy(position).add({ x: 0, y: 1.45, z: 0 });
    const sag = THREE.MathUtils.clamp(0.45 + attach.distanceTo(curve.points[0]) * 0.06, 0.45, 0.85);
    curve.points[0].set(0, 4.6, 0);
    curve.points[1].lerpVectors(curve.points[0], attach, 0.35).add({ x: -0.15, y: -sag, z: 0 });
    curve.points[2].lerpVectors(curve.points[0], attach, 0.72).add({ x: 0.1, y: -sag * 0.75, z: 0 });
    curve.points[3].copy(attach);
    band.current.geometry.setPoints(curve.getPoints(32));
  });

  curve.curveType = 'chordal';

  return (
    <>
      <group
        ref={cardGroup}
        scale={2.25}
        position={[2, 3.35, -0.05]}
        onPointerOver={() => hover(true)}
        onPointerOut={() => hover(false)}
        onPointerUp={(e) => {
          (e.target as Element)?.releasePointerCapture(e.pointerId);
          drag(false);
        }}
        onPointerDown={(e) => {
          (e.target as Element)?.setPointerCapture(e.pointerId);
          drag(new THREE.Vector3().copy(e.point).sub(cardPosition.current));
        }}
      >
        <mesh geometry={bodyGeometry}>
          <meshPhysicalMaterial
            color="#111111"
            clearcoat={1}
            clearcoatRoughness={0.15}
            roughness={0.3}
            metalness={0.1}
            iridescence={0.3}
            iridescenceIOR={1.3}
          />
        </mesh>

        {/* Dynamic agent info texture */}
        <mesh position={[0, 0, 0.028]}>
          <planeGeometry args={[1.5, 2.12]} />
          <meshBasicMaterial map={cardTexture} toneMapped={false} />
        </mesh>

        {/* Clip and clamp */}
        <mesh position={[0, 1.22, 0.06]}>
          <boxGeometry args={[0.56, 0.1, 0.08]} />
          <meshStandardMaterial color="#8a8a8a" metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[0, 1.38, 0.04]}>
          <boxGeometry args={[0.86, 0.1, 0.05]} />
          <meshStandardMaterial color="#777777" metalness={0.8} roughness={0.4} />
        </mesh>
      </group>

      {/* Lanyard band (solid white, no texture) */}
      <mesh ref={band}>
        <primitive object={lineGeometry} attach="geometry" />
        <primitive object={lineMaterial} attach="material" />
      </mesh>
    </>
  );
}
