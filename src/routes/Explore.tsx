import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import {
  createChart,
  type BusinessDay,
  type CandlestickData,
  type Time,
  type ISeriesApi,
  type IChartApi,
} from "lightweight-charts";
import provider, { type OHLC } from "../lib/prices";
import { fetchCompaniesIndex, type Company, marketLabel } from "../lib/companies";
import { useI18n } from "../i18n/I18nProvider";
import "./Explore.css";
import {
  BarChart as RBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ReferenceLine,
  ResponsiveContainer,
  PieChart,
  Pie,
} from "recharts";


type TF = "1M" | "6M" | "YTD" | "1Y" | "MAX";

type GroupedCompany = {
  code: string;
  label: string;
  companies: Company[];
};

const MARKET_ICONS: Record<string, string> = {
  US: 'img/companies/categories/us.png',
  CN: 'img/companies/categories/cn.png',
  EU: 'img/companies/categories/eu.png',
  JP: 'img/companies/categories/jp.png',
  SA: 'img/companies/categories/sa.png',
  IDX: 'img/companies/categories/world.png',
  COM: 'img/companies/categories/commodities.png',
  CRYPTO: 'img/companies/categories/crypto.svg',
  FX: 'img/companies/categories/forex.png',
};

const DEFAULT_MARKET_ICON = 'img/companies/categories/world.png';

type GaugeVariant = "circular" | "linear";

type GaugeConfig = {
  value: number;
  min: number;
  max: number;
  format: (value: number) => string;
  variant?: GaugeVariant;
  target?: number;
};

type InsightItem = {
  key: string;
  label: string;
  description?: string;
  content?: ReactNode;
  gauge?: GaugeConfig;
};

type RangeItem = {
  key: string;
  label: string;
  description?: string;
  low: number;
  high: number;
  current: number;
  lowDate?: string;
  highDate?: string;
  currentDate?: string;
  lowLabel?: string;
  highLabel?: string;
  currentLabel?: string;
};

type MetricRow = {
  key: string;
  label: string;
  value: ReactNode;
};

type CompanyProfile = {
  symbol: string;
  name?: string;
  sector?: string;
  longName?: string;
  longBusinessSummary?: string;
  industryDisp?: string;
  website?: string;
  irWebsite?: string;
  beta?: number;
  recommendationMean?: number;
  marketCap?: number;
  marketCapRaw?: number;
  fiftyTwoWeeksHigh?: number;
  fiftyTwoWeeksHighDate?: string;
  fiftyTwoWeeksLow?: number;
  fiftyTwoWeeksLowDate?: string;
  allTimeHigh?: number;
  allTimeHighDate?: string;
  allTimeLow?: number;
  allTimeLowDate?: string;
  trailingPE?: number;
  trailingEPS?: number;
  totalRevenue?: number;
  totalDebt?: number;
  totalCash?: number;
  freeCashflow?: number;
  operatingCashflow?: number;
  displayName?: string;
  sectorDisplay?: string;
};

const DEFAULT_LOGO_STYLE: CSSProperties = {
  padding: 12,
  background: "linear-gradient(135deg, rgba(244,247,254,0.95), rgba(226,232,240,0.7))",
  border: "1px solid rgba(15,23,42,0.12)",
  boxShadow: "0 4px 14px rgba(15,23,42,0.16)",
};

const assetPath = (path: string) => {
  if (/^https?:/i.test(path)) return path;
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) ?? "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  const trimmed = path.replace(/^\/+/, "");
  return `${normalizedBase}${trimmed}`;
};

const toBusinessDay = (value: string | Date): BusinessDay => {
  if (typeof value === "string") {
    const [year, month, day] = value.split("-").map((x) => Number.parseInt(x, 10));
    return { year, month, day } as BusinessDay;
  }
  return {
    year: value.getFullYear(),
    month: value.getMonth() + 1,
    day: value.getDate(),
  } as BusinessDay;
};

const timeToDate = (value: Time): Date => {
  if (typeof value === "number") {
    return new Date(value * 1000);
  }
  if (typeof value === "string") {
    return new Date(value);
  }
  return new Date(value.year, value.month - 1, value.day);
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const numberFormatter = (maximumFractionDigits = 2, minimumFractionDigits = 0) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits, minimumFractionDigits });

const formatNumberValue = (value: number, maximumFractionDigits = 2, minimumFractionDigits = 0) =>
  numberFormatter(maximumFractionDigits, minimumFractionDigits).format(value);

const currencyFormatter = (maximumFractionDigits = 0) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits });

const compactCurrencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

const formatUSD = (value: number, maximumFractionDigits = 0) =>
  currencyFormatter(maximumFractionDigits).format(value);

const formatCompactUSD = (value: number) => compactCurrencyFormatter.format(value);


const toNumeric = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (value && typeof value === "object") {
    const container = value as Record<string, unknown>;
    if (typeof container.raw === "number" && Number.isFinite(container.raw)) return container.raw;
    if (typeof container.fmt === "number" && Number.isFinite(container.fmt)) return container.fmt;
    if (typeof container.fmt === "string") {
      const parsed = Number(container.fmt.replace(/[^\d.-]/g, ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
};

const normalizeProfile = (raw: any): CompanyProfile => {
  const sanitizeString = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim() : undefined;

  const profile: CompanyProfile = {
    symbol: sanitizeString(raw?.symbol) ?? "",
    name: sanitizeString(raw?.name),
    sector: sanitizeString(raw?.sector),
    longName: sanitizeString(raw?.longName),
    longBusinessSummary: sanitizeString(raw?.longBusinessSummary),
    industryDisp: sanitizeString(raw?.industryDisp),
    website: sanitizeString(raw?.website),
    irWebsite: sanitizeString(raw?.irWebsite),
  };

  const beta = toNumeric(raw?.beta);
  if (beta !== undefined) profile.beta = beta;

  const recommendationMean = toNumeric(raw?.recommendationMean);
  if (recommendationMean !== undefined) profile.recommendationMean = recommendationMean;

  const assignNumeric = (key: keyof CompanyProfile, value: unknown) => {
    const num = toNumeric(value);
    if (num !== undefined) (profile as any)[key] = num;
  };

  const assignString = (key: keyof CompanyProfile, value: unknown) => {
    const str = sanitizeString(value);
    if (str) (profile as any)[key] = str;
  };

  assignNumeric("marketCap", raw?.marketCap ?? raw?.marketCapRaw);
  assignNumeric("marketCapRaw", raw?.marketCapRaw ?? raw?.marketCap);
  assignNumeric("fiftyTwoWeeksHigh", raw?.fiftyTwoWeeksHigh);
  assignString("fiftyTwoWeeksHighDate", raw?.fiftyTwoWeeksHighDate);
  assignNumeric("fiftyTwoWeeksLow", raw?.fiftyTwoWeeksLow);
  assignString("fiftyTwoWeeksLowDate", raw?.fiftyTwoWeeksLowDate);
  assignNumeric("allTimeHigh", raw?.allTimeHigh);
  assignString("allTimeHighDate", raw?.allTimeHighDate);
  assignNumeric("allTimeLow", raw?.allTimeLow);
  assignString("allTimeLowDate", raw?.allTimeLowDate);
  assignNumeric("trailingPE", raw?.trailingPE);
  assignNumeric("trailingEPS", raw?.trailingEPS);
  assignNumeric("totalRevenue", raw?.totalRevenue);
  assignNumeric("totalDebt", raw?.totalDebt);
  assignNumeric("totalCash", raw?.totalCash);
  assignNumeric("freeCashflow", raw?.freeCashflow);
  assignNumeric("operatingCashflow", raw?.operatingCashflow);
  assignString("displayName", raw?.displayName);
  assignString("sectorDisplay", raw?.sectorDisplay);

  return profile;
};

const analyzeLogoAppearance = async (src: string): Promise<CSSProperties> => {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  const size = 64;

  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("logo-load-failed"));
    image.src = src;
  });

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return DEFAULT_LOGO_STYLE;
  }
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, size, size);
  } catch {
    return DEFAULT_LOGO_STYLE;
  }
  const data = imageData.data;
  let brightnessSum = 0;
  let pixelCount = 0;
  let edgePixels = 0;
  let opaqueEdgePixels = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = (y * size + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const a = data[idx + 3];
      if (a < 15) continue;
      pixelCount += 1;
      brightnessSum += 0.299 * r + 0.587 * g + 0.114 * b;
      const isEdge = x < 2 || x >= size - 2 || y < 2 || y >= size - 2;
      if (isEdge) {
        edgePixels += 1;
        if (a > 230) opaqueEdgePixels += 1;
      }
    }
  }

  const hasOpaqueFrame = edgePixels > 0 && opaqueEdgePixels / edgePixels > 0.85;
  if (hasOpaqueFrame) {
    return {
      padding: 0,
      background: "transparent",
      border: "0",
      boxShadow: "none",
      objectFit: "cover",
    };
  }

  const avgBrightness = pixelCount > 0 ? brightnessSum / pixelCount : 200;
  if (avgBrightness < 140) {
    return {
      padding: 12,
      background: "linear-gradient(135deg, rgba(248,250,252,0.96), rgba(226,232,240,0.72))",
      border: "1px solid rgba(15,23,42,0.18)",
      boxShadow: "0 4px 16px rgba(15,23,42,0.18)",
    };
  }
  if (avgBrightness > 200) {
    return {
      padding: 12,
      background: "linear-gradient(135deg, rgba(15,23,42,0.9), rgba(30,41,59,0.75))",
      border: "1px solid rgba(15,23,42,0.32)",
      boxShadow: "0 4px 18px rgba(15,23,42,0.3)",
    };
  }
  return {
    padding: 12,
    background: "linear-gradient(135deg, rgba(240,244,255,0.95), rgba(226,232,240,0.75))",
    border: "1px solid rgba(15,23,42,0.14)",
    boxShadow: "0 4px 16px rgba(15,23,42,0.2)",
  };
};

