import { readFileSync } from "fs";
import path from "path";
import QRCode from "qrcode";
import sharp from "sharp";

import type { AppSettings } from "./settings.service";

// Labels are rendered as SVG -> PNG via sharp/librsvg, which only has
// whatever fonts are installed on the host. The Railway runtime container
// doesn't have Tahoma/Arial with Arabic glyph coverage, so Arabic text
// silently rendered as empty boxes. Embedding the font directly in the SVG
// (as a base64 data URI) makes the label correct regardless of what's
// installed on the host.
const CAIRO_FONT_BASE64 = readFileSync(path.join(__dirname, "../assets/Cairo.ttf")).toString("base64");
const FONT_FACE_STYLE = `<style>@font-face{font-family:"Cairo";src:url(data:font/ttf;base64,${CAIRO_FONT_BASE64}) format("truetype");font-weight:200 900;}</style>`;
const LABEL_FONT_FAMILY = "Cairo, Tahoma, Arial, sans-serif";

export type PieceLabelPayload = {
  itemNumber: string;
  name: string;
  pcsPerCarton: number;
  qrCode: string;
};

export type PieceLabelLayout = "side-by-side" | "stacked" | "qr-only";
export type PieceLabelQrPosition = "left" | "right";

export type PieceLabelDesignSettings = Pick<
  AppSettings,
  | "labelPieceWidthMm"
  | "labelPieceHeightMm"
  | "pieceLabelLayout"
  | "pieceLabelQrPosition"
  | "pieceLabelShowName"
  | "pieceLabelShowItemNumber"
  | "pieceLabelShowCartonCount"
  | "pieceLabelNameFontSize"
  | "pieceLabelMetaFontSize"
  | "pieceLabelPaddingMm"
>;

const PX_PER_MM = 12;

