/**
 * Card back face content — rendered inside <RenderTexture>
 * Shows skills, provider info, and branding
 *
 * Same camera frustum as CardFront:
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
  capabilities?: {
    streaming?: boolean;
    pushNotifications?: boolean;
    stateTransitionHistory?: boolean;
  };
  provider?: {
    organization: string;
    url?: string;
  };
}

const CAM_Z = 5;

const PADDING = 0.5;
const HALF_W = 3.7;
const LEFT = -HALF_W + PADDING;
const RIGHT = HALF_W - PADDING;
const CONTENT_WIDTH = 2 * HALF_W - 2 * PADDING;

export function CardBack({ agentData }: { agentData: AgentData }) {
  // Collect unique tags from all skills
  const allTags = Array.from(
    new Set(agentData.skills.flatMap((s) => s.tags))
  ).slice(0, 8);

  // Build capabilities string
  const caps: string[] = [];
  if (agentData.capabilities?.streaming) caps.push('Streaming');
  if (agentData.capabilities?.pushNotifications) caps.push('Push');
  if (agentData.capabilities?.stateTransitionHistory) caps.push('History');

  return (
    <>
      <PerspectiveCamera
        makeDefault
        manual
        aspect={1024 / 645}
        position={[0, 0, CAM_Z]}
      />
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={2} />

      <group>
        {/* SKILLS header */}
        <Text
          position={[LEFT, 1.8, 0]}
          fontSize={0.18}
          color="#555555"
          letterSpacing={0.1}
          anchorX="left"
        >
          SKILLS
        </Text>

        {/* Skill tags */}
        {allTags.map((tag, i) => {
          // Two-column layout
          const col = i % 2;
          const row = Math.floor(i / 2);
          const x = col === 0 ? LEFT : LEFT + CONTENT_WIDTH / 2;
          const y = 1.3 - row * 0.35;

          return (
            <Text
              key={tag}
              position={[x, y, 0]}
              fontSize={0.17}
              color="#aaaaaa"
              anchorX="left"
            >
              {tag}
            </Text>
          );
        })}

        {/* Divider */}
        <mesh position={[0, -0.2, 0]}>
          <planeGeometry args={[CONTENT_WIDTH, 0.004]} />
          <meshBasicMaterial color="#333333" />
        </mesh>

        {/* Capabilities (if any) */}
        {caps.length > 0 && (
          <Text
            position={[LEFT, -0.6, 0]}
            fontSize={0.15}
            color="#666666"
            anchorX="left"
          >
            {caps.join('  ·  ')}
          </Text>
        )}

        {/* Provider organization */}
        {agentData.provider?.organization && (
          <Text
            position={[LEFT, -1.1, 0]}
            fontSize={0.17}
            color="#777777"
            anchorX="left"
          >
            {agentData.provider.organization}
          </Text>
        )}

        {/* Bottom branding */}
        <Text
          position={[RIGHT, -1.8, 0]}
          fontSize={0.14}
          color="#333333"
          anchorX="right"
          letterSpacing={0.08}
        >
          newtype-ai.org
        </Text>
      </group>
    </>
  );
}
