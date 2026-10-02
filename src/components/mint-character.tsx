import { forwardRef, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Environment, Lightformer } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

const LOOP = 4;
const TAU = Math.PI * 2;
const R = 0.155;
const HOP_S = 0.75;
/** Head turn toward the pointer, in radians. */
const MAX_YAW = 0.5;
const MAX_PITCH = 0.22;
/** Empty space kept around the character inside the canvas (fraction of its size). */
const FRAME_MARGIN = 0.14;
const FOV = 30;

const bump = (t: number, c: number, w: number) => {
  const d = Math.abs(t - c);
  return d < w ? 0.5 + 0.5 * Math.cos((Math.PI * d) / w) : 0;
};

const surfZ = (x: number, y: number) =>
  R * 0.95 * Math.sqrt(Math.max(0, 1 - (x / (R * 1.04)) ** 2 - (y / (R * 0.93)) ** 2));

const MINT = "#4fd897";
const INK = "#0d1612";
const BLUSH = "#ff9aa6";

function MintMaterial() {
  return (
    <meshPhysicalMaterial
      color={MINT}
      roughness={0.3}
      metalness={0}
      clearcoat={1}
      clearcoatRoughness={0.12}
      sheen={0.6}
      sheenRoughness={0.5}
      sheenColor="#d9fff0"
      emissive="#0c4a2c"
      emissiveIntensity={0.3}
    />
  );
}

function Eye({ side }: { side: 1 | -1 }) {
  const x = 0.052 * side;
  const y = 0.022;
  return (
    <group position={[x, y, surfZ(x, y) - 0.004]} rotation={[0, side * 0.28, 0]}>
      <mesh scale={[1, 1.3, 0.55]}>
        <sphereGeometry args={[0.019, 32, 32]} />
        <meshPhysicalMaterial
          color={INK}
          roughness={0.15}
          clearcoat={1}
          clearcoatRoughness={0.05}
        />
      </mesh>
      <mesh position={[0.006, 0.01, 0.009]}>
        <sphereGeometry args={[0.0055, 16, 16]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.2}
          roughness={0.2}
        />
      </mesh>
    </group>
  );
}

function Cheek({ side }: { side: 1 | -1 }) {
  const cx = 0.085 * side;
  const cy = -0.012;
  return (
    <mesh
      position={[cx, cy, surfZ(cx, cy) - 0.003]}
      rotation={[0, side * 0.5, 0]}
      scale={[1.3, 0.8, 0.2]}
    >
      <sphereGeometry args={[0.022, 32, 16]} />
      <meshPhysicalMaterial
        color={BLUSH}
        roughness={0.5}
        clearcoat={0.6}
        transparent
        opacity={0.75}
      />
    </mesh>
  );
}

function Mouth() {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const mw = 0.04;
    const md = 0.03;
    shape.moveTo(-mw, 0.006);
    shape.quadraticCurveTo(0, 0.0, mw, 0.006);
    shape.quadraticCurveTo(mw * 0.95, -md * 1.25, 0, -md);
    shape.quadraticCurveTo(-mw * 0.95, -md * 1.25, -mw, 0.006);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.006,
      bevelEnabled: true,
      bevelThickness: 0.003,
      bevelSize: 0.003,
      bevelSegments: 6,
      curveSegments: 32,
    });
    const p = geo.attributes["position"]!;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i) - 0.012;
      p.setZ(i, p.getZ(i) + surfZ(x, y) - 0.006);
      p.setY(i, y);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry}>
      <meshPhysicalMaterial color={INK} roughness={0.15} clearcoat={1} clearcoatRoughness={0.05} />
    </mesh>
  );
}

const Arm = forwardRef<THREE.Group, { side: 1 | -1 }>(function Arm({ side }, ref) {
  return (
    <group ref={ref} position={[0.105 * side, 0.155, 0.005]}>
      <mesh position-y={-0.06}>
        <capsuleGeometry args={[0.034, 0.075, 16, 32]} />
        <MintMaterial />
      </mesh>
    </group>
  );
});

type Rig = {
  root: THREE.Group | null;
  upper: THREE.Group | null;
  head: THREE.Group | null;
  waveArm: THREE.Group | null;
  restArm: THREE.Group | null;
  eyes: (THREE.Group | null)[];
  mouth: THREE.Group | null;
};

/** Where the character looks (-1..1 on each axis) and how far into a click-hop it is (0..1). */
type Pose = { lookX: number; lookY: number; hop: number };

