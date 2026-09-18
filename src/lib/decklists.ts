import fs from "node:fs";
import path from "node:path";
import { getCardByCode, getFactionByCode, getFactions, getTypeByCode, type Card } from "./catalog";

// Build-time-only data loader for the Phase 0 extraction snapshot. Never
// imported into client-side code.

export interface DecklistCardEntry {
  code: string;
  quantity: number;
}

export interface Decklist {
  uuid: string;
  name: string;
  description: string | null;
  date_creation: string;
  author: string;
  identity_code: string;
  cards: DecklistCardEntry[];
}

const dataDir = path.resolve(process.cwd(), "src/data");

let decklistsCache: Decklist[] | undefined;
export function getDecklists(): Decklist[] {
  if (!decklistsCache) {
    const raw = fs.readFileSync(path.join(dataDir, "decklists.json"), "utf-8");
    decklistsCache = JSON.parse(raw);
  }
  return decklistsCache!;
}

export function getDecklistByUuid(uuid: string): Decklist | undefined {
  return getDecklists().find((decklist) => decklist.uuid === uuid);
}

// Fixed display order for the known types; anything else (none exist in the
// current data/types.json) is appended afterward, alphabetically.
const TYPE_ORDER = ["Event", "Follower", "Location"];

export interface GroupedDecklistCard {
  card: Card;
  quantity: number;
}

export interface GroupedDecklist {
  identity: Card;
  groups: Map<string, GroupedDecklistCard[]>;
}

export function groupCardsByType(decklist: Decklist): GroupedDecklist {
  const identity = getCardByCode(decklist.identity_code)!;

  const byTypeName = new Map<string, GroupedDecklistCard[]>();
  for (const entry of decklist.cards) {
    if (entry.code === decklist.identity_code) continue;
    const card = getCardByCode(entry.code);
    if (!card) continue;
    const typeName = getTypeByCode(card.type_code)?.name ?? card.type_code;
    if (!byTypeName.has(typeName)) byTypeName.set(typeName, []);
    byTypeName.get(typeName)!.push({ card, quantity: entry.quantity });
  }

  const orderedNames = [
    ...TYPE_ORDER.filter((name) => byTypeName.has(name)),
    ...[...byTypeName.keys()].filter((name) => !TYPE_ORDER.includes(name)).sort(),
  ];

  const groups = new Map<string, GroupedDecklistCard[]>();
  for (const name of orderedNames) {
    groups.set(name, byTypeName.get(name)!);
  }

  return { identity, groups };
}

export interface GuildDistributionSegment {
  factionCode: string;
  label: string; // faction display name, for hover tooltips
  color: string; // hex, no leading '#' (matches Faction.color's raw format)
  count: number; // raw card-slot count for this guild segment
  relative: number; // 0..1, share of this decklist's cards
}

// Ports Deck::getGuildDistribution() (src/AppBundle/Entity/Deck.php): one
// count per card slot (Worldbreakers decks are singleton, so quantity is
// always 1) — 'neutral' if the card has no standing icons, else one count
// per guild key in its standing map. Percentages + neutral-last ordering
// port GuildDistribution.svelte's client-side sort/render logic.
export function getGuildDistribution(decklist: Decklist): GuildDistributionSegment[] {
  const counts = new Map<string, number>();
  for (const entry of decklist.cards) {
    const card = getCardByCode(entry.code);
    if (!card) continue;
    const standingGuilds = card.standing ? Object.keys(card.standing) : [];
    if (standingGuilds.length === 0) {
      counts.set("neutral", (counts.get("neutral") ?? 0) + 1);
    } else {
      for (const guild of standingGuilds) {
        counts.set(guild, (counts.get(guild) ?? 0) + 1);
      }
    }
  }
  const sum = [...counts.values()].reduce((a, b) => a + b, 0);
  if (sum === 0) return [];
  return [...counts.entries()]
    .sort(([a, aCount], [b, bCount]) => {
      if (b === "neutral") return -1;
      if (a === "neutral") return 1;
      return bCount - aCount;
    })
    .map(([factionCode, count]) => ({
      factionCode,
      label: getFactionByCode(factionCode)?.name ?? factionCode,
      color: getFactionByCode(factionCode)?.color ?? "808080",
      count,
      relative: count / sum,
    }));
}

// CSS color keywords, ported verbatim from Laravel's types_colors map
// (laravel/resources/js/charts.js:68-72). Object key order (event, follower,
// location) is the stacking order: first key stacks at the bottom of each bar.
const COST_TYPE_COLORS: Record<string, string> = {
  event: "red",
  follower: "blue",
  location: "green",
};

