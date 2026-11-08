import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { animate, useMotionValue } from 'motion/react';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { Expression } from './brain';
import type { Orbi2DProps } from './Orbi2D';

/**
 * Orbi in 3D, built in code from the original orbi.svg: the body is a lathe
 * of the SVG silhouette, every other part keeps the SVG's position, size and
 * colour (1 SVG unit = 0.05 world units, centred on the body).
 */
const S = 0.05;
const wx = (x: number) => (x - 60) * S;
const wy = (y: number) => (66 - y) * S;
const DEPTH = 0.86; // a slightly flattened bean, like a vinyl toy

const COL = {
  outline: '#3d564e',
  body: '#4fb7a2',
  belly: '#7ed5c3',
  ink: '#121715',
  foot: '#31423c',
  arm: '#445c54',
  lime: '#a3e635',
  aqua: '#5eead4',
  sun: '#facc15',
  blush: '#f472b6',
};

// ---------- silhouette → lathe profile ----------

function bezier(p0: number[], p1: number[], p2: number[], p3: number[], t: number) {
  const u = 1 - t;
  return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
}

function bodyProfile(): THREE.Vector2[] {
  // Left half of the SVG body outline: (60,28) → (26,74) → (60,102).
  const pts: number[][] = [];
  for (let i = 0; i <= 24; i++) pts.push(bezier([60, 28], [34, 28], [26, 48], [26, 74], i / 24));
  for (let i = 1; i <= 24; i++) pts.push(bezier([26, 74], [26, 94], [38, 102], [60, 102], i / 24));
  // Lathe wants radius ≥ 0, ordered bottom → top for outward normals.
  return pts
    .map(([x, y]) => new THREE.Vector2(Math.max(0.0001, (60 - x) * S), wy(y)))
    .reverse();
}

/** Radius of the body at a given SVG y (for placing parts on the surface). */
const PROFILE = bodyProfile();
function radiusAt(svgY: number) {
  const y = wy(svgY);
  let best = PROFILE[0];
  for (const p of PROFILE) if (Math.abs(p.y - y) < Math.abs(best.y - y)) best = p;
  return best.x;
}
/** Point on the front surface of the body for SVG (x, y). */
function surface(svgX: number, svgY: number, lift = 0): [number, number, number] {
  const r = radiusAt(svgY);
  const x = wx(svgX);
  const z = Math.sqrt(Math.max(0, r * r - x * x)) * DEPTH;
  return [x, wy(svgY), z + lift];
}

type EyeShape = 'open' | 'wide' | 'happy' | 'closed';
const EYE: Record<Expression, { shape: EyeShape; lid: number; tilt: number; mouth: 'smile' | 'grin' | 'o' | 'flat' | 'sad' | 'cat' }> = {
  neutral: { shape: 'open', lid: 0, tilt: 0, mouth: 'smile' },
  happy: { shape: 'open', lid: 0, tilt: 0, mouth: 'grin' },
  joy: { shape: 'happy', lid: 0, tilt: 0, mouth: 'grin' },
  love: { shape: 'happy', lid: 0, tilt: 0, mouth: 'cat' },
  curious: { shape: 'wide', lid: 0, tilt: 0, mouth: 'o' },
  surprised: { shape: 'wide', lid: 0, tilt: 0, mouth: 'o' },
  worried: { shape: 'open', lid: 0.25, tilt: 14, mouth: 'flat' },
  focused: { shape: 'open', lid: 0.22, tilt: 4, mouth: 'smile' },
  sad: { shape: 'open', lid: 0.32, tilt: 16, mouth: 'sad' },
  sleepy: { shape: 'open', lid: 0.58, tilt: 0, mouth: 'flat' },
  asleep: { shape: 'closed', lid: 0, tilt: 0, mouth: 'o' },
  eating: { shape: 'happy', lid: 0, tilt: 0, mouth: 'o' },
  refuse: { shape: 'closed', lid: 0, tilt: 0, mouth: 'flat' },
};

// ---------- shared materials & geometries (created once) ----------