// ---------- Gauge utils ----------

// --- Color utils (HSL) ---
const hsl = (h: number, s = 72, l = 45) => `hsl(${Math.round(h)} ${s}% ${l}%)`;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;


// Bêta : <1 -> du bleu vers le vert ; 1 -> vert ; >1 -> du vert vers le rouge
function betaValueColor(value: number, min: number, max: number) {
  const target = 1;
  const belowT = clamp01((value - min) / Math.max(0.0001, target - min)); // [min..1] -> [0..1]
  const aboveT = clamp01((value - target) / Math.max(0.0001, max - target)); // [1..max] -> [0..1]
  // teinte bleu≈215° -> vert≈135° -> rouge≈0°
  if (value <= target) return hsl(lerp(215, 135, belowT));
  return hsl(lerp(135, 0, aboveT));
}

// Reco (1=achat fort ... 5=vente) : 1 -> vert ; 5 -> rouge
function recommendationValueColor(value: number) {
  const t = clamp01((value - 1) / 4); // [1..5] -> [0..1]
  return hsl(lerp(135, 0, t));        // vert≈135° -> rouge≈0°
}


/** Pie (demi-cercle) avec aiguille + repère à 1 + labels collés à l’arc */
function GaugeBetaNeedle({
  value,
  min,
  max,
  label,
  valueColor,
}: {
  value: number;
  min: number;
  max: number;
  color?: string;
  label?: string;
  valueColor?: string;
}) {
  // ====== RÉGLAGES VISUELS (AJUSTE ICI) ======

  // 1) Anneau (doit matcher le <Pie> plus bas)
  const ARC = {
    innerPct: 0.68,   // épaisseur intérieure (innerRadius="68%")
    outerPct: 1,   // épaisseur extérieure (outerRadius="86%")
    cyRatio: 0.65,    // position verticale du centre (0=haut, 1=bas)
  };

  // 2) Aiguille
  const NEEDLE = {
    lengthRatio: 0.44, // longueur relative (0..1)
    stroke: 3,         // épaisseur
    hub: 4,            // rayon du pivot
    color: "#334155",  // couleur
  };

  // 3) Repère “1”
  const ONE_MARKER = {
    TIE_TO_ARC: false,  // true = colle pile à l’anneau ; false = libre (startRatio/endRatio)
    startRatio: 0.33,  // si TIE_TO_ARC=false : début (0..1)
    endRatio: 0.50,    // si TIE_TO_ARC=false : fin (0..1)
    stroke: 2,         // épaisseur du trait
    color: "#0f172a",  // couleur
    cap: "round" as const,
    labelOffset: 14,   // ← ICI : distance (px) du petit "1" par rapport au bord externe
    labelFont: 12,     // ← ICI : taille (px) du petit "1"
  };

  // 4) Labels sur l’arc (0 et 3 / min et max)
  const TICKS = {
    offset: 10,        // ← ICI : distance (px) des labels 0 et 3 au-delà du bord externe
    font: 12,          // ← ICI : taille (px) des labels 0 et 3
  };

  // 5) Valeur centrale (ex: 1.25)
  const VALUE_LABEL = {
    topPct: 0.75,      // ← ICI : place la valeur (0=haut, 1=bas). 0.83 = plus bas qu’avant
    font: 20,          // taille (px)
  };

  const HEIGHT = 200; // hauteur du composant

  // ====== CALCULS ======
  const span = Math.max(0.0001, max - min);
  const v = Math.max(min, Math.min(max, value));
  const pct = (v - min) / span;

  const START = 180;
  const END = 0;

  // Dégradé bleu -> vert -> rouge
  const gradientId = "betaGradient";
  const gradient = (
    <defs>
      <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%"   stopColor="#1d4ed8" />
        <stop offset="50%"  stopColor="#16a34a" />
        <stop offset="100%" stopColor="#dc2626" />
      </linearGradient>
    </defs>
  );

  const trackData = [{ name: "track", val: span }];

  // Mesure conteneur pour overlay
  const theta = Math.PI * (1 - pct);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const base = Math.min(box.w, box.h);
  const cx = box.w / 2;
  const cy = box.h * ARC.cyRatio;

  // Aiguille
  const needleR = base * NEEDLE.lengthRatio; // ← longueur de l’aiguille
  const x2 = cx + needleR * Math.cos(theta);
  const y2 = cy - needleR * Math.sin(theta);

  // Repère "1" (angle de 1)
  const stdPct = (1 - min) / span;
  const stdTheta = Math.PI * (1 - stdPct);

  // Rayons de début/fin du repère (collé à l’anneau ou libre)
  const markerInnerR = ONE_MARKER.TIE_TO_ARC
    ? base * (ARC.innerPct / 2)
    : base * ONE_MARKER.startRatio;
  const markerOuterR = ONE_MARKER.TIE_TO_ARC
    ? base * (ARC.outerPct / 2)
    : base * ONE_MARKER.endRatio;

  // Coordonnées du trait “1”
  const xStdIn  = cx + markerInnerR * Math.cos(stdTheta);
  const yStdIn  = cy - markerInnerR * Math.sin(stdTheta);
  const xStdOut = cx + markerOuterR * Math.cos(stdTheta);
  const yStdOut = cy - markerOuterR * Math.sin(stdTheta);

  // Position du petit label "1" (juste au-delà du bord externe)
  const oneLabelR = markerOuterR + ONE_MARKER.labelOffset;
  const xOne = cx + oneLabelR * Math.cos(stdTheta);
  const yOne = cy - oneLabelR * Math.sin(stdTheta);

  // Positions des labels min/max (0 et 3) collés à l’arc
  const outerR = base * (ARC.outerPct / 2);
  const tickR = outerR + TICKS.offset;

  const xMin = cx + tickR * Math.cos(Math.PI); // angle gauche
  const yMin = cy - tickR * Math.sin(Math.PI);

  const xMax = cx + tickR * Math.cos(0);       // angle droit
  const yMax = cy - tickR * Math.sin(0);

  return (
    <div className="gauge-wrapper" style={{ width: "100%", height: HEIGHT, position: "relative" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {gradient}
          <Pie
            data={trackData}
            dataKey="val"
            startAngle={START}
            endAngle={END}
            cx="50%"
            cy={`${ARC.cyRatio * 100}%`}
            innerRadius={`${ARC.innerPct * 100}%`}
            outerRadius={`${ARC.outerPct * 100}%`}
            stroke="none"
            isAnimationActive={false}
            fill={`url(#${gradientId})`}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Overlay : aiguille + repère “1” + labels sur l’arc */}
      <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {box.w > 0 && (
          <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}>
            {/* Aiguille */}
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={NEEDLE.color} strokeWidth={NEEDLE.stroke} />
            <circle cx={cx} cy={cy} r={NEEDLE.hub} fill={NEEDLE.color} />

            {/* Repère radial à 1 */}
            <line
              x1={xStdIn}
              y1={yStdIn}
              x2={xStdOut}
              y2={yStdOut}
              stroke={ONE_MARKER.color}
              strokeWidth={ONE_MARKER.stroke}
              strokeLinecap={ONE_MARKER.cap}
            />
            {/* Petit "1" à côté du repère */}
            <text
              x={xOne}
              y={yOne}
              fontSize={ONE_MARKER.labelFont}
              fill="#334155"
              textAnchor="middle"
              dominantBaseline="middle"
              style={{ fontWeight: 600 }}
            >
              1
            </text>

            {/* Labels min et max collés à l'arc */}
            <text
              x={xMin}
              y={yMin}
              fontSize={TICKS.font}
              fill="#475569"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {min}
            </text>
            <text
              x={xMax}
              y={yMax}
              fontSize={TICKS.font}
              fill="#475569"
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {max}
            </text>
          </svg>
        )}
      </div>

      {/* Valeur centrale — plus bas (VALUE_LABEL.topPct) */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${VALUE_LABEL.topPct * 100}%`, // ← DESCENDS/REMONTES la valeur ici
          transform: "translate(-50%, -50%)",
          fontSize: VALUE_LABEL.font,
          fontWeight: 800,
          color: valueColor ?? "var(--primary-700)",
          textAlign: "center",
        }}
      >
        {label ?? v.toFixed(2)}
      </div>
    </div>
  );
}

function GaugeNeedle({
  value,
  min,
  max,
  label,
  valueColor,
  gradient = "beta",
  customStops,
  fillToNeedle = false,
  showStandardTick = false,
  standardValue = 1,
}: {
  value: number;
  min: number;
  max: number;
  label?: string;
  valueColor?: string;
  gradient?: "beta" | "reco";
  customStops?: Array<{ offset: number; color: string }>;
  fillToNeedle?: boolean;
  showStandardTick?: boolean;
  standardValue?: number;
}) {
  // Réglages visuels unifiés (cohérents avec ta jauge Bêta)
  const ARC = { innerPct: 0.68, outerPct: 1.00, cyRatio: 0.65 };
  const NEEDLE = { lengthRatio: 0.44, stroke: 3, hub: 4, color: "#334155" };
  const TICKS = { offset: 10, font: 12 };
  const VALUE_LABEL = { topPct: 0.75, font: 20 };
  const TRACK_COLOR = "rgba(148,163,184,0.18)"; // piste claire
  const HEIGHT = 160;

  // Normalisation
  const span = Math.max(0.0001, max - min);
  const v = Math.max(min, Math.min(max, value));
  const pct = (v - min) / span;

  // Demi-cercle gauche (180°) -> droite (0°)
  const START = 180;
  const END = 0;

  // Angle de l’aiguille
  const needleAngle = START + pct * (END - START); // linéaire sur 180°

  // Dégradés
  const gradId = useMemo(() => `gn-grad-${Math.random().toString(36).slice(2)}`, []);
  const defaultStops =
    gradient === "beta"
      ? [
          { offset: 0, color: "#1d4ed8" }, // bleu
          { offset: 50, color: "#16a34a" }, // vert
          { offset: 100, color: "#dc2626" }, // rouge
        ]
      : [
          { offset: 0, color: "#16a34a" }, // vert
          { offset: 50, color: "#f59e0b" }, // jaune
          { offset: 100, color: "#dc2626" }, // rouge
        ];
  const stops = customStops ?? defaultStops;

  const gradientSvg = (
    <defs>
      <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
        {stops.map((s, i) => (
          <stop key={i} offset={`${s.offset}%`} stopColor={s.color} />
        ))}
      </linearGradient>
    </defs>
  );

  // Données “pleines” pour dessiner un arc complet
  const trackData = [{ name: "track", val: 1 }];

  // Overlay (aiguille + labels)
  const [box, setBox] = useState({ w: 0, h: 0 });
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setBox({ w: width, h: height });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const cx = box.w / 2;
  const cy = box.h * ARC.cyRatio;
  const base = Math.min(box.w, box.h);

  // Aiguille
  const theta = (needleAngle * Math.PI) / 180;
  const needleR = base * NEEDLE.lengthRatio;
  const x2 = cx + needleR * Math.cos(theta);
  const y2 = cy - needleR * Math.sin(theta);

  // Labels min/max collés à l’arc
  const outerR = base * (ARC.outerPct / 2);
  const tickR = outerR + TICKS.offset;
  const xMin = cx + tickR * Math.cos(Math.PI);
  const yMin = cy - tickR * Math.sin(Math.PI);
  const xMax = cx + tickR * Math.cos(0);
  const yMax = cy - tickR * Math.sin(0);

  // Repère standard (ex: 1 pour Bêta)
  const stdPct = (standardValue - min) / span;
  const stdTheta = Math.PI * (1 - stdPct);
  const markerInnerR = base * (ARC.innerPct / 2);
  const markerOuterR = base * (ARC.outerPct / 2);
  const xStdIn = cx + markerInnerR * Math.cos(stdTheta);
  const yStdIn = cy - markerInnerR * Math.sin(stdTheta);
  const xStdOut = cx + markerOuterR * Math.cos(stdTheta);
  const yStdOut = cy - markerOuterR * Math.sin(stdTheta);

  return (
    <div style={{ width: "100%", height: HEIGHT, position: "relative" }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          {gradientSvg}

          {/* 1) piste grise sur tout l’arc */}
          <Pie
            data={trackData}
            dataKey="val"
            startAngle={START}
            endAngle={END}
            cx="50%"
            cy={`${ARC.cyRatio * 100}%`}
            innerRadius={`${ARC.innerPct * 100}%`}
            outerRadius={`${ARC.outerPct * 100}%`}
            isAnimationActive={false}
            stroke="none"
            fill={TRACK_COLOR}
          />

          {/* 2) gradient sur TOUT l’arc (uniforme) */}
          <Pie
            data={trackData}
            dataKey="val"
            startAngle={START}
            endAngle={END}
            cx="50%"
            cy={`${ARC.cyRatio * 100}%`}
            innerRadius={`${ARC.innerPct * 100}%`}
            outerRadius={`${ARC.outerPct * 100}%`}
            isAnimationActive={false}
            stroke="none"
            fill={`url(#${gradId})`}
          />

          {/* 3) masque : on recouvre APRÈS l’aiguille avec la couleur de fond */}
          {fillToNeedle && (
            <Pie
              data={trackData}
              dataKey="val"
              startAngle={needleAngle}
              endAngle={END}
              cx="50%"
              cy={`${ARC.cyRatio * 100}%`}
              innerRadius={`${ARC.innerPct * 100}%`}
              outerRadius={`${ARC.outerPct * 100}%`}
              isAnimationActive={false}
              fill="rgba(148,163,184)"  // gris neutre semi-transparent
              stroke="rgba(148,163,184)"
            />
          )}
        </PieChart>
      </ResponsiveContainer>

      {/* Overlay : aiguille + repère + labels sur l’arc */}
      <div ref={ref} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        {box.w > 0 && (
          <svg width={box.w} height={box.h} viewBox={`0 0 ${box.w} ${box.h}`}>
            {/* Aiguille */}
            <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={NEEDLE.color} strokeWidth={NEEDLE.stroke} />
            <circle cx={cx} cy={cy} r={NEEDLE.hub} fill={NEEDLE.color} />

            {/* Repère standard (optionnel) */}
            {showStandardTick && (
              <>
                <line
                  x1={xStdIn}
                  y1={yStdIn}
                  x2={xStdOut}
                  y2={yStdOut}
                  stroke="#0f172a"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
                <text
                  x={cx + (markerOuterR + 12) * Math.cos(stdTheta)}
                  y={cy - (markerOuterR + 12) * Math.sin(stdTheta)}
                  fontSize={12}
                  fill="#334155"
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{ fontWeight: 600 }}
                >
                  {standardValue}
                </text>
              </>
            )}

            {/* Min / Max aux extrémités de l’arc */}
            <text x={xMin} y={yMin} fontSize={TICKS.font} fill="#475569" textAnchor="middle" dominantBaseline="middle">
              {min}
            </text>
            <text x={xMax} y={yMax} fontSize={TICKS.font} fill="#475569" textAnchor="middle" dominantBaseline="middle">
              {max}
            </text>
          </svg>
        )}
      </div>

      {/* Valeur au centre */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: `${VALUE_LABEL.topPct * 100}%`,
          transform: "translate(-50%, -50%)",
          fontSize: VALUE_LABEL.font,
          fontWeight: 800,
          color: valueColor ?? "var(--primary-700)",
          pointerEvents: "none",
          textAlign: "center",
        }}
      >
        {label ?? v.toFixed(2)}
      </div>
    </div>
  );
}



