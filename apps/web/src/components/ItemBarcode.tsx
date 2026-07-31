import { Box } from "@mui/material";
import type { ReactElement } from "react";

const LEFT_PARITY = [
  "LLLLLL",
  "LLGLGG",
  "LLGGLG",
  "LLGGGL",
  "LGLLGG",
  "LGGLLG",
  "LGGGLL",
  "LGLGLG",
  "LGLGGL",
  "LGGGLG",
] as const;

const L_CODES = [
  "0001101",
  "0011001",
  "0010011",
  "0111101",
  "0100011",
  "0110001",
  "0101111",
  "0111011",
  "0110111",
  "0001011",
] as const;

const G_CODES = [
  "0100111",
  "0110011",
  "0011011",
  "0100001",
  "0011101",
  "0111001",
  "0000101",
  "0010001",
  "0001001",
  "0010111",
] as const;

const R_CODES = [
  "1110010",
  "1100110",
  "1101100",
  "1000010",
  "1011100",
  "1001110",
  "1010000",
  "1000100",
  "1001000",
  "1110100",
] as const;

const GUARD = "101";
const CENTRE_GUARD = "01010";

function checksum(value: string): number {
  let total = 0;

  for (let index = 0; index < 12; index += 1) {
    const digit = Number(value[index]);
    total += digit * (index % 2 === 0 ? 1 : 3);
  }

  return (10 - (total % 10)) % 10;
}

/** Returns true only for a complete, checksum-valid EAN-13 barcode. */
export function isValidEan13(value: string | null): value is string {
  return value !== null && /^\d{13}$/u.test(value) && checksum(value) === Number(value[12]);
}

function encode(value: string): string {
  const first = Number(value[0]);
  const parity = LEFT_PARITY[first];
  const left = value
    .slice(1, 7)
    .split("")
    .map((digit, index) => (parity[index] === "L" ? L_CODES : G_CODES)[Number(digit)])
    .join("");
  const right = value
    .slice(7)
    .split("")
    .map((digit) => R_CODES[Number(digit)])
    .join("");

  return `${GUARD}${left}${CENTRE_GUARD}${right}${GUARD}`;
}

interface ItemBarcodeProps {
  readonly value: string;
}

/** A compact, print-friendly EAN-13 barcode. */
export function ItemBarcode({ value }: ItemBarcodeProps): ReactElement | null {
  if (!isValidEan13(value)) {
    return null;
  }

  const modules = encode(value);
  const moduleWidth = 2;
  const quietZone = 10;
  const barTop = 6;
  const normalBarHeight = 70;
  const guardBarHeight = 78;

  return (
    <Box sx={{ width: "100%", maxWidth: 228, mx: "auto", textAlign: "center" }}>
      <svg
        role="img"
        aria-label={`EAN-13 barcode ${value}`}
        viewBox="0 0 210 98"
        width="100%"
        height="98"
        preserveAspectRatio="xMidYMid meet"
        shapeRendering="crispEdges"
      >
        {modules.split("").map((bit, index) =>
          bit === "1" ? (
            <rect
              key={index}
              x={quietZone + index * moduleWidth}
              y={barTop}
              width={moduleWidth}
              height={index < 3 || (index >= 45 && index < 50) || index >= 92 ? guardBarHeight : normalBarHeight}
              fill="currentColor"
            />
          ) : null,
        )}
        <text x="4" y="94" fontSize="12" textAnchor="middle" fill="currentColor">
          {value[0]}
        </text>
        <text x="52" y="94" fontSize="12" textAnchor="middle" letterSpacing="1.5" fill="currentColor">
          {value.slice(1, 7)}
        </text>
        <text x="158" y="94" fontSize="12" textAnchor="middle" letterSpacing="1.5" fill="currentColor">
          {value.slice(7)}
        </text>
      </svg>
    </Box>
  );
}