function useAssets() {
  return useMemo(() => {
    const phys = (color: string, o: Partial<THREE.MeshPhysicalMaterialParameters> = {}) =>
      new THREE.MeshPhysicalMaterial({ color, roughness: 0.48, clearcoat: 0.55, clearcoatRoughness: 0.35, ...o });
    const shadowTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(8,12,10,0.55)');
      grad.addColorStop(1, 'rgba(8,12,10,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    return {
      body: phys(COL.body),
      belly: phys(COL.belly, { roughness: 0.55 }),
      outline: phys(COL.outline, { roughness: 0.6 }),
      arm: phys(COL.arm, { roughness: 0.55 }),
      foot: phys(COL.foot, { roughness: 0.7 }),
      ink: phys(COL.ink, { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.08 }),
      white: new THREE.MeshBasicMaterial({ color: '#ffffff' }),
      blush: new THREE.MeshBasicMaterial({ color: COL.blush, transparent: true, opacity: 0.55, depthWrite: false }),
      lime: phys(COL.lime, { emissive: new THREE.Color(COL.lime), emissiveIntensity: 0.55 }),
      aqua: phys(COL.aqua, { emissive: new THREE.Color(COL.aqua), emissiveIntensity: 0.55 }),
      sun: phys(COL.sun, { emissive: new THREE.Color(COL.sun), emissiveIntensity: 0.35 }),
      ring: phys(COL.body, { roughness: 0.38, clearcoat: 0.8 }),
      shadow: new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
      bodyGeo: new THREE.LatheGeometry(PROFILE, 48),
      sphere: new THREE.SphereGeometry(1, 32, 24),
      arcUp: new THREE.TorusGeometry(0.2, 0.05, 10, 24, Math.PI),
      smile: new THREE.TorusGeometry(0.11, 0.032, 8, 20, Math.PI),
      ringGeo: new THREE.TorusGeometry(2.2, 0.125, 16, 96),
      antL: new THREE.TubeGeometry(
        new THREE.CubicBezierCurve3(new THREE.Vector3(wx(42), wy(33), 0.5), new THREE.Vector3(wx(38), wy(20), 0.45), new THREE.Vector3(wx(32), wy(15), 0.25), new THREE.Vector3(wx(27), wy(16), 0.15)),
        20,
        0.1,
        8,
      ),
      antR: new THREE.TubeGeometry(
        new THREE.CubicBezierCurve3(new THREE.Vector3(wx(78), wy(33), 0.5), new THREE.Vector3(wx(82), wy(20), 0.45), new THREE.Vector3(wx(88), wy(15), 0.25), new THREE.Vector3(wx(93), wy(16), 0.15)),
        20,
        0.1,
        8,
      ),
      capsule: new THREE.CapsuleGeometry(0.2, 0.55, 8, 16),
      plane: new THREE.PlaneGeometry(1, 1),
      // Notebook (typing while an agent works)
      box: new THREE.BoxGeometry(1, 1, 1),
      logoRing: new THREE.TorusGeometry(0.19, 0.04, 8, 28),
      lid: phys('#2a3532', { roughness: 0.35, metalness: 0.25, clearcoat: 0.7 }),
      deck: phys('#3a4744', { roughness: 0.45, metalness: 0.2 }),
      screen: new THREE.MeshBasicMaterial({ color: '#d9fff6' }),
    };
  }, []);
}

type Assets = ReturnType<typeof useAssets>;

// ---------- the creature ----------

function Eye({ a, x, side, shape, lid, tilt, blink }: { a: Assets; x: number; side: 1 | -1; shape: EyeShape; lid: number; tilt: number; blink: { get(): number } }) {
  const g = useRef<THREE.Group>(null);
  const pos = surface(x, 58, 0.02);
  const yaw = Math.atan2(pos[0], pos[2]);
  useFrame(() => {
    if (!g.current) return;
    const open = shape === 'open' || shape === 'wide';
    g.current.scale.y = open ? Math.max(0.06, blink.get() * (1 - lid * 0.62)) : 1;
  });
  const k = shape === 'wide' ? 1.12 : 1;
  return (
    <group position={pos} rotation={[0, yaw, (side * tilt * Math.PI) / 360]}>
      <group ref={g} position={[0, shape === 'open' ? -lid * 0.12 : 0, 0]}>
        {shape === 'happy' ? (
          <mesh geometry={a.arcUp} material={a.ink} position={[0, -0.06, 0.02]} />
        ) : shape === 'closed' ? (
          <mesh geometry={a.arcUp} material={a.ink} rotation={[0, 0, Math.PI]} position={[0, 0.06, 0.02]} />
        ) : (
          <>
            <mesh geometry={a.sphere} material={a.ink} scale={[0.33 * k, 0.4 * k, 0.16]} />
            <mesh geometry={a.sphere} material={a.white} scale={0.13 * k} position={[-0.08, 0.13, 0.13]} />
            <mesh geometry={a.sphere} material={a.white} scale={0.06 * k} position={[0.1, -0.15, 0.13]} />
          </>
        )}
      </group>
    </group>
  );
}

