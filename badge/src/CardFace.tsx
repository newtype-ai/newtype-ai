/**
 * Agent card face content — rendered inside <RenderTexture>
 * Displays agent name, description, skills, and branding
 * Uses Drei's <Text> for SDF text rendering in 3D
 *
 * Camera position is offset to match the card.glb UV mapping
 * (same approach as Vercel Ship '24 badge).
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

// Camera offset to match card.glb UV mapping (Vercel uses [0.49, 0.22, 2])
const CAM_X = 2.45;
const CAM_Y = 1.1;
const CAM_Z = 10;

// Card face width = 3.3 world units (from card.glb front-face UV bounds)
// Padding = 0.3 on each side for equal margins
const PADDING = 0.3;
const CARD_LEFT = -0.86; // card left edge in world coords
const CARD_WIDTH = 3.3; // card face width in world units
const LEFT = CARD_LEFT + PADDING; // = -0.56
const CONTENT_WIDTH = CARD_WIDTH - 2 * PADDING; // = 2.7

export function CardFace({ agentData }: { agentData: AgentData }) {
  const allTags = Array.from(
    new Set(agentData.skills.flatMap((s) => s.tags))
  ).slice(0, 6);

  const desc =
    agentData.description.length > 100
      ? agentData.description.slice(0, 97) + '...'
      : agentData.description;

  return (
    <>
      <PerspectiveCamera
        makeDefault
        manual
        aspect={1024 / 1440}
        position={[CAM_X, CAM_Y, CAM_Z]}
      />
      <color attach="background" args={['#0c0c0c']} />
      <ambientLight intensity={2} />

      <group scale={[1, -1, 1]}>
        {/* NEWTYPE branding */}
        <Text
          position={[LEFT, 3.8, 0]}
          fontSize={0.3}
          color="#444444"
          letterSpacing={0.2}
          anchorX="left"
        >
          NEWTYPE
        </Text>

        {/* Divider */}
        <mesh position={[LEFT + CONTENT_WIDTH / 2, 3.4, 0]}>
          <planeGeometry args={[CONTENT_WIDTH, 0.005]} />
          <meshBasicMaterial color="#333333" />
        </mesh>

        {/* Agent name */}
        <Text
          position={[LEFT, 2.2, 0]}
          fontSize={0.6}
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
          position={[LEFT, 0.6, 0]}
          fontSize={0.25}
          color="#999999"
          maxWidth={CONTENT_WIDTH}
          textAlign="left"
          anchorX="left"
          anchorY="top"
          lineHeight={1.4}
        >
          {desc}
        </Text>

        {/* Divider */}
        <mesh position={[LEFT + CONTENT_WIDTH / 2, -0.5, 0]}>
          <planeGeometry args={[CONTENT_WIDTH, 0.005]} />
          <meshBasicMaterial color="#333333" />
        </mesh>

        {/* Skills label */}
        <Text
          position={[LEFT, -0.9, 0]}
          fontSize={0.2}
          color="#555555"
          letterSpacing={0.1}
          anchorX="left"
        >
          SKILLS
        </Text>

        {/* Skill tags — simple list */}
        {allTags.map((tag, i) => (
          <Text
            key={tag}
            position={[LEFT, -1.4 - i * 0.4, 0]}
            fontSize={0.2}
            color="#aaaaaa"
            anchorX="left"
          >
            {tag}
          </Text>
        ))}

        {/* Protocol version */}
        <Text
          position={[LEFT, -4.0, 0]}
          fontSize={0.18}
          color="#444444"
          anchorX="left"
        >
          {`A2A v${agentData.protocolVersion}  ·  v${agentData.version}`}
        </Text>
      </group>
    </>
  );
}