export default function Explore() {
  const { t } = useI18n();
  const [symbol, setSymbol] = useState<string>("AAPL");
  const [tf, setTf] = useState<TF | null>("6M");
  const [data, setData] = useState<OHLC[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [expandedMarkets, setExpandedMarkets] = useState<Record<string, boolean>>({});
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const searchMode = trimmedQuery.length > 0;
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const profileCacheRef = useRef<Map<string, CompanyProfile>>(new Map());
  const suppressRangeUpdateRef = useRef<boolean>(false);
  const lastIndexRef = useRef(0);
  const firstIndexRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const idx = await fetchCompaniesIndex();
        if (cancelled) return;
        setCompanies(idx);
      } catch {
        // Ignore network errors for now; UI will simply show an empty list.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!companies.length) return;
    if (companies.some((c) => c.symbol === symbol)) return;

    const firstUS = companies.find((c) => (c.market || "").toUpperCase() === "US");
    const fallback = firstUS?.symbol ?? companies[0]?.symbol;
    if (fallback) setSymbol(fallback);
  }, [companies, symbol]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const hist = await provider.getDailyHistory(symbol);
        if (!cancelled) setData(hist);
      } catch {
        if (!cancelled) setData([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const grouped = useMemo<GroupedCompany[]>(() => {
    const ordered = groupByMarket(companies);
    return Object.entries(ordered).map(([code, list]) => ({
      code,
      label: marketLabel(code),
      companies: list,
    }));
  }, [companies]);

  useEffect(() => {
    if (searchMode) return;
    setExpandedMarkets((prev) => {
      const next = { ...prev };
      grouped.forEach((group, index) => {
        if (!(group.code in next)) {
          const containsSelected = group.companies.some((company) => company.symbol === symbol);
          next[group.code] = containsSelected || index === 0;
        }
      });
      return next;
    });
  }, [grouped, symbol, searchMode]);

  useEffect(() => {
    if (searchMode) return;
    const owner = grouped.find((group) =>
      group.companies.some((company) => company.symbol === symbol)
    );
    if (!owner) return;
    setExpandedMarkets((prev) => {
      if (prev[owner.code]) return prev;
      return { ...prev, [owner.code]: true };
    });
  }, [grouped, symbol, searchMode]);

  const filteredCompanies = useMemo(() => {
    if (!searchMode) return companies;
    const q = trimmedQuery.toLowerCase();
    return companies.filter(
      (c) => c.symbol.toLowerCase().includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  }, [companies, trimmedQuery, searchMode]);

  const searchResults = useMemo(() => {
    if (!searchMode) return [];
    return [...filteredCompanies].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [filteredCompanies, searchMode]);

  const selectedCompany = useMemo(
    () => companies.find((c) => c.symbol === symbol) ?? null,
    [companies, symbol]
  );

  useEffect(() => {
    const company = selectedCompany;
    if (!company?.profile) {
      setProfile(null);
      return;
    }
    const profileUrl = assetPath(company.profile);
    const cached = profileCacheRef.current.get(profileUrl);
    if (cached) {
      setProfile(cached);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(profileUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`profile fetch failed: ${response.status}`);
        const raw = await response.json();
        const normalized = normalizeProfile(raw);
        const enriched: CompanyProfile = {
          ...normalized,
          symbol: company.symbol,
          name: company.name ?? normalized.name,
          sector: company.sector ?? normalized.sector,
        };
        profileCacheRef.current.set(profileUrl, enriched);
        if (!cancelled) setProfile(enriched);
      } catch (error) {
        console.warn("[profile] load failed", error);
        if (!cancelled) setProfile(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompany]);

  const dateBounds = useMemo(() => {
    if (!data.length) return null;
    const firstDate = new Date(data[0].date);
    firstDate.setHours(0, 0, 0, 0);

    // on recule un peu la borne gauche pour éviter d’être “collé” au bord
    const min = shiftDays(firstDate, -30);
    min.setHours(0, 0, 0, 0);

    // borne droite = DERNIÈRE bougie (pas “aujourd’hui”)
    const lastDate = new Date(data[data.length - 1].date);
    lastDate.setHours(0, 0, 0, 0);

    return { min, max: lastDate };
  }, [data]);

  const setVisibleRangeClamped = useCallback(
    (fromDate: Date, toDate: Date) => {
      if (!chartRef.current) return;
      const timeScale = chartRef.current.timeScale();
      let rangeStart = new Date(fromDate);
      let rangeEnd = new Date(toDate);
      if (rangeStart.getTime() > rangeEnd.getTime()) {
        const temp = rangeStart;
        rangeStart = rangeEnd;
        rangeEnd = temp;
      }
      if (dateBounds) {
        const clamped = clampDateRange(rangeStart, rangeEnd, dateBounds);
        rangeStart = clamped.from;
        rangeEnd = clamped.to;
      }
      suppressRangeUpdateRef.current = true;
      timeScale.setVisibleRange({
        from: toBusinessDay(rangeStart),
        to: toBusinessDay(rangeEnd),
      });
      const release = () => {
        suppressRangeUpdateRef.current = false;
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(release);
      } else {
        setTimeout(release, 0);
      }
    },
    [dateBounds]
  );

  const applyTimeframeRange = useCallback(
    (timeframe: TF) => {
      if (!data.length) return;
      if (data.length < 2) {
        chartRef.current?.timeScale().fitContent();
        return;
      }
      const lastEntry = data[data.length - 1];
      const lastDate = new Date(lastEntry.date);
      let fromDate = new Date(data[0].date);
      const currentYearStart = new Date(new Date().getFullYear(), 0, 1);

      if (timeframe === "1M") {
        fromDate = shiftDays(lastDate, -30);
      } else if (timeframe === "6M") {
        fromDate = shiftDays(lastDate, -182);
      } else if (timeframe === "1Y") {
        fromDate = shiftDays(lastDate, -365);
      } else if (timeframe === "YTD") {
        fromDate = currentYearStart;
      } else if (timeframe === "MAX") {
        if (dateBounds) {
          setVisibleRangeClamped(dateBounds.min, dateBounds.max);
        } else {
          setVisibleRangeClamped(new Date(data[0].date), lastDate);
        }
        return;
      }

      setVisibleRangeClamped(fromDate, lastDate);
    },
    [data, dateBounds, setVisibleRangeClamped]
  );

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const element = chartContainerRef.current;
    
    const chart = createChart(element, {
      width: element.clientWidth,
      height: element.clientHeight,
      layout: {
        background: { color: "transparent" },
        textColor: "#0f172a",
      },
      grid: {
        vertLines: { color: "rgba(15,23,42,0.08)" },
        horzLines: { color: "rgba(15,23,42,0.05)" },
      },
      rightPriceScale: {
        borderColor: "rgba(15,23,42,0.08)",
      },
      timeScale: {
        borderColor: "rgba(15,23,42,0.08)",
      },
      crosshair: {
        mode: 1,
      },
    });

    // v3 officiel : addCandlestickSeries
    const series = chart.addCandlestickSeries({
      upColor: "#16a34a",
      downColor: "#dc2626",
      wickUpColor: "#16a34a",
      wickDownColor: "#dc2626",
      borderUpColor: "#16a34a",
      borderDownColor: "#dc2626",
    });

    chartRef.current = chart;
    seriesRef.current = series;


    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      chart.resize(width, height);
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    const formatted: CandlestickData[] = data.map((d) => ({
      time: d.date as Time,
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
    }));
    seriesRef.current.setData(formatted);
    firstIndexRef.current = 0;
    lastIndexRef.current = formatted.length ? formatted.length - 1 : 0;
  }, [data]);

  useEffect(() => {
    if (tf) applyTimeframeRange(tf);
  }, [tf, applyTimeframeRange]);

  useEffect(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();

    const handler = (range: { from: number; to: number } | null) => {
      if (!range) return;

      // 1) Si pan/zoom utilisateur -> déselectionne les boutons
      if (!suppressRangeUpdateRef.current) {
        if (tf !== null) setTf(null);
      }

      // 2) Clamp blanc gauche/droite à 15 % de la fenêtre visible
      const span = range.to - range.from;
      if (!Number.isFinite(span) || span <= 0) return;

      const first = firstIndexRef.current;   // en pratique 0
      const last  = lastIndexRef.current;

      // bornes autorisées en logique
      const minFrom = first - span * 0.15;   // ≤ 15 % de blanc à gauche
      const maxTo   = last  + span * 0.15;   // ≤ 15 % de blanc à droite

      let newFrom = range.from;
      let newTo   = range.to;

      // clamp à gauche
      if (newFrom < minFrom) {
        newFrom = minFrom;
        newTo   = newFrom + span;
      }

      // clamp à droite
      if (newTo > maxTo) {
        newTo   = maxTo;
        newFrom = newTo - span;
      }

      // si rien n'a changé -> on sort
      if (newFrom === range.from && newTo === range.to) return;

      suppressRangeUpdateRef.current = true;
      timeScale.setVisibleLogicalRange({ from: newFrom, to: newTo });

      // relâche le flag au prochain frame
      (typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn: FrameRequestCallback) => setTimeout(fn, 0)
      )(() => { suppressRangeUpdateRef.current = false; });
    };


    timeScale.subscribeVisibleLogicalRangeChange(handler);
    return () => {
      timeScale.unsubscribeVisibleLogicalRangeChange(handler);
    };
  }, [tf]);



  const lastClose = data.at(-1)?.close ?? 0;
  const lastCloseLabel = data.length ? lastClose.toFixed(2) : "--";
  const lastPriceDate = data.at(-1)?.date;

  const displayName = profile?.displayName ?? profile?.longName ?? selectedCompany?.name ?? symbol;
  const longNameSuffix =
    profile?.longName && profile.longName !== displayName ? ` · ${profile.longName}` : "";
  const subtitleParts: string[] = [symbol];
  if (profile?.sectorDisplay) {
    subtitleParts.push(profile.sectorDisplay);
  } else if (profile?.sector) {
    subtitleParts.push(profile.sector);
  } else if (profile?.industryDisp) {
    subtitleParts.push(profile.industryDisp);
  } else if (selectedCompany?.sector) {
    subtitleParts.push(selectedCompany.sector);
  } else if (selectedCompany?.name) {
    subtitleParts.push(selectedCompany.name);
  }
  const subtitle = subtitleParts.join(" - ");

  const ensureProtocol = (url: string) =>
    /^https?:/i.test(url) ? url : `https://${url}`;

  const insights = useMemo(() => {
    if (!profile) return { gauges: [], ranges: [], metrics: [] };
    const gauges: InsightItem[] = [];
    const ranges: RangeItem[] = [];
    const metrics: MetricRow[] = [];
    type Key = Parameters<typeof t>[0];

    if (profile.beta !== undefined) {
      const betaValue = profile.beta;
      const betaMin = Math.min(-1, Math.floor(betaValue - 1));
      const betaMax = Math.max(3, Math.ceil(betaValue + 1));

      gauges.push({
        key: "beta",
        label: t("explore.metrics.beta"),
        description: t("explore.metrics.beta.help"),
        gauge: {
          value: betaValue,
          min: betaMin,
          max: betaMax,
          target: 1,
          format: (val) => val.toFixed(2),
        },
      });
    }

    if (profile.recommendationMean !== undefined) {
      gauges.push({
        key: "recommendation",
        label: t("explore.metrics.recommendationMean"),
        description: t("explore.metrics.recommendationMean.help"),
        gauge: {
          value: profile.recommendationMean,
          min: 1,
          max: 5,
          format: (val) => val.toFixed(1),
        },
      });
    }

    const addNumberMetric = (
      key: string,
      labelKey: Key,
      value: number | undefined,
      formatter: (value: number) => ReactNode
    ) => {
      if (value === undefined) return;
      metrics.push({
        key,
        label: t(labelKey),
        value: formatter(value),
      });
    };

    const addCurrencyMetric = (key: string, labelKey: Key, value: number | undefined) => {
      if (value === undefined) return;
      metrics.push({
        key,
        label: t(labelKey),
        value: (
          <div className="metric-stack">
            <span className="metric-main">{formatCompactUSD(value)}</span>
            <span className="metric-sub">{formatUSD(value)}</span>
          </div>
        ),
      });
    };

    const addRange = (
      key: string,
      labelKey: Key,
      min: number | undefined,
      max: number | undefined,
      helpKey?: Key,
      current?: number,
      minDate?: string,
      maxDate?: string,
      currentDate?: string
    ) => {
      if (min === undefined || max === undefined) return;
      ranges.push({
        key,
        label: t(labelKey),
        description: helpKey ? t(helpKey) : undefined,
        low: min,
        high: max,
        current: current ?? lastClose,
        lowDate: minDate,
        highDate: maxDate,
        currentDate,
        lowLabel: t("explore.metrics.range.low"),
        highLabel: t("explore.metrics.range.high"),
        currentLabel: t("explore.metrics.range.current"),
      });
    };

    addNumberMetric("trailingPE", "explore.metrics.trailingPE", profile.trailingPE, (value) =>
      formatNumberValue(value, 2)
    );
    addNumberMetric("trailingEPS", "explore.metrics.trailingEPS", profile.trailingEPS, (value) =>
      formatNumberValue(value, 2)
    );

    addCurrencyMetric("marketCap", "explore.metrics.marketCap", profile.marketCap ?? profile.marketCapRaw);
    addCurrencyMetric("totalRevenue", "explore.metrics.totalRevenue", profile.totalRevenue);
    addCurrencyMetric("totalDebt", "explore.metrics.totalDebt", profile.totalDebt);
    addCurrencyMetric("totalCash", "explore.metrics.totalCash", profile.totalCash);
    addCurrencyMetric("freeCashflow", "explore.metrics.freeCashflow", profile.freeCashflow);
    addCurrencyMetric("operatingCashflow", "explore.metrics.operatingCashflow", profile.operatingCashflow);

    addRange(
      "fiftyTwoWeeksRange",
      "explore.metrics.fiftyTwoWeeksRange",
      profile.fiftyTwoWeeksLow,
      profile.fiftyTwoWeeksHigh,
      "explore.metrics.fiftyTwoWeeksRange.help",
      lastClose,
      profile.fiftyTwoWeeksLowDate,
      profile.fiftyTwoWeeksHighDate,
      lastPriceDate ?? undefined
    );

    addRange(
      "allTimeRange",
      "explore.metrics.allTimeRange",
      profile.allTimeLow,
      profile.allTimeHigh,
      "explore.metrics.allTimeRange.help",
      lastClose,
      profile.allTimeLowDate,
      profile.allTimeHighDate,
      lastPriceDate ?? undefined
    );

    return { gauges, ranges, metrics };
  }, [profile, t, lastClose, lastPriceDate]);
  const { gauges, ranges, metrics } = insights;

  const headerMeta = useMemo(() => {
    if (!profile) return [];
    const items: { key: string; label: string; value: ReactNode }[] = [];

    if (profile.sectorDisplay || profile.sector) {
      items.push({
        key: "sector",
        label: t("explore.metrics.sectorDisplay"),
        value: profile.sectorDisplay ?? profile.sector ?? "",
      });
    }

    if (profile.industryDisp) {
      items.push({
        key: "industry",
        label: t("explore.metrics.industry"),
        value: profile.industryDisp,
      });
    }

    if (profile.website) {
      const href = ensureProtocol(profile.website);
      const label = profile.website.replace(/^https?:\/\//i, "");
      items.push({
        key: "website",
        label: t("explore.metrics.website"),
        value: (
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      });
    }

    if (profile.irWebsite) {
      const href = ensureProtocol(profile.irWebsite);
      const label = profile.irWebsite.replace(/^https?:\/\//i, "");
      items.push({
        key: "irWebsite",
        label: t("explore.metrics.irWebsite"),
        value: (
          <a href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      });
    }

    return items;
  }, [profile, t]);

  const toggleMarket = (code: string) => {
    setExpandedMarkets((prev) => ({ ...prev, [code]: !prev[code] }));
  };

  const placeholderLogo = assetPath("img/logo-placeholder.svg");

  const headerLogo = selectedCompany?.logo ? assetPath(selectedCompany.logo) : placeholderLogo;
  const [logoStyle, setLogoStyle] = useState<CSSProperties>(DEFAULT_LOGO_STYLE);

  useEffect(() => {
    let cancelled = false;
    if (!selectedCompany?.logo) {
      setLogoStyle(DEFAULT_LOGO_STYLE);
      return () => {
        cancelled = true;
      };
    }
    setLogoStyle(DEFAULT_LOGO_STYLE);
    analyzeLogoAppearance(headerLogo)
      .then((style) => {
        if (!cancelled) setLogoStyle(style);
      })
      .catch(() => {
        if (!cancelled) setLogoStyle(DEFAULT_LOGO_STYLE);
      });

    return () => {
      cancelled = true;
    };
  }, [headerLogo, selectedCompany?.logo]);


  return (
    <main className="explore-page">
      <div className={`explore-layout${sidebarOpen ? "" : " sidebar-collapsed"}`}>
        <aside className={`explore-sidebar${sidebarOpen ? "" : " hidden"}`}>
          <button
            type="button"
            className="explore-sidebar-toggle"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('explore.hideSidebar')}
            title={t('explore.hideSidebar')}
          >
            <span className="explore-toggle-icon" aria-hidden="true" />
          </button>
          <div className="explore-sidebar-content">
            <div className="explore-sidebar-header">
              <h3>{t('explore.markets')}</h3>
            </div>
            <div className="explore-search">
              <input
                type="search"
                placeholder={t('explore.searchPlaceholder')}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="explore-groups">
              {searchMode ? (
                searchResults.length === 0 ? (
                  <p className="explore-no-results">{t('explore.noResults')}</p>
                ) : (
                  <ul className="explore-symbols search-results">
                    {searchResults.map((company) => {
                      const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                      const isActive = company.symbol === symbol;
                      return (
                        <li key={company.symbol}>
                          <button
                            type="button"
                            className={`explore-symbol${isActive ? " active" : ""}`}
                            onClick={() => {
                              setSymbol(company.symbol);
                              if (!sidebarOpen) setSidebarOpen(true);
                            }}
                          >
                            <img src={logoPath} alt={`${company.name || company.symbol} logo`} />
                            <span>{`${company.symbol} - ${company.name || company.symbol}`}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : (
                grouped.map((group) => {
                  const expanded = !!expandedMarkets[group.code];
                  const panelId = `market-${group.code}`;
                  const iconSrc = assetPath(MARKET_ICONS[group.code] ?? DEFAULT_MARKET_ICON);
                  if (!group.companies.length) return null;
                  return (
                    <div key={group.code} className="explore-group">
                      <button
                        type="button"
                        className="explore-group-header"
                        onClick={() => toggleMarket(group.code)}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                      >
                        <img src={iconSrc} alt="" className="explore-market-icon" aria-hidden="true" />
                        <span>{group.label}</span>
                        <span
                          className={`explore-chevron${expanded ? " open" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      {expanded && (
                        <ul className="explore-symbols" id={panelId}>
                          {group.companies.map((company) => {
                            const logoPath = company.logo ? assetPath(company.logo) : placeholderLogo;
                            const isActive = company.symbol === symbol;
                            return (
                              <li key={company.symbol}>
                                <button
                                  type="button"
                                  className={`explore-symbol${isActive ? " active" : ""}`}
                                  onClick={() => setSymbol(company.symbol)}
                                >
                                  <img src={logoPath} alt={`${company.name || company.symbol} logo`} />
                                  <span>{`${company.symbol} - ${company.name || company.symbol}`}</span>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>

        <div className="explore-main">
          <button
            type="button"
            className={`explore-sidebar-toggle reopen${sidebarOpen ? '' : ' visible'}`}
            onClick={() => setSidebarOpen(true)}
            aria-label={t('explore.showSidebar')}
            title={t('explore.showSidebar')}
            aria-hidden={sidebarOpen}
            tabIndex={sidebarOpen ? -1 : 0}
          >
            <span className="explore-toggle-icon" aria-hidden="true" />
          </button>
          <div className="explore-main-content">
            <div className="explore-header">
              <div className="company-identity">
                <img
                  src={headerLogo}
                  alt={`${selectedCompany?.name ?? symbol} logo`}
                  className="company-logo"
                  style={logoStyle}
                />
                <div>
                  <h1>
                    {displayName}
                    {longNameSuffix && <span className="company-alias">{longNameSuffix}</span>}
                  </h1>
                  <p>{subtitle}</p>
                </div>
              </div>
              {profile?.longBusinessSummary && (
                <p className="company-summary">{profile.longBusinessSummary}</p>
              )}
              {headerMeta.length > 0 && (
                <dl className="company-meta">
                  {headerMeta.map((item) => (
                    <div key={item.key} className="company-meta-item">
                      <dt>{item.label}</dt>
                      <dd>{item.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            <div className="chart-card">
              <div className="chart-overlay">
                <div className="chart-last">
                  {t("explore.lastLabel")} <strong>{lastCloseLabel}</strong>
                </div>
                <div className="timeframe-group" role="group" aria-label={t("explore.timeframe.label")}>
                  {["1M", "6M", "YTD", "1Y", "MAX"].map((x) => (
                    <button
                      key={x}
                      type="button"
                      className={tf === x ? "timeframe-btn active" : "timeframe-btn"}
                      onClick={() => setTf(x as TF)}
                      aria-pressed={tf === x}
                    >
                      {x}
                    </button>
                  ))}
                </div>
              </div>
              <div ref={chartContainerRef} className="chart-container" />
            </div>
              {(gauges.length > 0 || ranges.length > 0 || metrics.length > 0) && (
              <section className="explore-insights">
                {/* PERFORMANCE */}
                {ranges.length > 0 && (
                  <div className="insight-panel">
                    <div className="insight-panel-head">
                      <h3 className="insight-panel-title">
                        {t("explore.metrics.performanceTitle") ?? "Performance"}
                      </h3>
                      <p className="insight-panel-desc">
                        {t("explore.metrics.performanceDesc") ??
                          "Évolution du cours : sur 52 semaines et sur l'historique complet."}
                      </p>
                    </div>

                    <div className="insight-panel-body insight-panel-body--grid">
                      {ranges.map((range) => {
                        const tooltipId = `range-${range.key}-tooltip`;
                        const tooltipLabel = range.description
                          ? `${range.label}: ${range.description}`
                          : range.label;
                        return (
                          <div key={range.key} className="insight-subcard">
                            <div className="insight-subcard-head">
                              <span className="label">{range.label}</span>
                              {range.description && (
                                <span className="info-tooltip">
                                  <button
                                    type="button"
                                    className="info-btn"
                                    title={range.description}
                                    aria-label={tooltipLabel}
                                    aria-describedby={range.description ? tooltipId : undefined}
                                  >
                                    i
                                  </button>
                                  <span
                                    id={tooltipId}
                                    role="tooltip"
                                    className="info-tooltip-content"
                                  >
                                    {range.description}
                                  </span>
                                </span>
                              )}
                            </div>

                            <div className="insight-subcard-body range-body">
                              <RangeHistogram
                                key={range.key}
                                low={range.low}
                                high={range.high}
                                current={range.current}
                                lowLabel={range.lowLabel}
                                highLabel={range.highLabel}
                                currentLabel={range.currentLabel}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* RISQUE & AVIS */}
                {gauges.length > 0 && (
                  <div className="insight-panel">
                    <div className="insight-panel-head">
                      <h3 className="insight-panel-title">
                        {t("explore.metrics.riskTitle") ?? "Risque & Avis analystes"}
                      </h3>
                      <p className="insight-panel-desc">
                        {t("explore.metrics.riskDesc") ??
                          "Volatilité vs marché et consensus des analystes."}
                      </p>
                    </div>

                    <div className="insight-panel-body insight-panel-body--grid">
                      {gauges.map((item) => {
                        return (
                          <div key={item.key} className="insight-subcard">
                            <div className="insight-subcard-head">
                              <span className="label">{item.label}</span>
                              {item.description && (
                                <span className="info-tooltip">
                                  <button
                                    type="button"
                                    className="info-btn"
                                    title={item.description}
                                    aria-label={`${item.label}: ${item.description}`}
                                  >
                                    i
                                  </button>
                                  <span role="tooltip" className="info-tooltip-content">
                                    {item.description}
                                  </span>
                                </span>
                              )}
                            </div>

                            <div className="insight-subcard-body gauge-body">
                              {item.key === "recommendation" && item.gauge ? (
                                <GaugeNeedle
                                  value={item.gauge.value}
                                  min={item.gauge.min}   // 1
                                  max={item.gauge.max}   // 5
                                  label={item.gauge.format(item.gauge.value)}
                                  valueColor={recommendationValueColor(item.gauge.value)}
                                  gradient="reco"
                                  fillToNeedle={true}        // ← gradient uniforme sur tout l’arc + masquage après l’aiguille
                                  showStandardTick={false}   // pas de repère fixe
                                />
                              ) : item.key === "beta" && item.gauge ? (
                                <GaugeBetaNeedle
                                  value={item.gauge.value}
                                  // si tu gardes 0..3 affichés, utilise les mêmes bornes ici
                                  min={0}
                                  max={3}
                                  color="#d4b200"
                                  label={item.gauge.format(item.gauge.value)}
                                  valueColor={betaValueColor(item.gauge.value, 0, 3)}
                                />
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* FONDAMENTAUX */}
                {metrics.length > 0 && (
                  <div className="insight-panel">
                    <div className="insight-panel-head">
                      <h3 className="insight-panel-title">
                        {t("explore.metrics.fundamentalsTitle") ?? "Fondamentaux"}
                      </h3>
                      <p className="insight-panel-desc">
                        {t("explore.metrics.fundamentalsDesc") ??
                          "Valorisation, revenus, cashflow et structure financière."}
                      </p>
                    </div>

                    <div className="insight-panel-body">
                      <div className="metrics-card">
                        <table className="metrics-table">
                          <tbody>
                            {metrics.map((row) => (
                              <tr key={row.key}>
                                <th scope="row">{row.label}</th>
                                <td>{row.value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}
            <p className="hint">{t("explore.sourceHint")}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
function shiftDays(d: Date, delta: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}

function clampDateRange(
  from: Date,
  to: Date,
  bounds: { min: Date; max: Date },
  rightGapFraction: number = 0.25 // ≤ 25% de la fenêtre visible autorisée au-delà de la dernière bougie
): { from: Date; to: Date } {
  const minTs = bounds.min.getTime();
  const maxTs = bounds.max.getTime();

  let start = Math.min(from.getTime(), to.getTime());
  let end   = Math.max(from.getTime(), to.getTime());

  // largeur minimale d’une fenêtre
  let span = Math.max(ONE_DAY_MS, end - start);

  // on ne peut pas dépasser l’étendue totale
  const totalSpan = Math.max(ONE_DAY_MS, maxTs - minTs);
  if (span > totalSpan) span = totalSpan;

  // borne gauche “dure”
  if (start < minTs) {
    start = minTs;
    end = start + span;
  }

  // borne droite + marge tolérée (25% de la fenêtre visible)
  const maxWithGap = maxTs + Math.floor(span * rightGapFraction);
  if (end > maxWithGap) {
    end = maxWithGap;
    start = end - span;
  }

  // re-clamp final de sécurité
  if (start < minTs) start = minTs;
  if (end   < start) end   = start + span;

  return { from: new Date(start), to: new Date(end) };
}


// ===== Overlay qui lit l'échelle réelle du chart MUI =====

type RangeHistogramProps = {
  low: number;
  high: number;
  current: number;
  lowLabel?: string;
  highLabel?: string;
  currentLabel?: string;
};

function RangeHistogram({
  low,
  high,
  current,
  lowLabel,
  highLabel,
  currentLabel,
}: RangeHistogramProps) {
  // Données pour les barres
  const data = [
    {
      label: lowLabel ?? "Plus bas",
      lowVal: low,
      highVal: 0,
    },
    {
      label: highLabel ?? "Plus haut",
      lowVal: 0,
      highVal: high,
    },
  ];

  // bornes Y -> commence à 0, on prend le max entre low/high/current
  const rawMax = Math.max(
    typeof low === "number" ? low : 0,
    typeof high === "number" ? high : 0,
    typeof current === "number" ? current : 0
  );

  // on "arrondit" le max vers le haut pour éviter les ticks moches genre 59.5799
  // règle simple : on prend le multiple de 10 supérieur
  const yMaxNice = (() => {
    if (rawMax <= 0) return 10;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rawMax))); // ordre de grandeur
    const step = magnitude / 2; // un pas raisonnable
    return Math.ceil(rawMax / step) * step;
  })();

  const fmtUSD = (n: number) =>
    n.toLocaleString("fr-FR", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 2,
    });

  // Tooltip propre corrigé
  const currentLabelText = currentLabel ?? "Cours actuel";

  const renderCurrentLabel = useCallback(
    (labelProps: any) => {
      const viewBox = labelProps?.viewBox ?? {};
      const x = Number.isFinite(viewBox.x) ? viewBox.x : 0;
      const width = Number.isFinite(viewBox.width) ? viewBox.width : 0;
      const y = Number.isFinite(viewBox.y) ? viewBox.y : 0;

      const anchorX = x + width + 68;
      const baseY = y - 4;

      return (
        <g pointerEvents="none">
          <text
            x={anchorX}
            y={baseY}
            fontSize={10}
            fill="#64748b"
            fontWeight={600}
            textAnchor="end"
          >
            {currentLabelText}
          </text>
          <text
            x={anchorX}
            y={baseY + 14}
            fontSize={12}
            fill="#0f172a"
            fontWeight={700}
            textAnchor="end"
          >
            {fmtUSD(current)}
          </text>
        </g>
      );
    },
    [current, currentLabelText, fmtUSD]
  );

  const CustomTooltip = ({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: any[];
    label?: string;
  }) => {
    if (!active || !payload || payload.length === 0) return null;

    const numericVals = payload
      .map((entry) => (typeof entry.value === "number" ? entry.value : NaN))
      .filter((v) => Number.isFinite(v)) as number[];

    if (numericVals.length === 0) return null;

    const nonZeroVals = numericVals.filter((v) => v !== 0);
    const chosenVal =
      nonZeroVals.length > 0
        ? Math.max(...nonZeroVals)
        : Math.max(...numericVals);

    return (
      <div
        style={{
          background: "rgba(255,255,255,0.9)",
          borderRadius: "6px",
          padding: "6px 8px",
          boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
          border: "1px solid rgba(0,0,0,0.06)",
          fontSize: "0.75rem",
          lineHeight: 1.3,
          color: "#0f172a",
          fontWeight: 500,
        }}
      >
        <div style={{ color: "#475569", fontSize: "0.7rem" }}>{label}</div>
        <div style={{ fontWeight: 600 }}>{fmtUSD(chosenVal)}</div>
      </div>
    );
  };

  return (
    <div
      className="range-chart-wrapper"
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
      }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RBarChart
          data={data}
          margin={{ top: 10, right: 68, bottom: 0, left: 0 }}
          barCategoryGap="30%"
        >
          {/* grille horizontale */}
          <CartesianGrid
            stroke="rgba(0,0,0,0.1)"
            strokeDasharray="3 3"
            vertical={false}
          />

          {/* Axe Y formaté proprement */}
          <YAxis
            domain={[0, yMaxNice]}
            width={32}                  // << ajoute cette ligne (réduit la gouttière à gauche)
            tickMargin={4}              // << ajoute cette ligne (un peu d’air entre ticks et axe)
            tickFormatter={(tick: number) => {
              if (Math.abs(tick) >= 10 || Number.isInteger(tick)) return tick.toFixed(0);
              return tick.toFixed(1);
            }}
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={{ stroke: "#0f172a", strokeWidth: 1 }}
            tickLine={false}
            padding={{ top: 5, bottom: 0 }}
          />

          {/* Axe X */}
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#475569" }}
            axisLine={{ stroke: "#0f172a", strokeWidth: 1 }}
            tickLine={{ stroke: "#0f172a", strokeWidth: 1 }}
          />

          {/* Bar "Plus bas" -> rouge */}
          <Bar
            dataKey="lowVal"
            stackId="range"
            fill="#b91c1c"
            radius={[4, 4, 0, 0]}
            barSize={36}         // optionnel, pour une largeur fixe
          />

          {/* Bar "Plus haut" -> vert */}
          <Bar
            dataKey="highVal"
            stackId="range"
            fill="#047857"
            radius={[4, 4, 0, 0]}
            barSize={36}         // optionnel
          />

          {/* Ligne horizontale pointillée + bulle "Cours actuel" */}
          {/* On retire label=... du ReferenceLine pour éviter le texte coupé */}
          <ReferenceLine
            y={current}
            stroke="#475569"
            strokeDasharray="4 4"
            strokeWidth={2}
            ifOverflow="extendDomain"
            label={renderCurrentLabel}
          />

          {/* Tooltip corrigé */}
          <RTooltip
            content={<CustomTooltip />}
            cursor={{ fill: "rgba(0,0,0,0.03)" }}
          />
        </RBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function groupByMarket(list: Company[]): Record<string, Company[]> {
  const map: Record<string, Company[]> = {};
  for (const c of list) {
    const key = (c.market || "OTHER").toUpperCase();
    (map[key] ||= []).push(c);
  }
  for (const key of Object.keys(map)) {
    map[key].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  const ordered: Record<string, Company[]> = {};
  for (const pref of ["US", "CN", "EU", "JP", "SA", "IDX", "COM", "CRYPTO", "FX"]) {
    if (map[pref]) ordered[pref] = map[pref];
  }
  for (const key of Object.keys(map).sort()) {
    if (!(key in ordered)) ordered[key] = map[key];
  }
  return ordered;
}