function Mouth({ a, kind }: { a: Assets; kind: (typeof EYE)[Expression]['mouth'] }) {
  const pos = surface(60, 66.5, 0.01);
  switch (kind) {
    case 'grin':
      return (
        <group position={pos}>
          <mesh geometry={a.sphere} material={a.ink} scale={[0.24, 0.17, 0.06]} position={[0, -0.02, 0]} />
          <mesh geometry={a.sphere} material={a.belly} scale={[0.26, 0.09, 0.08]} position={[0, 0.07, 0.01]} />
        </group>
      );
    case 'o':
      return <mesh geometry={a.sphere} material={a.ink} scale={[0.11, 0.13, 0.05]} position={pos} />;
    case 'flat':
      return <mesh geometry={a.capsule} material={a.ink} scale={[0.14, 0.2, 0.14]} rotation={[0, 0, Math.PI / 2]} position={pos} />;
    case 'sad':
      return <mesh geometry={a.smile} material={a.ink} position={[pos[0], pos[1] - 0.06, pos[2]]} />;
    case 'cat':
      return (
        <group position={pos}>
          <mesh geometry={a.smile} material={a.ink} rotation={[0, 0, Math.PI]} scale={0.7} position={[-0.08, 0.02, 0]} />
          <mesh geometry={a.smile} material={a.ink} rotation={[0, 0, Math.PI]} scale={0.7} position={[0.08, 0.02, 0]} />
        </group>
      );
    default:
      return <mesh geometry={a.smile} material={a.ink} rotation={[0, 0, Math.PI]} position={[pos[0], pos[1] + 0.04, pos[2]]} />;
  }
}

