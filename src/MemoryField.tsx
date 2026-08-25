import { useEffect, useRef } from "react";

type MemoryFieldProps = {
  mode: "IDLE" | "BLOCKED" | "BOUND" | "CLEARED";
  pulseKey?: string;
  ruleCount: number;
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  depth: number;
  phase: number;
};

const COLORS = {
  IDLE: [101, 246, 231],
  BLOCKED: [255, 79, 54],
  BOUND: [156, 115, 255],
  CLEARED: [75, 238, 179],
} as const;

function seeded(index: number, salt: number) {
  const value = Math.sin(index * 9283.31 + salt * 71.17) * 43758.5453;
  return value - Math.floor(value);
}

export default function MemoryField({ mode, pulseKey, ruleCount }: MemoryFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pulseRef = useRef(0);

  useEffect(() => {
    pulseRef.current = performance.now();
  }, [pulseKey, mode]);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) return;
    const contextElement = canvasElement.getContext("2d");
    if (!contextElement) return;
    const canvas: HTMLCanvasElement = canvasElement;
    const context: CanvasRenderingContext2D = contextElement;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const pointer = { x: window.innerWidth * 0.72, y: window.innerHeight * 0.34, tx: window.innerWidth * 0.72, ty: window.innerHeight * 0.34 };
    let width = 0;
    let height = 0;
    let ratio = 1;
    let frame = 0;
    let particles: Particle[] = [];

    function buildParticles() {
      const amount = Math.min(110, Math.max(58, Math.floor(width / 14)));
      particles = Array.from({ length: amount }, (_, index) => ({
        x: seeded(index, 1) * width,
        y: seeded(index, 2) * height,
        vx: (seeded(index, 3) - .5) * .14,
        vy: (seeded(index, 4) - .5) * .12,
        size: .45 + seeded(index, 5) * 1.5,
        depth: .25 + seeded(index, 6) * .75,
        phase: seeded(index, 7) * Math.PI * 2,
      }));
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      buildParticles();
    }

    function movePointer(event: PointerEvent) {
      pointer.tx = event.clientX;
      pointer.ty = event.clientY;
    }

    function draw(time: number) {
      frame = window.requestAnimationFrame(draw);
      const [red, green, blue] = COLORS[mode];
      const motion = reduceMotion ? 0 : time * .001;
      context.clearRect(0, 0, width, height);

      pointer.x += (pointer.tx - pointer.x) * .035;
      pointer.y += (pointer.ty - pointer.y) * .035;

      const aura = context.createRadialGradient(pointer.x, pointer.y, 0, pointer.x, pointer.y, Math.max(width, height) * .58);
      aura.addColorStop(0, `rgba(${red},${green},${blue},.12)`);
      aura.addColorStop(.42, `rgba(${red},${green},${blue},.035)`);
      aura.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = aura;
      context.fillRect(0, 0, width, height);

      particles.forEach((particle, index) => {
        if (!reduceMotion) {
          particle.x += particle.vx * particle.depth;
          particle.y += particle.vy * particle.depth;
          if (particle.x < -20) particle.x = width + 20;
          if (particle.x > width + 20) particle.x = -20;
          if (particle.y < -20) particle.y = height + 20;
          if (particle.y > height + 20) particle.y = -20;
        }

        const shimmer = .45 + Math.sin(motion * (1.1 + particle.depth) + particle.phase) * .28;
        context.beginPath();
        context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
        context.fillStyle = `rgba(198,224,226,${Math.max(.08, shimmer) * particle.depth})`;
        context.fill();

        if (index % 3 === 0) {
          for (let targetIndex = index + 1; targetIndex < Math.min(particles.length, index + 12); targetIndex += 1) {
            const target = particles[targetIndex];
            const distance = Math.hypot(particle.x - target.x, particle.y - target.y);
            if (distance < 135) {
              context.beginPath();
              context.moveTo(particle.x, particle.y);
              context.lineTo(target.x, target.y);
              context.strokeStyle = `rgba(101,246,231,${(1 - distance / 135) * .095})`;
              context.lineWidth = .6;
              context.stroke();
            }
          }
        }
      });

      const threadCount = Math.max(3, Math.min(7, ruleCount + 1));
      for (let index = 0; index < threadCount; index += 1) {
        const lane = (index + 1) / (threadCount + 1);
        const drift = Math.sin(motion * .42 + index * 1.37) * height * .08;
        context.beginPath();
        context.moveTo(-40, height * lane + drift);
        context.bezierCurveTo(
          width * .26, height * (lane + .19) - drift,
          width * .68, height * (lane - .22) + drift * .45,
          width + 40, height * lane - drift,
        );
        const gradient = context.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, "rgba(101,246,231,0)");
        gradient.addColorStop(.38, `rgba(${red},${green},${blue},${mode === "IDLE" ? .10 : .2})`);
        gradient.addColorStop(.72, "rgba(101,246,231,.13)");
        gradient.addColorStop(1, "rgba(101,246,231,0)");
        context.strokeStyle = gradient;
        context.lineWidth = index === ruleCount % threadCount ? 1.45 : .65;
        context.stroke();
      }

      const pulseAge = time - pulseRef.current;
      if (pulseAge >= 0 && pulseAge < 1800) {
        const progress = pulseAge / 1800;
        const eased = 1 - Math.pow(1 - progress, 3);
        const radius = eased * Math.max(width, height) * .72;
        context.beginPath();
        context.arc(width * .72, height * .46, radius, 0, Math.PI * 2);
        context.strokeStyle = `rgba(${red},${green},${blue},${(1 - progress) * .48})`;
        context.lineWidth = 1.2 + (1 - progress) * 2.6;
        context.stroke();
      }

      const coreX = width * .72 + Math.cos(motion * .36) * 22;
      const coreY = height * .38 + Math.sin(motion * .31) * 18;
      for (let ring = 0; ring < 4; ring += 1) {
        context.beginPath();
        context.ellipse(coreX, coreY, 48 + ring * 29, 29 + ring * 19, -.36 + ring * .13 + motion * .03, 0, Math.PI * 2);
        context.strokeStyle = `rgba(${red},${green},${blue},${.16 - ring * .027})`;
        context.lineWidth = ring === 0 ? 1.5 : .8;
        context.stroke();
      }
    }

    resize();
    window.addEventListener("resize", resize);
    if (!reduceMotion) window.addEventListener("pointermove", movePointer, { passive: true });
    frame = window.requestAnimationFrame(draw);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", movePointer);
    };
  }, [mode, ruleCount]);

  return <canvas className="memory-field" ref={canvasRef} aria-hidden="true" />;
}