/** Applies the idle loop plus look / hop to the rig. Pure, so it can be sampled for framing. */
function applyPose(rig: Rig, time: number, pose: Pose) {
  const t = time % LOOP;
  const p = (TAU * t) / LOOP;
  const bounce = 0.5 - 0.5 * Math.cos(p * 2);
  const squash = Math.cos(p * 2);
  const hopLift = Math.sin(Math.PI * pose.hop);
  if (rig.root) {
    rig.root.position.y = 0.1 * hopLift;
    const e = pose.hop < 0.5 ? 2 * pose.hop * pose.hop : 1 - 2 * (1 - pose.hop) ** 2;
    rig.root.rotation.y = TAU * e;
  }
  if (rig.upper) {
    rig.upper.position.y = 0.12 + 0.012 * bounce;
    rig.upper.scale.set(1 + 0.025 * squash, 1 - 0.035 * squash, 1 + 0.025 * squash);
    rig.upper.rotation.y = pose.lookX * MAX_YAW * 0.3;
  }
  if (rig.head) {
    rig.head.rotation.z = 0.07 * Math.sin(p);
    rig.head.rotation.x = -0.04 + 0.03 * Math.sin(p * 2) - pose.lookY * MAX_PITCH;
    rig.head.rotation.y = pose.lookX * MAX_YAW * 0.7;
    rig.head.position.y = 0.29 + 0.006 * Math.sin(p * 2 - 0.8);
  }
  if (rig.waveArm) {
    rig.waveArm.rotation.z = 2.15 + 0.38 * Math.sin(p * 4);
    rig.waveArm.rotation.x = 0.35;
  }
  if (rig.restArm) rig.restArm.rotation.z = -0.28 - 0.06 * Math.sin(p * 2) - 0.9 * hopLift;
  const blink = Math.max(bump(t, 1.4, 0.09), bump(t, 3.35, 0.09), bump(t, 3.6, 0.09));
  for (const e of rig.eyes) if (e) e.scale.y = 1 - 0.92 * blink;
  if (rig.mouth)
    rig.mouth.scale.set(1 + 0.06 * bounce + 0.3 * hopLift, 1 + 0.08 * bounce + 0.5 * hopLift, 1);
}

/**
 * Bounding box of the character over its whole idle loop, every look direction and the hop,
 * so the camera can frame it once and it never leaves the canvas while moving.
 */
function motionEnvelope(rig: Rig, group: THREE.Object3D) {
  const box = new THREE.Box3();
  const poses: Pose[] = [];
  for (const lookX of [-1, 0, 1])
    for (const lookY of [-1, 0, 1]) poses.push({ lookX, lookY, hop: 0 });
  for (const hop of [0.25, 0.5, 0.75]) poses.push({ lookX: 0, lookY: 0, hop });
  for (const pose of poses) {
    for (let i = 0; i < 16; i++) {
      applyPose(rig, (LOOP * i) / 16, pose);
      group.updateMatrixWorld(true);
      // Transformed geometry bounds: slightly generous, which only adds a little margin.
      box.expandByObject(group, false);
    }
  }
  applyPose(rig, 0, { lookX: 0, lookY: 0, hop: 0 });
  return box;
}

/** Keeps the perspective camera framed on the motion envelope at any canvas aspect ratio. */
function FitCamera({ envelope }: { envelope: THREE.Box3 | null }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  useEffect(() => {
    if (!envelope || !size.width || !size.height) return;
    const center = envelope.getCenter(new THREE.Vector3());
    const dims = envelope.getSize(new THREE.Vector3());
    const aspect = size.width / size.height;
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const halfH = (dims.y / 2) * (1 + FRAME_MARGIN);
    const halfW = (dims.x / 2) * (1 + FRAME_MARGIN);
    // Distance to the front of the envelope, so the nearest point is framed too.
    const dist = Math.max(halfH / tan, halfW / (tan * aspect)) + dims.z / 2;
    camera.fov = FOV;
    camera.aspect = aspect;
    camera.near = 0.05;
    camera.far = dist + 10;
    camera.position.set(center.x, center.y, center.z + dist);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }, [camera, envelope, size.width, size.height]);
  return null;
}