function Creature(props: Orbi2DProps) {
  const a = useAssets();
  const face = EYE[props.expression];
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const antL = useRef<THREE.Group>(null);
  const antR = useRef<THREE.Group>(null);
  const sat = useRef<THREE.Mesh>(null);
  const shadow = useRef<THREE.Mesh>(null);
  const laptop = useRef<THREE.Group>(null);
  const pawL = useRef<THREE.Mesh>(null);
  const pawR = useRef<THREE.Mesh>(null);
  const screenLight = useRef<THREE.PointLight>(null);
  // 0 = notebook put away, 1 = on the lap.
  const lap = useRef(props.working ? 1 : 0);

  const hop = useMotionValue(0);
  const sx = useMotionValue(1);
  const sy = useMotionValue(1);
  const shake = useMotionValue(0);
  const armRot = useMotionValue(0);
  const armLRot = useMotionValue(0);
  const antRot = useMotionValue(0);
  const blink = useMotionValue(1);
  const orbitSpeed = useRef(1);

  useEffect(() => {
    orbitSpeed.current = props.sleeping ? 0.35 : props.working ? 3.2 : 1;
  }, [props.sleeping, props.working]);

  // Blink
  useEffect(() => {
    if (props.still || face.shape === 'happy' || face.shape === 'closed') return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      t = setTimeout(() => {
        void animate(blink, [1, 0.08, 1], { duration: 0.16 });
        loop();
      }, 2400 + Math.random() * 4000);
    };
    loop();
    return () => clearTimeout(t);
  }, [props.still, face.shape, blink]);

  // Actions (same choreography as 2D, in 3D terms)
  useEffect(() => {
    const act = props.action;
    if (!act || props.still) return;
    switch (act.name) {
      case 'hop':
        void animate(hop, [0, 0, 0.45, 0, 0], { duration: 0.6, times: [0, 0.18, 0.5, 0.82, 1] });
        void animate(sy, [1, 0.9, 1.06, 0.94, 1], { duration: 0.6 });
        void animate(sx, [1, 1.07, 0.96, 1.04, 1], { duration: 0.6 });
        break;
      case 'bounce':
      case 'celebrate':
        void animate(hop, [0, 0.55, 0, 0.35, 0], { duration: 0.9 });
        void animate(armRot, [0, 0.4, -0.25, 0.4, 0], { duration: 0.9 });
        void animate(armLRot, [0, -0.5, -0.1, -0.5, 0], { duration: 0.9 });
        void animate(antRot, [0, 0.25, -0.2, 0.1, 0], { duration: 0.9 });
        orbitSpeed.current = 6;
        setTimeout(() => (orbitSpeed.current = props.working ? 3.2 : 1), 1100);
        break;
      case 'enter':
        void animate(hop, [1.4, 1.4, 0, 0.22, 0], { duration: 0.9, times: [0, 0.05, 0.55, 0.78, 1], ease: 'easeIn' });
        void animate(sy, [1, 1.06, 1.06, 0.84, 1.05, 1], { duration: 1 });
        void animate(sx, [1, 0.95, 0.95, 1.14, 0.97, 1], { duration: 1 });
        void animate(armRot, [0, 0, 0.32, -0.25, 0.32, -0.25, 0], { duration: 2.2 });
        break;
      case 'wave':
        void animate(armRot, [0, 0.32, -0.25, 0.32, -0.25, 0], { duration: 1.3 });
        break;
      case 'shake':
        void animate(shake, [0, -0.25, 0.22, -0.18, 0.12, 0], { duration: 0.55 });
        break;
      case 'wiggle':
        void animate(antRot, [0, 0.22, -0.16, 0.1, 0], { duration: 0.8 });
        break;
      case 'squash':
        void animate(sx, [1, 1.12, 0.96, 1], { duration: 0.42 });
        void animate(sy, [1, 0.86, 1.05, 1], { duration: 0.42 });
        break;
      case 'chomp':
        void animate(sy, [1, 0.96, 1.02, 0.96, 1.02, 1], { duration: 1.2 });
        break;
      case 'yawn':
      case 'stretch':
        void animate(sy, [1, 1.07, 0.97, 1], { duration: 1.2 });
        void animate(armLRot, [0, -0.45, 0], { duration: 1.2 });
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.action, props.still]);

  const orbitAngle = useRef(-0.9);
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const still = props.still;
    const breath = still ? 0 : Math.sin(t * (props.sleeping ? 1.2 : 1.75)) * (props.sleeping ? 0.03 : 0.018);
    if (root.current) {
      root.current.position.y = hop.get();
      root.current.rotation.z = shake.get();
    }
    if (body.current) body.current.scale.set(sx.get() * (1 + breath * 0.4), sy.get() * (1 + breath), sx.get());
    if (head.current) {
      head.current.rotation.y = THREE.MathUtils.lerp(head.current.rotation.y, props.lookX.get() * 0.42, 0.2);
      head.current.rotation.x = THREE.MathUtils.lerp(head.current.rotation.x, props.lookY.get() * 0.22, 0.2);
    }
    const sway = still ? 0 : Math.sin(t * 1.5) * 0.06;
    if (antL.current) antL.current.rotation.z = sway + antRot.get();
    if (antR.current) antR.current.rotation.z = -sway * 0.8 - antRot.get();
    if (armR.current) armR.current.rotation.z = (still ? 0 : Math.sin(t * 1.65) * 0.05) + armRot.get();
    if (armL.current) armL.current.rotation.z = armLRot.get();
    if (!still) orbitAngle.current += dt * ((Math.PI * 2) / 9) * orbitSpeed.current;
    if (sat.current) {
      const ang = orbitAngle.current;
      sat.current.position.set(Math.cos(ang) * 2.2, Math.sin(ang) * 2.2, 0);
    }
    if (shadow.current) {
      const k = 1 - hop.get() * 0.5;
      shadow.current.scale.set(3.6 * k, 0.9 * k, 1);
    }

    // Notebook slides up onto the lap; the resting arms tuck away and two paws type behind the lid.
    const goal = props.working ? 1 : 0;
    lap.current = still ? goal : THREE.MathUtils.damp(lap.current, goal, props.working ? 7 : 9, dt);
    const l = lap.current;
    if (laptop.current) {
      laptop.current.visible = l > 0.01;
      laptop.current.position.y = (1 - l) * -1.1;
      laptop.current.scale.setScalar(0.6 + 0.4 * l);
    }
    const arms = Math.max(0.001, 1 - Math.min(1, l * 2));
    armL.current?.scale.setScalar(arms);
    armR.current?.scale.setScalar(arms);
    if (props.working && !still) {
      const beat = t * 6.5 * Math.PI;
      const pause = Math.sin(t * 0.9) > 0.82;
      if (pawL.current) pawL.current.position.y = wy(76.5) + (pause ? 0 : Math.max(0, Math.sin(beat)) * 0.12);
      if (pawR.current) pawR.current.position.y = wy(76.5) + (pause ? 0 : Math.max(0, Math.sin(beat + Math.PI)) * 0.12);
    }
    if (screenLight.current) screenLight.current.intensity = l * (2.2 + (still ? 0 : 0.5 * Math.sin(t * 7.3) * Math.sin(t * 2.1)));
  });

  return (
    <group ref={root}>
      <mesh ref={shadow} geometry={a.plane} material={a.shadow} position={[0, wy(108), -0.2]} rotation={[-Math.PI / 2.3, 0, 0]} />
      {/* Feet */}
      <mesh geometry={a.sphere} material={a.foot} position={[wx(44), wy(98), 0.35]} scale={[0.5, 0.33, 0.55]} />
      <mesh geometry={a.sphere} material={a.foot} position={[wx(76), wy(98), 0.35]} scale={[0.5, 0.33, 0.55]} />

      <group ref={body} position={[0, wy(102), 0]}>
        <group position={[0, -wy(102), 0]}>
          <group ref={head}>
            <mesh geometry={a.bodyGeo} material={a.body} scale={[1, 1, DEPTH]} />
            {/* Belly patch hugging the front */}
            <mesh geometry={a.sphere} material={a.belly} position={[0, wy(78), surface(60, 78)[2] - 0.32]} scale={[1.0, 0.8, 0.36]} />

            {/* Antennae */}
            <group ref={antL} position={[wx(42), wy(33), 0.5]}>
              <group position={[-wx(42), -wy(33), -0.5]}>
                <mesh geometry={a.antL} material={a.outline} />
                <mesh geometry={a.sphere} material={a.lime} position={[wx(26), wy(16), 0.12]} scale={0.3} />
              </group>
            </group>
            <group ref={antR} position={[wx(78), wy(33), 0.5]}>
              <group position={[-wx(78), -wy(33), -0.5]}>
                <mesh geometry={a.antR} material={a.outline} />
                <mesh geometry={a.sphere} material={a.aqua} position={[wx(94), wy(16), 0.12]} scale={0.3} />
              </group>
            </group>

            {/* Face */}
            <mesh geometry={a.sphere} material={a.blush} position={surface(41, 67, 0.01)} scale={[0.25, 0.17, 0.05]} />
            <mesh geometry={a.sphere} material={a.blush} position={surface(79, 67, 0.01)} scale={[0.25, 0.17, 0.05]} />
            <Eye a={a} x={47} side={1} shape={face.shape} lid={face.lid} tilt={face.tilt} blink={blink} />
            <Eye a={a} x={73} side={-1} shape={face.shape} lid={face.lid} tilt={face.tilt} blink={blink} />
            <Mouth a={a} kind={face.mouth} />

            {/* Arms */}
            <group ref={armL} position={[wx(31), wy(70), 0.2]}>
              <mesh geometry={a.capsule} material={a.outline} position={[-0.12, -0.32, 0.25]} rotation={[0, 0, -0.25]} scale={[0.85, 0.75, 0.85]} />
            </group>
            <group ref={armR} position={[wx(89), wy(63), 0.2]}>
              <mesh geometry={a.capsule} material={a.arm} position={[0.38, 0.42, 0.1]} rotation={[0, 0, -0.75]} scale={[0.9, 0.95, 0.9]} />
              <mesh geometry={a.sphere} material={a.body} position={[wx(104) - wx(89), wy(44) - wy(63), 0.1]} scale={0.25} />
            </group>
          </group>
        </group>
      </group>

      {/* Notebook on the lap: the hinge is toward us, the screen faces Orbi and lights its face */}
      <group ref={laptop}>
        <pointLight ref={screenLight} position={[0, wy(70), 1.25]} color="#bff7ec" intensity={0} distance={3.2} decay={1.6} />
        <mesh geometry={a.box} material={a.deck} position={[0, wy(101), 1.6]} scale={[2.9, 0.12, 1.1]} />
        <group position={[0, wy(100.5), 2.12]} rotation={[-0.2, 0, 0]}>
          <mesh geometry={a.box} material={a.lid} position={[0, 0.6, 0]} scale={[2.4, 1.2, 0.08]} />
          <mesh geometry={a.plane} material={a.screen} position={[0, 0.6, -0.045]} rotation={[0, Math.PI, 0]} scale={[2.2, 1.05, 1]} />
          <mesh geometry={a.logoRing} material={a.aqua} position={[0, 0.6, 0.05]} />
          <mesh geometry={a.sphere} material={a.sun} position={[0.17, 0.74, 0.06]} scale={0.06} />
        </group>
        <mesh ref={pawL} geometry={a.sphere} material={a.body} position={[wx(47), wy(76.5), 1.85]} scale={[0.3, 0.22, 0.26]} />
        <mesh ref={pawR} geometry={a.sphere} material={a.body} position={[wx(73), wy(76.5), 1.85]} scale={[0.3, 0.22, 0.26]} />
      </group>

      {/* Orbital ring, tilted like the drawing: the front dips across the belly, the back rises behind the head */}
      <group position={[0, wy(64), 0]} rotation={[-1.32, 0, -0.09]}>
        <mesh geometry={a.ringGeo} material={a.ring} />
        <mesh ref={sat} geometry={a.sphere} material={a.sun} scale={0.22} />
        <mesh geometry={a.sphere} material={a.lime} position={[-2.2, 0, 0]} scale={0.15} />
        <mesh geometry={a.sphere} material={a.aqua} position={[Math.cos(0.5) * 2.2, Math.sin(0.5) * 2.2, 0]} scale={0.13} />
      </group>
    </group>
  );
}

