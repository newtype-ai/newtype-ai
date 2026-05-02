/**
 * Interactive 3D card — tilt on mouse move, flip on click
 * Programmatic geometry with canvas textures for front/back content
 */

import * as THREE from 'three';
import { useRef, useState, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { createCardBackTexture, createCardFrontTexture } from './texture';

// ISO 7810 ID-1 proportions (credit card: 85.6 × 53.98 mm)
const CARD_WIDTH = 3.0;
const CARD_HEIGHT = CARD_WIDTH / 1.586; // ≈ 1.892
const CARD_DEPTH = 0.03;
const CORNER_RADIUS = 0.11; // ISO 7810: 3.18mm on 85.6mm card = 3.71%

// Face plane dimensions (slightly inset from card body)
const FACE_W = CARD_WIDTH - 0.02;
const FACE_H = CARD_HEIGHT - 0.02;
const FACE_R = CORNER_RADIUS - 0.01; // match inset

/** Rounded rectangle shape for card body and face planes. */
function createRoundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const hw = w / 2;
  const hh = h / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-hw + r, -hh);
  shape.lineTo(hw - r, -hh);
  shape.absarc(hw - r, -hh + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(hw, hh - r);
  shape.absarc(hw - r, hh - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-hw + r, hh);
  shape.absarc(-hw + r, hh - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-hw, -hh + r);
  shape.absarc(-hw + r, -hh + r, r, Math.PI, Math.PI * 1.5, false);
  return shape;
}

/** Create ShapeGeometry with UVs normalized to 0-1 for canvas textures. */
function createNormalizedFaceGeometry(w: number, h: number, r: number): THREE.ShapeGeometry {
  const shape = createRoundedRectShape(w, h, r);
  const geo = new THREE.ShapeGeometry(shape);

  // ShapeGeometry UVs default to raw shape coordinates, so remap to 0-1.
  const uv = geo.attributes.uv;
  const hw = w / 2;
  const hh = h / 2;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) + hw) / w, (uv.getY(i) + hh) / h);
  }
  uv.needsUpdate = true;
  return geo;
}

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
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  provider?: {
    organization: string;
    url?: string;
  };
  iconUrl?: string;
}

export function CardScene({ agentData }: { agentData: AgentData }) {
  const groupRef = useRef<THREE.Group>(null);
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Pre-build face geometries with normalized UVs (one per mesh, can't share primitive)
  const frontGeo = useMemo(() => createNormalizedFaceGeometry(FACE_W, FACE_H, FACE_R), []);
  const backGeo = useMemo(() => createNormalizedFaceGeometry(FACE_W, FACE_H, FACE_R), []);
  const bodyGeo = useMemo(() => {
    const shape = createRoundedRectShape(CARD_WIDTH, CARD_HEIGHT, CORNER_RADIUS);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: CARD_DEPTH,
      bevelEnabled: true,
      bevelSize: 0.015,
      bevelThickness: 0.01,
      bevelSegments: 4,
    });
    geo.center();
    return geo;
  }, []);
  const frontTexture = useMemo(() => createCardFrontTexture(agentData), [agentData]);
  const backTexture = useMemo(() => createCardBackTexture(agentData), [agentData]);

  // Cursor feedback
  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => {
      document.body.style.cursor = 'auto';
    };
  }, [hovered]);

  useEffect(() => {
    return () => {
      frontGeo.dispose();
      backGeo.dispose();
      bodyGeo.dispose();
    };
  }, [backGeo, bodyGeo, frontGeo]);

  useEffect(() => {
    return () => {
      frontTexture.dispose();
      backTexture.dispose();
    };
  }, [backTexture, frontTexture]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // Flip target: 0 = front, PI = back
    const flipTarget = flipped ? Math.PI : 0;

    // Mouse tilt (subtle, max ~12 degrees ≈ 0.2 rad)
    const tiltX = -state.pointer.y * 0.2;
    const tiltY = state.pointer.x * 0.2;

    // Damp rotation for smooth spring-like transitions
    groupRef.current.rotation.x = THREE.MathUtils.damp(
      groupRef.current.rotation.x,
      tiltX,
      4,
      delta
    );
    groupRef.current.rotation.y = THREE.MathUtils.damp(
      groupRef.current.rotation.y,
      flipTarget + tiltY,
      4,
      delta
    );
  });

  return (
    <group ref={groupRef}>
      {/* Card body — provides rounded edges */}
      <mesh>
        <primitive object={bodyGeo} attach="geometry" />
        <meshPhysicalMaterial color="#111111" roughness={0.5} metalness={0.1} />
      </mesh>

      {/* Front face */}
      <mesh
        position={[0, 0, CARD_DEPTH / 2 + 0.001]}
        onClick={() => setFlipped((f) => !f)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <primitive object={frontGeo} attach="geometry" />
        <meshPhysicalMaterial
          map={frontTexture}
          clearcoat={1}
          clearcoatRoughness={0.15}
          roughness={0.3}
          metalness={0.1}
          iridescence={0.3}
          iridescenceIOR={1.3}
          toneMapped={false}
        />
      </mesh>

      {/* Back face — rotated 180° so text reads correctly when flipped */}
      <mesh
        position={[0, 0, -(CARD_DEPTH / 2 + 0.001)]}
        rotation={[0, Math.PI, 0]}
        onClick={() => setFlipped((f) => !f)}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <primitive object={backGeo} attach="geometry" />
        <meshPhysicalMaterial
          map={backTexture}
          clearcoat={1}
          clearcoatRoughness={0.1}
          roughness={0.4}
          metalness={0.05}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
