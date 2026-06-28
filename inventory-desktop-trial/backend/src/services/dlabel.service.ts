import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { AppError } from "../utils/app-error";
import {
  renderPieceLabelPng as renderSharedPieceLabelPng,
  type PieceLabelDesignSettings,
  type PieceLabelPayload,
} from "./piece-label.service";

function sanitizeFilePart(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 60) || "label";
}

function resolveDLabelExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\DLabel\\DLabel.exe",
    "C:\\Program Files\\DLabel\\DLabel.exe",
  ];

  for (const candidate of candidates) {
    try {
      require("fs").accessSync(candidate);
      return candidate;
    } catch {
      // continue
    }
  }

  throw new AppError("برنامج DLabel غير مثبت على هذا الجهاز", 404, "DLABEL_NOT_FOUND");
}

export async function renderPieceLabelPng(
  payload: PieceLabelPayload,
  settings?: PieceLabelDesignSettings | null,
) {
  return renderSharedPieceLabelPng(payload, settings);
}

export async function openPieceLabelInDLabel(
  payload: PieceLabelPayload,
  settings?: PieceLabelDesignSettings | null,
) {
  const png = await renderPieceLabelPng(payload, settings);
  const tempDir = path.join(os.tmpdir(), "makhzouni-dlabel");
  await fs.mkdir(tempDir, { recursive: true });

  const filePath = path.join(
    tempDir,
    `${Date.now()}-${sanitizeFilePart(payload.itemNumber || payload.name)}.png`,
  );

  await fs.writeFile(filePath, png);

  const child = spawn(resolveDLabelExecutable(), [filePath], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();

  return { filePath };
}
