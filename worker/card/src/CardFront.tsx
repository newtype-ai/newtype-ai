/**
 * Card front face content — rendered inside <RenderTexture>
 * Landscape layout: branding, agent name, description, version info
 *
 * Camera frustum at z=5, fov=50, aspect=1024/645:
 *   halfH = 5 × tan(25°) = 2.332
 *   halfW = 2.332 × 1.587 = 3.701
 *   Visible: x [-3.7, 3.7], y [-2.33, 2.33]
 */

import { PerspectiveCamera, Text } from '@react-three/drei';

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

// Camera positioned at center, looking at origin
const CAM_Z = 5;

// Content bounds (calculated from camera frustum)
const PADDING = 0.5;
const HALF_W = 3.7;
const HALF_H = 2.33;
const LEFT = -HALF_W + PADDING; // = -3.2
const RIGHT = HALF_W - PADDING; // = 3.2
const CONTENT_WIDTH = 2 * HALF_W - 2 * PADDING; // = 6.4

export function CardFront({ agentData }: { agentData: AgentData }) {
  const desc =
    agentData.description.length > 120
      ? agentData.description.slice(0, 117) + '...'
      : agentData.description;

  return (
    <>
      <PerspectiveCamera
        makeDefault
        manual
        aspect={1024 / 645}
        position={[0, 0, CAM_Z]}
      />
      <color attach="background" args={['#0c0c0c']} />
      <ambientLight intensity={2} />

      <group>
        {/* NEWTYPE branding — top left */}
        <Text
          position={[LEFT, 1.8, 0]}
          fontSize={0.22}
          color="#444444"
          letterSpacing={0.2}
          anchorX="left"
        >
          NEWTYPE
        </Text>

        {/* Divider */}
        <mesh position={[0, 1.5, 0]}>
          <planeGeometry args={[CONTENT_WIDTH, 0.004]} />
          <meshBasicMaterial color="#333333" />
        </mesh>

        {/* Agent name — large, centered area */}
        <Text
          position={[LEFT, 0.8, 0]}
          fontSize={0.5}
          color="#ffffff"
          maxWidth={CONTENT_WIDTH}
          textAlign="left"
          anchorX="left"
          anchorY="top"
          lineHeight={1.2}
        >
          {agentData.name}
        </Text>

        {/* Description */}
        <Text
          position={[LEFT, -0.2, 0]}
          fontSize={0.2}
          color="#999999"
          maxWidth={CONTENT_WIDTH}
          textAlign="left"
          anchorX="left"
          anchorY="top"
          lineHeight={1.4}
        >
          {desc}
        </Text>

        {/* Bottom: protocol version (left) */}
        <Text
          position={[LEFT, -1.8, 0]}
          fontSize={0.15}
          color="#444444"
          anchorX="left"
        >
          {`A2A v${agentData.protocolVersion}`}
        </Text>

        {/* Bottom: agent version (right) */}
        <Text
          position={[RIGHT, -1.8, 0]}
          fontSize={0.15}
          color="#444444"
          anchorX="right"
        >
          {`v${agentData.version}`}
        </Text>
      </group>
    </>
  );
}
