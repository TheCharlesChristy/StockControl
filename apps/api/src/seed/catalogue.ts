/**
 * Deterministic demo catalogue. Same seed, same data every time, so a demo
 * script stays true between runs.
 */

export interface SeedItem {
  readonly reference: string;
  readonly name: string;
  readonly unit: string;
  readonly barcode: string | null;
  readonly partNumber: string | null;
  readonly lowStockThreshold: string | null;
}

export interface SeedLocation {
  readonly code: string;
  readonly name: string;
}

export interface SeedJob {
  readonly number: string;
  readonly name: string;
  readonly customer: string;
}

/** mulberry32 — small, fast, and repeatable. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;

  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export const seedLocations: readonly SeedLocation[] = [
  { code: "MAIN-A1", name: "Main store, aisle A, bay 1" },
  { code: "MAIN-A2", name: "Main store, aisle A, bay 2" },
  { code: "MAIN-A3", name: "Main store, aisle A, bay 3" },
  { code: "MAIN-B1", name: "Main store, aisle B, bay 1" },
  { code: "MAIN-B2", name: "Main store, aisle B, bay 2" },
  { code: "MAIN-B3", name: "Main store, aisle B, bay 3" },
  { code: "MAIN-C1", name: "Main store, aisle C, bay 1" },
  { code: "MAIN-C2", name: "Main store, aisle C, bay 2" },
  { code: "BULK-01", name: "Bulk store, rack 1" },
  { code: "BULK-02", name: "Bulk store, rack 2" },
  { code: "BULK-03", name: "Bulk store, rack 3" },
  { code: "BULK-04", name: "Bulk store, rack 4" },
  { code: "CAGE-01", name: "Secure cage, shelf 1" },
  { code: "CAGE-02", name: "Secure cage, shelf 2" },
  { code: "WKSP-01", name: "Workshop bench store" },
  { code: "WKSP-02", name: "Workshop consumables" },
  { code: "GOODS-IN", name: "Goods in, holding bay" },
  { code: "SMALL-01", name: "Small parts cabinet" },
] as const;

export const seedJobs: readonly SeedJob[] = [
  { number: "J-1001", name: "Retail unit fit-out", customer: "Northgate Retail" },
  { number: "J-1002", name: "Warehouse lighting upgrade", customer: "Bellway Logistics" },
  { number: "J-1003", name: "Office small-power alterations", customer: "Carrick Property" },
] as const;

interface CatalogueGroup {
  readonly build: (index: number) => { readonly name: string };
  readonly unit: string;
  readonly count: number;
  readonly threshold: string | null;
}

const boltSizes = [4, 5, 6, 8, 10, 12] as const;
const boltLengths = [16, 20, 25, 30, 40, 50, 60, 75, 100] as const;
const boltFinishes = ["zinc-plated", "stainless A2", "stainless A4"] as const;
const cableCores = [2, 3, 4, 5] as const;
const cableSizes = ["1.0", "1.5", "2.5", "4.0", "6.0", "10.0"] as const;
const cableTypes = ["SWA", "flex", "twin and earth", "LSZH singles"] as const;
const conduitSizes = [20, 25, 32, 40, 50] as const;

const groups: readonly CatalogueGroup[] = [
  {
    count: 54,
    unit: "ea",
    threshold: "100",
    build: (index) => {
      const size = boltSizes[index % boltSizes.length] as number;
      const length = boltLengths[
        Math.floor(index / boltSizes.length) % boltLengths.length
      ] as number;
      const finish = boltFinishes[index % boltFinishes.length] as string;
      return { name: `M${String(size)} × ${String(length)} mm ${finish} hex bolt` };
    },
  },
  {
    count: 24,
    unit: "ea",
    threshold: "250",
    build: (index) => {
      const size = boltSizes[index % boltSizes.length] as number;
      const finish = boltFinishes[index % boltFinishes.length] as string;
      return { name: `M${String(size)} ${finish} washer, form A` };
    },
  },
  {
    count: 18,
    unit: "ea",
    threshold: "250",
    build: (index) => {
      const size = boltSizes[index % boltSizes.length] as number;
      const finish = boltFinishes[index % boltFinishes.length] as string;
      return { name: `M${String(size)} ${finish} nyloc nut` };
    },
  },
  {
    count: 40,
    unit: "m",
    threshold: "50",
    build: (index) => {
      const cores = cableCores[index % cableCores.length] as number;
      const size = cableSizes[Math.floor(index / cableCores.length) % cableSizes.length] as string;
      const type = cableTypes[index % cableTypes.length] as string;
      return { name: `${String(cores)} core ${size} mm² ${type} cable` };
    },
  },
  {
    count: 20,
    unit: "m",
    threshold: "30",
    build: (index) => {
      const size = conduitSizes[index % conduitSizes.length] as number;
      const kind = ["galvanised conduit", "PVC conduit", "flexible conduit", "cable trunking"][
        Math.floor(index / conduitSizes.length) % 4
      ] as string;
      return { name: `${String(size)} mm ${kind}` };
    },
  },
  {
    count: 15,
    unit: "ea",
    threshold: "20",
    build: (index) => {
      const size = conduitSizes[index % conduitSizes.length] as number;
      const kind = ["coupler", "elbow", "adaptable box"][
        Math.floor(index / conduitSizes.length) % 3
      ] as string;
      return { name: `${String(size)} mm conduit ${kind}` };
    },
  },
  {
    count: 16,
    unit: "ea",
    threshold: "15",
    build: (index) => {
      const rating = [6, 10, 16, 20, 32, 40, 63][index % 7] as number;
      const kind = ["MCB type B", "MCB type C", "RCBO"][Math.floor(index / 7) % 3] as string;
      return { name: `${String(rating)} A ${kind}` };
    },
  },
  {
    count: 12,
    unit: "ea",
    threshold: "10",
    build: (index) => {
      const output = [1200, 1800, 2400, 3600, 4800, 6000][index % 6] as number;
      const kind = ["LED batten", "LED high bay"][Math.floor(index / 6) % 2] as string;
      return { name: `${String(output)} lm ${kind} luminaire` };
    },
  },
  {
    count: 10,
    unit: "L",
    threshold: "5",
    build: (index) => {
      const name = [
        "Cable pulling lubricant",
        "Contact cleaner",
        "Degreaser",
        "White spirit",
        "PVC solvent cement",
        "Anti-corrosion spray",
        "Threadlocker",
        "Silicone sealant",
        "Duct sealant",
        "Galvanising paint",
      ][index] as string;
      return { name };
    },
  },
  {
    count: 12,
    unit: "ea",
    threshold: "12",
    build: (index) => {
      const name = [
        "Safety helmet, white",
        "Safety helmet, blue",
        "Hi-vis vest, large",
        "Hi-vis vest, extra large",
        "Safety glasses, clear",
        "Safety glasses, tinted",
        "Ear defenders",
        "Dust mask FFP3",
        "Knee pads",
        "Hard-wearing gloves, large",
        "Cut-resistant gloves, large",
        "Insulated gloves, class 0",
      ][index] as string;
      return { name };
    },
  },
  {
    count: 14,
    unit: "ea",
    threshold: "8",
    build: (index) => {
      const name = [
        "Cable tie, 200 mm, black (pack of 100)",
        "Cable tie, 300 mm, black (pack of 100)",
        "Cable cleat, 20 mm (pack of 50)",
        "Insulation tape, black",
        "Insulation tape, blue",
        "Insulation tape, brown",
        "Self-amalgamating tape",
        "Wago 221 connector, 3 way (pack of 50)",
        "Wago 221 connector, 5 way (pack of 50)",
        "Junction box, 4 terminal",
        "Earth sleeving, 4 mm",
        "Warning tape, electrical",
        "Cable marker set",
        "Terminal block, 16 A",
      ][index] as string;
      return { name };
    },
  },
] as const;

function eanBarcode(index: number): string {
  const body = String(5_010_000_000_000 + index * 7_919).slice(0, 13);
  return body.padStart(13, "0");
}

export function buildSeedItems(): readonly SeedItem[] {
  const items: SeedItem[] = [];
  const random = createRandom(20_260_730);

  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      const reference = `ITM-${String(items.length + 1).padStart(4, "0")}`;
      const { name } = group.build(index);

      items.push({
        reference,
        name,
        unit: group.unit,
        barcode: random() < 0.55 ? eanBarcode(items.length + 1) : null,
        partNumber: random() < 0.4 ? `PN-${String(100_000 + items.length * 37)}` : null,
        lowStockThreshold: random() < 0.7 ? group.threshold : null,
      });
    }
  }

  return items;
}