function Character({
  pointer,
  hopRequest,
  onEnvelope,
}: {
  pointer: MutableRefObject<{ x: number; y: number; active: boolean }>;
  hopRequest: MutableRefObject<boolean>;
  onEnvelope: (box: THREE.Box3) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const rig = useRef<Rig>({
    root: null,
    upper: null,
    head: null,
    waveArm: null,
    restArm: null,
    eyes: [],
    mouth: null,
  });
  const look = useRef({ x: 0, y: 0 });
  const hopStart = useRef(-1);

  useEffect(() => {
    if (group.current) onEnvelope(motionEnvelope(rig.current, group.current));
  }, [onEnvelope]);

  useFrame(({ clock }, delta) => {
    const time = clock.getElapsedTime();
    const ptr = pointer.current;
    // Without a pointer (touch screens), the character slowly looks around on its own.
    const tx = ptr.active ? ptr.x : 0.6 * Math.sin(time * 0.45);
    const ty = ptr.active ? ptr.y : 0.25 * Math.sin(time * 0.31 + 1);
    const k = 1 - Math.exp(-delta * 5);
    look.current.x += (tx - look.current.x) * k;
    look.current.y += (ty - look.current.y) * k;
    if (hopRequest.current) {
      hopRequest.current = false;
      if (hopStart.current < 0) hopStart.current = time;
    }
    let hop = 0;
    if (hopStart.current >= 0) {
      hop = (time - hopStart.current) / HOP_S;
      if (hop >= 1) {
        hop = 0;
        hopStart.current = -1;
      }
    }
    applyPose(rig.current, time, { lookX: look.current.x, lookY: look.current.y, hop });
  });

  const r = rig.current;
  return (
    <group ref={group} name="mint_character">
      <group ref={(el) => void (r.root = el)}>
        {([-1, 1] as const).map((s) => (
          <mesh key={s} position={[0.056 * s, 0.076, 0]} scale={[1, 1, 1.12]}>
            <capsuleGeometry args={[0.046, 0.06, 16, 32]} />
            <MintMaterial />
          </mesh>
        ))}
        <group ref={(el) => void (r.upper = el)} position-y={0.12}>
          <mesh scale={[1, 1.1, 0.92]} position-y={0.11}>
            <sphereGeometry args={[0.12, 64, 64]} />
            <MintMaterial />
          </mesh>
          <group ref={(el) => void (r.head = el)} position-y={0.29}>
            <mesh scale={[1.04, 0.93, 0.95]}>
              <sphereGeometry args={[R, 64, 64]} />
              <MintMaterial />
            </mesh>
            <group ref={(el) => void (r.eyes[0] = el)}>
              <Eye side={-1} />
            </group>
            <group ref={(el) => void (r.eyes[1] = el)}>
              <Eye side={1} />
            </group>
            <Cheek side={-1} />
            <Cheek side={1} />
            <group ref={(el) => void (r.mouth = el)}>
              <Mouth />
              <mesh position={[0, -0.036, surfZ(0, -0.036) - 0.001]} scale={[0.9, 0.35, 0.3]}>
                <sphereGeometry args={[0.02, 32, 16]} />
                <meshPhysicalMaterial
                  color={BLUSH}
                  roughness={0.5}
                  clearcoat={0.6}
                  transparent
                  opacity={0.75}
                />
              </mesh>
            </group>
          </group>
          <Arm ref={(el) => void (r.waveArm = el)} side={1} />
          <Arm ref={(el) => void (r.restArm = el)} side={-1} />
        </group>
      </group>
    </group>
  );
}

/**
 * The DotPlay mascot. The camera frames its full range of motion, so it is never cropped at
 * any size; it follows the pointer with its head and hops when clicked. Rendering pauses while
 * it is off screen.
 */
export function MintCharacter({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(true);
  const [envelope, setEnvelope] = useState<THREE.Box3 | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const pointer = useRef({ x: 0, y: 0, active: false });
  const hopRequest = useRef(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setVisible(!!e?.isIntersecting), {
      rootMargin: "80px",
    });
    io.observe(el);
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height * 0.35;
      pointer.current.x = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth / 2)));
      pointer.current.y = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight / 2)));
      pointer.current.active = true;
    };
    const onLeave = () => void (pointer.current.active = false);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={box}
      role="img"
      aria-label="DotPlay mascot waving. Click it to make it jump."
      onClick={() => void (hopRequest.current = true)}
      className={cn(
        "relative aspect-square w-full cursor-pointer select-none drop-shadow-[0_0_36px_rgba(79,216,151,0.3)]",
        className,
      )}
    >
      {mounted && (
        <Canvas
          frameloop={visible ? "always" : "never"}
          camera={{ position: [0, 0.3, 1.6], fov: FOV }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true }}
          style={{ background: "transparent", position: "absolute", inset: 0 }}
        >
          <FitCamera envelope={envelope} />
          <ambientLight intensity={0.5} />
          <directionalLight position={[3, 4, 4]} intensity={1.4} />
          <directionalLight position={[-3, 4, -5]} intensity={2.2} color="#baffdf" />
          <directionalLight position={[4, 1.5, -4]} intensity={0.9} color="#ffe6cc" />
          <Character pointer={pointer} hopRequest={hopRequest} onEnvelope={setEnvelope} />
          {/* Glowing floor spot under the feet; it stays put while the character hops. */}
          <mesh rotation-x={-Math.PI / 2} position-y={0.001}>
            <circleGeometry args={[0.2, 48]} />
            <meshBasicMaterial
              color="#4fd897"
              transparent
              opacity={0.12}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.002}>
            <circleGeometry args={[0.12, 48]} />
            <meshBasicMaterial
              color="#4fd897"
              transparent
              opacity={0.2}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <Environment>
            <Lightformer intensity={3} position={[4, 5, 5]} scale={[6, 4, 1]} />
            <Lightformer intensity={1.4} color="#fff1e0" position={[-6, 2, 3]} scale={[5, 3, 1]} />
            <Lightformer intensity={2} color="#b8ffe0" position={[0, 3, -6]} scale={[8, 2, 1]} />
            <Lightformer intensity={0.6} position={[0, 9, 0]} scale={[10, 10, 1]} />
          </Environment>
        </Canvas>
      )}
    </div>
  );
}