/**
 * Render at `calmFps` at rest and 60 fps while something moves, whatever the
 * display's refresh rate. Between frames it sleeps on a timer rather than
 * waking on every display refresh.
 */
function FrameGovernor({ busyUntil, calmFps }: { busyUntil: React.MutableRefObject<number>; calmFps: number }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = (now: number) => {
      if (!document.hidden) invalidate();
      const ms = document.hidden ? 1000 : now < busyUntil.current ? 1000 / 60 : 1000 / calmFps;
      timer = setTimeout(() => (raf = requestAnimationFrame(tick)), ms);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [invalidate, busyUntil, calmFps]);
  return null;
}

export default function Orbi3D(props: Orbi2DProps) {
  const busyUntil = useRef(0);
  useEffect(() => {
    busyUntil.current = performance.now() + 1600;
  }, [props.action, props.expression, props.working]);
  useEffect(() => {
    const bump = () => (busyUntil.current = Math.max(busyUntil.current, performance.now() + 400));
    const offX = props.lookX.on('change', bump);
    return () => offX();
  }, [props.lookX]);

  return (
    <div style={{ width: props.size, height: props.size }}>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        camera={{ position: [0, 0.35, 12.6], fov: 26 }}
        style={{ background: 'transparent' }}
      >
        <hemisphereLight args={['#e6fff8', '#1a231f', 1.45]} />
        <directionalLight position={[-3, 5, 6]} intensity={2.1} />
        <directionalLight position={[4, 1.5, -4]} intensity={1.4} color="#5eead4" />
        <directionalLight position={[0, -3, 4]} intensity={0.35} color="#7ed5c3" />
        <group position={[0, -0.05, 0]}>
          <Creature {...props} />
        </group>
        {/* The small Orbi in the panel card breathes at 20 fps, like the 2D one. */}
        <FrameGovernor busyUntil={busyUntil} calmFps={props.ambient === 'full' ? 30 : 20} />
      </Canvas>
    </div>
  );
}