export interface CostTypeSegment {
  typeCode: string;
  label: string;
  color: string;
  count: number;
}

export interface CostBucket {
  cost: number;
  segments: CostTypeSegment[]; // fixed order: event, follower, location
  total: number;
}

// Ports repartitionByCost() (laravel/resources/js/charts.js:42-90): one
// bucket per integer cost from 0 to the deck's max non-identity card cost,
// each bucket split into per-type (Event/Follower/Location) stacked counts.
export function getCostBuckets(decklist: Decklist): CostBucket[] {
  const byCostAndType = new Map<number, Map<string, number>>();
  let maxCost = 0;
  for (const entry of decklist.cards) {
    if (entry.code === decklist.identity_code) continue;
    const card = getCardByCode(entry.code);
    if (!card || card.cost === undefined || card.cost === null) continue;
    if (card.cost > maxCost) maxCost = card.cost;
    if (!byCostAndType.has(card.cost)) byCostAndType.set(card.cost, new Map());
    const byType = byCostAndType.get(card.cost)!;
    byType.set(card.type_code, (byType.get(card.type_code) ?? 0) + entry.quantity);
  }
  const typeCodes = Object.keys(COST_TYPE_COLORS);
  const buckets: CostBucket[] = [];
  for (let cost = 0; cost <= maxCost; cost++) {
    const byType = byCostAndType.get(cost);
    const segments = typeCodes.map((typeCode) => ({
      typeCode,
      label: getTypeByCode(typeCode)?.name ?? typeCode,
      color: COST_TYPE_COLORS[typeCode],
      count: byType?.get(typeCode) ?? 0,
    }));
    buckets.push({ cost, segments, total: segments.reduce((sum, s) => sum + s.count, 0) });
  }
  return buckets;
}

// Per-guild 3-shade palettes, ported verbatim from Laravel's COLORS map
// (laravel/resources/js/charts.js:119-125), reordered lightest→darkest so
// index 0 = standing-tier-1 color, index 2 = standing-tier-3 color (Laravel
// indexes the same arrays back-to-front via createBackgroundColors).
const GUILD_STANDING_COLORS: Record<string, [string, string, string]> = {
  earth: ["#E7C8BA", "#D8A48D", "#C98161"],
  moon: ["#6F94B4", "#557FA4", "#476A89"],
  stars: ["#DFDDD3", "#C5C1AF", "#ABA58B"],
  void: ["#654D7F", "#56426D", "#48375B"],
  neutral: ["#AAAAAA", "#AAAAAA", "#AAAAAA"],
};

export interface GuildStandingSegment {
  factionCode: string;
  label: string;
  tierColors: [string, string, string]; // tier 1, 2, 3 colors, lightest to darkest
  tiers: [number, number, number]; // card-slot counts requiring standing 1, 2, 3
}

// Ports cardCountGraphData() (laravel/resources/js/charts.js:127-191): one
// segment per guild — non-neutral factions sorted alphabetically by name,
// then Neutral last — each split into 3 stacked counts by the standing
// requirement (1/2/3) needed. Cards with no standing requirement at all
// count as a Neutral, tier-1 slot (matches `data[0][guildCodes.length-1]++`
// in cardCountGraphData for cards where `standing_req` is falsy).
export function getGuildStandingBreakdown(decklist: Decklist): GuildStandingSegment[] {
  const orderedFactions = [
    ...getFactions()
      .filter((f) => f.code !== "neutral")
      .sort((a, b) => a.name.localeCompare(b.name)),
    ...getFactions().filter((f) => f.code === "neutral"),
  ];
  const tiersByFaction = new Map<string, [number, number, number]>();
  for (const faction of orderedFactions) tiersByFaction.set(faction.code, [0, 0, 0]);

  for (const entry of decklist.cards) {
    if (entry.code === decklist.identity_code) continue;
    const card = getCardByCode(entry.code);
    if (!card) continue;
    const standingEntries = card.standing ? Object.entries(card.standing) : [];
    if (standingEntries.length === 0) {
      const bucket = tiersByFaction.get("neutral");
      if (bucket) bucket[0] += entry.quantity;
      continue;
    }
    for (const [factionCode, req] of standingEntries) {
      const bucket = tiersByFaction.get(factionCode);
      if (!bucket || req < 1 || req > 3) continue;
      bucket[req - 1] += entry.quantity;
    }
  }

  return orderedFactions.map((faction) => ({
    factionCode: faction.code,
    label: faction.name,
    tierColors: GUILD_STANDING_COLORS[faction.code] ?? GUILD_STANDING_COLORS.neutral,
    tiers: tiersByFaction.get(faction.code)!,
  }));
}