function xmlEscape(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function clampText(value: string, max = 34) {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

export function resolvePieceLabelSettings(settings?: PieceLabelDesignSettings | null) {
  return {
    labelPieceWidthMm: clampNumber(settings?.labelPieceWidthMm, 20, 300, 50),
    labelPieceHeightMm: clampNumber(settings?.labelPieceHeightMm, 15, 300, 25),
    pieceLabelLayout: (settings?.pieceLabelLayout ?? "side-by-side") as PieceLabelLayout,
    pieceLabelQrPosition: (settings?.pieceLabelQrPosition ?? "left") as PieceLabelQrPosition,
    pieceLabelShowName: settings?.pieceLabelShowName ?? true,
    pieceLabelShowItemNumber: settings?.pieceLabelShowItemNumber ?? true,
    pieceLabelShowCartonCount: settings?.pieceLabelShowCartonCount ?? true,
    pieceLabelNameFontSize: clampNumber(settings?.pieceLabelNameFontSize, 8, 42, 14),
    pieceLabelMetaFontSize: clampNumber(settings?.pieceLabelMetaFontSize, 7, 32, 10),
    pieceLabelPaddingMm: clampNumber(settings?.pieceLabelPaddingMm, 1, 10, 2),
  };
}

type TextLine = {
  text: string;
  fontSizePx: number;
  weight: 600 | 700;
  wrap?: boolean;
};

function wrapLabelText(text: string, fontSizePx: number, maxWidthPx: number): string[] {
  const charWidthPx = fontSizePx * 0.58;
  const maxChars = Math.max(3, Math.floor(maxWidthPx / charWidthPx));
  if (text.length <= maxChars) return [text];
  const words = text.split(/\s+/).filter(Boolean);
  const wrapped: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      wrapped.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) wrapped.push(current);
  return wrapped.length ? wrapped : [text];
}

function expandWrappedLines(fields: TextLine[], maxWidthPx: number): TextLine[] {
  return fields.flatMap((field) =>
    (field.wrap ? wrapLabelText(field.text, field.fontSizePx, maxWidthPx) : [field.text]).map((text) => ({
      text,
      fontSizePx: field.fontSizePx,
      weight: field.weight,
    })),
  );
}

function buildTextLines(
  payload: PieceLabelPayload,
  settings: ReturnType<typeof resolvePieceLabelSettings>,
): TextLine[] {
  const lines: TextLine[] = [];

  if (settings.pieceLabelShowName) {
    lines.push({
      text: clampText(payload.name, 60),
      fontSizePx: Math.round(settings.pieceLabelNameFontSize * 3.2),
      weight: 700,
      wrap: true,
    });
  }

  if (settings.pieceLabelShowItemNumber) {
    lines.push({
      text: clampText(payload.itemNumber, 30),
      fontSizePx: Math.round(settings.pieceLabelMetaFontSize * 3),
      weight: 600,
    });
  }

  if (settings.pieceLabelShowCartonCount) {
    lines.push({
      text: String(payload.pcsPerCarton),
      fontSizePx: Math.round(settings.pieceLabelMetaFontSize * 3),
      weight: 600,
    });
  }

  return lines;
}

export async function renderPieceLabelPng(
  payload: PieceLabelPayload,
  settings?: PieceLabelDesignSettings | null,
) {
  const resolved = resolvePieceLabelSettings(settings);
  const widthPx = Math.max(240, Math.round(resolved.labelPieceWidthMm * PX_PER_MM));
  const heightPx = Math.max(180, Math.round(resolved.labelPieceHeightMm * PX_PER_MM));
  const paddingPx = Math.round(resolved.pieceLabelPaddingMm * PX_PER_MM);
  const fields = buildTextLines(payload, resolved);
  const qrOnly = resolved.pieceLabelLayout === "qr-only" || fields.length === 0;
  const qrDataUrl = await QRCode.toDataURL(payload.qrCode, {
    margin: 0,
    width: 900,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  let body = "";

  if (qrOnly) {
    const qrSize = Math.max(140, Math.min(widthPx, heightPx) - paddingPx * 2);
    const qrX = (widthPx - qrSize) / 2;
    const qrY = (heightPx - qrSize) / 2;
    body = `<image href="${qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />`;
  } else if (resolved.pieceLabelLayout === "stacked") {
    const rowGap = Math.max(8, Math.round(heightPx * 0.025));
    const lines = expandWrappedLines(fields, widthPx - paddingPx * 2);
    const textBlockHeight =
      lines.reduce((sum, line) => sum + line.fontSizePx, 0) + Math.max(0, lines.length - 1) * rowGap;
    const gapQrText = lines.length ? Math.round(paddingPx * 0.65) : 0;
    // QR fills ALL the space the text leaves behind (capped by label width), so a
    // mostly-empty label shows the biggest possible code instead of a fixed 52%.
    const availWidth = widthPx - paddingPx * 2;
    const availHeight = heightPx - paddingPx * 2 - textBlockHeight - gapQrText;
    const qrSize = Math.max(120, Math.min(availWidth, availHeight));
    const totalHeight = qrSize + gapQrText + textBlockHeight;
    const qrY = Math.max(paddingPx, (heightPx - totalHeight) / 2);
    const qrX = (widthPx - qrSize) / 2;
    let cursorY = qrY + qrSize + gapQrText;
    body = `
      <image href="${qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
      ${lines
        .map((line) => {
          cursorY += line.fontSizePx;
          const text = `<text x="${widthPx / 2}" y="${cursorY}" text-anchor="middle" font-family="${LABEL_FONT_FAMILY}" font-size="${line.fontSizePx}" font-weight="${line.weight}" fill="#111111">${xmlEscape(line.text)}</text>`;
          cursorY += rowGap;
          return text;
        })
        .join("")}
    `;
  } else {
    const qrSize = Math.max(130, Math.min(heightPx - paddingPx * 2, widthPx * 0.42));
    const qrX = resolved.pieceLabelQrPosition === "right"
      ? widthPx - paddingPx - qrSize
      : paddingPx;
    const textRight = resolved.pieceLabelQrPosition === "right"
      ? qrX - paddingPx
      : widthPx - paddingPx;
    const textLeft = resolved.pieceLabelQrPosition === "right"
      ? paddingPx
      : qrX + qrSize + paddingPx;
    const textWidth = Math.max(80, textRight - textLeft);
    const lines = expandWrappedLines(fields, textWidth);
    const contentHeight = lines.reduce((sum, line) => sum + line.fontSizePx, 0) + Math.max(0, lines.length - 1) * 12;
    let cursorY = (heightPx - contentHeight) / 2;

    body = `
      <image href="${qrDataUrl}" x="${qrX}" y="${(heightPx - qrSize) / 2}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
      ${lines
        .map((line) => {
          cursorY += line.fontSizePx;
          const text = `<text x="${textLeft + textWidth}" y="${cursorY}" text-anchor="end" font-family="${LABEL_FONT_FAMILY}" font-size="${line.fontSizePx}" font-weight="${line.weight}" fill="#111111">${xmlEscape(line.text)}</text>`;
          cursorY += 12;
          return text;
        })
        .join("")}
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
      <defs>${FONT_FACE_STYLE}</defs>
      <rect x="0" y="0" width="${widthPx}" height="${heightPx}" rx="16" ry="16" fill="#ffffff" />
      ${body}
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

/* ════════════════════════════════════════════════════════════════════
   CARTON LABEL — same design engine, mirrors the piece label settings
   above but for the carton sticker (carton-label.* settings keys).
════════════════════════════════════════════════════════════════════ */

export type CartonLabelPayload = {
  itemNumber: string;
  name: string;
  pcsPerCarton: number;
  qrCode: string;
};

export type CartonLabelDesignSettings = Pick<
  AppSettings,
  | "labelCartonWidthMm"
  | "labelCartonHeightMm"
  | "cartonLabelLayout"
  | "cartonLabelQrPosition"
  | "cartonLabelShowName"
  | "cartonLabelShowItemNumber"
  | "cartonLabelShowPcsPerCarton"
  | "cartonLabelNameFontSize"
  | "cartonLabelMetaFontSize"
  | "cartonLabelPaddingMm"
>;

export function resolveCartonLabelSettings(settings?: CartonLabelDesignSettings | null) {
  return {
    labelCartonWidthMm: clampNumber(settings?.labelCartonWidthMm, 20, 300, 100),
    labelCartonHeightMm: clampNumber(settings?.labelCartonHeightMm, 20, 300, 100),
    cartonLabelLayout: (settings?.cartonLabelLayout ?? "stacked") as PieceLabelLayout,
    cartonLabelQrPosition: (settings?.cartonLabelQrPosition ?? "left") as PieceLabelQrPosition,
    cartonLabelShowName: settings?.cartonLabelShowName ?? true,
    cartonLabelShowItemNumber: settings?.cartonLabelShowItemNumber ?? true,
    cartonLabelShowPcsPerCarton: settings?.cartonLabelShowPcsPerCarton ?? true,
    cartonLabelNameFontSize: clampNumber(settings?.cartonLabelNameFontSize, 8, 60, 20),
    cartonLabelMetaFontSize: clampNumber(settings?.cartonLabelMetaFontSize, 7, 48, 14),
    cartonLabelPaddingMm: clampNumber(settings?.cartonLabelPaddingMm, 1, 15, 5),
  };
}

function buildCartonTextLines(
  payload: CartonLabelPayload,
  settings: ReturnType<typeof resolveCartonLabelSettings>,
): TextLine[] {
  const lines: TextLine[] = [];

  if (settings.cartonLabelShowName) {
    lines.push({
      text: clampText(payload.name, 60),
      fontSizePx: Math.round(settings.cartonLabelNameFontSize * 3.2),
      weight: 700,
      wrap: true,
    });
  }
  if (settings.cartonLabelShowItemNumber) {
    lines.push({
      text: clampText(payload.itemNumber, 30),
      fontSizePx: Math.round(settings.cartonLabelMetaFontSize * 3),
      weight: 600,
    });
  }
  if (settings.cartonLabelShowPcsPerCarton) {
    lines.push({
      text: String(payload.pcsPerCarton),
      fontSizePx: Math.round(settings.cartonLabelMetaFontSize * 3),
      weight: 600,
    });
  }

  return lines;
}

// Mirrors renderPieceLabelPng's layout engine exactly (side-by-side / stacked /
// qr-only), just driven by the carton-specific settings + size.
export async function renderCartonLabelPng(
  payload: CartonLabelPayload,
  settings?: CartonLabelDesignSettings | null,
) {
  const resolved = resolveCartonLabelSettings(settings);
  const widthPx = Math.max(240, Math.round(resolved.labelCartonWidthMm * PX_PER_MM));
  const heightPx = Math.max(240, Math.round(resolved.labelCartonHeightMm * PX_PER_MM));
  const paddingPx = Math.round(resolved.cartonLabelPaddingMm * PX_PER_MM);
  const fields = buildCartonTextLines(payload, resolved);
  const qrOnly = resolved.cartonLabelLayout === "qr-only" || fields.length === 0;
  const qrDataUrl = await QRCode.toDataURL(payload.qrCode, {
    margin: 0,
    width: 900,
    color: { dark: "#000000", light: "#FFFFFF" },
  });

  let body = "";

  if (qrOnly) {
    const qrSize = Math.max(140, Math.min(widthPx, heightPx) - paddingPx * 2);
    const qrX = (widthPx - qrSize) / 2;
    const qrY = (heightPx - qrSize) / 2;
    body = `<image href="${qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />`;
  } else if (resolved.cartonLabelLayout === "stacked") {
    const rowGap = Math.max(8, Math.round(heightPx * 0.025));
    const lines = expandWrappedLines(fields, widthPx - paddingPx * 2);
    const textBlockHeight =
      lines.reduce((sum, line) => sum + line.fontSizePx, 0) + Math.max(0, lines.length - 1) * rowGap;
    const gapQrText = lines.length ? Math.round(paddingPx * 0.65) : 0;
    // QR fills ALL the space the text leaves behind (capped by label width), so a
    // mostly-empty label shows the biggest possible code instead of a fixed 52%.
    const availWidth = widthPx - paddingPx * 2;
    const availHeight = heightPx - paddingPx * 2 - textBlockHeight - gapQrText;
    const qrSize = Math.max(120, Math.min(availWidth, availHeight));
    const totalHeight = qrSize + gapQrText + textBlockHeight;
    const qrY = Math.max(paddingPx, (heightPx - totalHeight) / 2);
    const qrX = (widthPx - qrSize) / 2;
    let cursorY = qrY + qrSize + gapQrText;
    body = `
      <image href="${qrDataUrl}" x="${qrX}" y="${qrY}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
      ${lines
        .map((line) => {
          cursorY += line.fontSizePx;
          const text = `<text x="${widthPx / 2}" y="${cursorY}" text-anchor="middle" font-family="${LABEL_FONT_FAMILY}" font-size="${line.fontSizePx}" font-weight="${line.weight}" fill="#111111">${xmlEscape(line.text)}</text>`;
          cursorY += rowGap;
          return text;
        })
        .join("")}
    `;
  } else {
    const qrSize = Math.max(130, Math.min(heightPx - paddingPx * 2, widthPx * 0.42));
    const qrX = resolved.cartonLabelQrPosition === "right"
      ? widthPx - paddingPx - qrSize
      : paddingPx;
    const textRight = resolved.cartonLabelQrPosition === "right"
      ? qrX - paddingPx
      : widthPx - paddingPx;
    const textLeft = resolved.cartonLabelQrPosition === "right"
      ? paddingPx
      : qrX + qrSize + paddingPx;
    const textWidth = Math.max(80, textRight - textLeft);
    const lines = expandWrappedLines(fields, textWidth);
    const contentHeight = lines.reduce((sum, line) => sum + line.fontSizePx, 0) + Math.max(0, lines.length - 1) * 12;
    let cursorY = (heightPx - contentHeight) / 2;

    body = `
      <image href="${qrDataUrl}" x="${qrX}" y="${(heightPx - qrSize) / 2}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" />
      ${lines
        .map((line) => {
          cursorY += line.fontSizePx;
          const text = `<text x="${textLeft + textWidth}" y="${cursorY}" text-anchor="end" font-family="${LABEL_FONT_FAMILY}" font-size="${line.fontSizePx}" font-weight="${line.weight}" fill="#111111">${xmlEscape(line.text)}</text>`;
          cursorY += 12;
          return text;
        })
        .join("")}
    `;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
      <defs>${FONT_FACE_STYLE}</defs>
      <rect x="0" y="0" width="${widthPx}" height="${heightPx}" rx="16" ry="16" fill="#ffffff" />
      ${body}
    </svg>
  `;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
