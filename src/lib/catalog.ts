import fs from "node:fs";
import path from "node:path";

// Build-time-only data loader. Reads directly from the repo's `data/`
// directory. Never imported into client-side code — only from Astro
// frontmatter, which runs at build time.

const dataDir = path.resolve(process.cwd(), "../data");

export interface Faction {
  code: string;
  name: string;
  color: string;
}

export interface Type {
  code: string;
  name: string;
}

export interface Pack {
  code: string;
  name: string;
  date_release: string;
  size: number;
}

export interface Card {
  code: string;
  title: string;
  faction_code: string;
  type_code: string;
  pack_code: string;
  position: number;
  cost?: number | null;
  strength?: number;
  health?: number;
  standing?: Record<string, number>;
  standing_req?: number;
  keywords?: string;
  text?: string;
  stripped_text?: string;
  flavor?: string;
  illustrator?: string;
  signature?: string | null;
  printed_title?: string;
  stripped_title?: string;
  stripped_printed_title?: string;
  stages?: (string | null)[];
}

// Static lookup: Tailwind's JIT scanner needs literal class-name strings in
// source files (interpolated `text-${code}` never gets picked up), so the
// five known faction accent classes are spelled out here.
export const FACTION_TEXT_CLASS: Record<string, string> = {
  earth: "text-earth",
  moon: "text-moon",
  neutral: "text-faction-neutral",
  stars: "text-stars",
  void: "text-void",
};

let factionsCache: Faction[] | undefined;
export function getFactions(): Faction[] {
  if (!factionsCache) {
    const raw = fs.readFileSync(path.join(dataDir, "factions.json"), "utf-8");
    factionsCache = JSON.parse(raw);
  }
  return factionsCache!;
}

let typesCache: Type[] | undefined;
export function getTypes(): Type[] {
  if (!typesCache) {
    const raw = fs.readFileSync(path.join(dataDir, "types.json"), "utf-8");
    typesCache = JSON.parse(raw);
  }
  return typesCache!;
}

let packsCache: Pack[] | undefined;
export function getPacks(): Pack[] {
  if (!packsCache) {
    const raw = fs.readFileSync(path.join(dataDir, "packs.json"), "utf-8");
    packsCache = JSON.parse(raw);
  }
  return packsCache!;
}

const cardsByPackCache = new Map<string, Card[]>();
export function getCardsByPack(packCode: string): Card[] {
  if (!cardsByPackCache.has(packCode)) {
    const filePath = path.join(dataDir, "pack", `${packCode}.json`);
    const raw = fs.readFileSync(filePath, "utf-8");
    cardsByPackCache.set(packCode, JSON.parse(raw));
  }
  return cardsByPackCache.get(packCode)!;
}

let allCardsCache: Card[] | undefined;
export function getAllCards(): Card[] {
  if (!allCardsCache) {
    allCardsCache = getPacks().flatMap((pack) => getCardsByPack(pack.code));
  }
  return allCardsCache;
}

export function getCardByCode(code: string): Card | undefined {
  return getAllCards().find((card) => card.code === code);
}

export function getFactionByCode(code: string): Faction | undefined {
  return getFactions().find((faction) => faction.code === code);
}

export function getTypeByCode(code: string): Type | undefined {
  return getTypes().find((type) => type.code === code);
}

export function getPackByCode(code: string): Pack | undefined {
  return getPacks().find((pack) => pack.code === code);
}

// Ports CardsData::replaceSymbols() byte-for-byte: swaps `[mythium]`,
// `[earth]`, `[moon]`, `[stars]`, `[void]`, `[historic]` tokens in card
// text/flavor for the matching icon-wb SVG markup. Only `[mythium]` carries
// aria-hidden="true", matching the Laravel source exactly.
const SYMBOL_MAP: Record<string, string> = {
  "[mythium]":
    '<svg class="icon-wb icon-mythium" aria-hidden="true"><use xlink:href="#icon-mythium"></use></svg><span class="icon-fallback">Mythium</span>',
  "[earth]":
    '<svg class="icon-wb icon-earth"><use xlink:href="#icon-earth"></use></svg><span class="icon-fallback">Earth Guild</span>',
  "[moon]":
    '<svg class="icon-wb icon-moon"><use xlink:href="#icon-moon"></use></svg><span class="icon-fallback">Moon Guild</span>',
  "[stars]":
    '<svg class="icon-wb icon-stars"><use xlink:href="#icon-stars"></use></svg><span class="icon-fallback">Stars Guild</span>',
  "[void]":
    '<svg class="icon-wb icon-void"><use xlink:href="#icon-void"></use></svg><span class="icon-fallback">Void Guild</span>',
  "[historic]":
    '<svg class="icon-wb icon-historic"><use xlink:href="#icon-historic"></use></svg><span class="icon-fallback">Historic Flavor</span>',
};

export function replaceSymbols(text: string): string {
  let result = text;
  for (const [token, markup] of Object.entries(SYMBOL_MAP)) {
    result = result.split(token).join(markup);
  }
  return result;
}

// Ports CardsData::prepareCardInfo()'s text formatting byte-for-byte: after
// symbol replacement and `&` escaping, each `\n`-separated line becomes its
// own `<p>` paragraph. Used for card.text and, per-stage, for card.stages.
export function formatCardText(text: string): string {
  return replaceSymbols(text)
    .replace(/&/g, "&amp;")
    .split("\n")
    .map((line) => `<p>${line}</p>`)
    .join("");
}

// Ports CardsData::prepareCardInfo()'s flavor formatting plus the
// nl2br() applied in the Blade views: symbol replacement, `&` escaping,
// and `\n` -> `<br>` (line break, not paragraph break, unlike card text).
export function formatCardFlavor(flavor: string): string {
  return replaceSymbols(flavor).replace(/&/g, "&amp;").replace(/\n/g, "<br>\n");
}

export interface SplitIdentityTitle {
  name: string;
  subtitle?: string;
}

// Ports deck.js's `WBDB.Identity.title.split(/[,:] /)` byte-for-byte: splits
// an identity's "Name, Epithet" (or "Name: Epithet") title into a main name
// and an optional subtitle. Only ever called on identity-type cards, matching
// the original's scope (WBDB.Identity.title).
export function splitIdentityTitle(title: string): SplitIdentityTitle {
  const [name, subtitle] = title.split(/[,:] /);
  return { name, subtitle };
}

function cardImagePath(card: Card, size: "small" | "large"): string {
  const suffix = card.type_code === "identity" ? "_front" : "";
  return `/card_images/${size}/${card.code}${suffix}.jpg`;
}

// Renders the shared body markup used by both the hover tooltip and the
// click modal: title (+ signature star), faction/type/keywords line, a
// compact cost/strength-health/standing-requirement meta line, location
// stages, and card text. `flavor: true` (modal only) appends flavor text
// and illustrator credit; `flavor: false` (tooltip) appends a compact
// pack-name line instead, mirroring tip.js's faction/pack footer line.
// Deliberately uses plain flex/text markup rather than the detail page's
// boxed `stats` component: `stats-horizontal` only activates via a `sm:`
// viewport breakpoint, which would misrender inside the tooltip's narrow
// fixed-width floating box regardless of the actual viewport size.
function renderCardPreviewBody(card: Card, opts: { flavor: boolean }): string {
  const faction = getFactionByCode(card.faction_code);
  const type = getTypeByCode(card.type_code);
  const pack = getPackByCode(card.pack_code);
  const factionClass = FACTION_TEXT_CLASS[card.faction_code] ?? "";
  const isSignatureCard = !!card.signature && card.type_code !== "identity";

  const standingReqIcons = card.standing
    ? Object.entries(card.standing).flatMap(([factionCode, count]) =>
        Array.from({ length: count }, () => factionCode)
      )
    : [];

  const mythiumIcon =
    '<svg class="icon-wb icon-mythium" aria-hidden="true"><use xlink:href="#icon-mythium"></use></svg><span class="icon-fallback">Mythium</span>';

  const metaParts: string[] = [];
  if (card.cost !== undefined && card.cost !== null) {
    metaParts.push(
      `<span class="inline-flex items-center gap-1">${card.cost}${mythiumIcon}</span>`
    );
  } else if (
    card.type_code === "event" ||
    card.type_code === "location" ||
    card.type_code === "follower"
  ) {
    metaParts.push(
      `<span class="inline-flex items-center gap-1">X${mythiumIcon}</span>`
    );
  }
  if (standingReqIcons.length > 0) {
    metaParts.push(
      standingReqIcons
        .map(
          (factionCode) =>
            `<svg class="icon-wb icon-${factionCode}" aria-hidden="true"><use xlink:href="#icon-${factionCode}"></use></svg><span class="icon-fallback">${factionCode}</span>`
        )
        .join("")
    );
  }

  if (card.strength !== undefined && card.health !== undefined) {
    metaParts.push(
      `<div>Strength <b>${card.strength}</b> Health <b>${card.health}</b></div>`
    );
  }

  const stages = (card.stages ?? [])
    .filter((stage): stage is string => !!stage)
    .map((stage) => `<li>${formatCardText(stage)}</li>`);

  return [
    `<h3 class="font-bold leading-tight">${card.title}${
      isSignatureCard
        ? ' <span class="text-warning" title="Signature Card">\u2605</span>'
        : ""
    }</h3>`,
    `<p class="text-sm mt-1"><span class="${factionClass}">${
      faction?.name ?? ""
    }</span> \u00b7 ${type?.name ?? ""}${
      card.keywords ? `: ${card.keywords}` : ""
    }</p>`,
    metaParts.length > 0
      ? `<p class="text-sm text-base-content/70 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">${metaParts.join(
          ""
        )}</p>`
      : "",
    stages.length > 0
      ? `<ol class="mt-2 text-sm list-inside space-y-1 [list-style-type:upper-roman]">${stages.join(
          ""
        )}</ol>`
      : "",
    card.text
      ? `<div class="mt-2 prose-sm max-w-none">${formatCardText(
          card.text
        )}</div>`
      : "",
    opts.flavor && card.flavor
      ? `<p class="mt-2 italic text-base-content/60 text-sm">${formatCardFlavor(
          card.flavor
        )}</p>`
      : "",
    opts.flavor && card.illustrator
      ? `<p class="mt-2 text-xs text-base-content/60">Illustrated by ${card.illustrator}</p>`
      : "",
    !opts.flavor
      ? `<p class="mt-2 text-xs text-base-content/60">${pack?.name ?? ""}</p>`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

// Hex-clipped tooltip preview image. Non-location cards ("small" images are
// portrait, art on top) use a plain top-anchored cover crop. Location cards
// ("small" images are a portrait *frame* whose printed layout is rotated 90°
// — title along the right edge, art top-left, text box bottom-right, see
// `web/card_images/small/<code>.jpg`) instead: crop out the art-only corner
// (excludes the title-bar strip and the text-box region, boundaries found by
// pixel-sampling the source images), rotate it upright via CSS transform,
// then scale+center it to cover the hex box — replicating what a plain
// top-anchored crop cannot, since the raw file's top-left corner mixes in
// the title bar for this orientation.
const HEX_BOX_W = 71;
const HEX_BOX_H = 63;
const HEX_CLIP =
  "polygon(92.02% 50.4%,70.9% 91.61%,28.66% 91.61%,7.53% 50.4%,28.66% 9.19%,70.9% 9.19%)";
const HEX_POINTS = "92.02,50.4 70.9,91.61 28.66,91.61 7.53,50.4 28.66,9.19 70.9,9.19";
const HEX_BORDER_SVG = `<svg class="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="${HEX_POINTS}" fill="none" stroke="black" stroke-width="2.2" /></svg>`;

// Source "small" images are 116x162. The art-only corner of a (rotated)
// location image is the top-left 98x76 px (x: title bar starts at 98; y:
// text box starts at ~79, 76 leaves a safety margin).
const LOCATION_SRC_W = 116;
const LOCATION_SRC_H = 162;
const LOCATION_CROP_W = 98;
const LOCATION_CROP_H = 76;

function renderTooltipHexImage(card: Card): string {
  const src = cardImagePath(card, "small");
  const boxStyle = `width:${HEX_BOX_W}px;height:${HEX_BOX_H}px;clip-path:${HEX_CLIP}`;
  if (card.type_code !== "location") {
    return `<div class="relative shrink-0" style="${boxStyle}"><img src="${src}" alt="" class="absolute inset-0 w-full h-full object-cover object-top" />${HEX_BORDER_SVG}</div>`;
  }
  // Tile size once the art-only crop is rotated upright (width/height swap).
  const tileW = LOCATION_CROP_H;
  const tileH = LOCATION_CROP_W;
  const scale = Math.max(HEX_BOX_W / tileW, HEX_BOX_H / tileH);
  const cropW = (LOCATION_CROP_W * scale).toFixed(2);
  const cropH = (LOCATION_CROP_H * scale).toFixed(2);
  const imgW = (LOCATION_SRC_W * scale).toFixed(2);
  const imgH = (LOCATION_SRC_H * scale).toFixed(2);
  const scaledCropW = LOCATION_CROP_W * scale;
  const scaledTileH = LOCATION_CROP_W * scale; // == scaledCropW; kept named for clarity below
  const translateY = (scaledCropW - (scaledTileH - HEX_BOX_H) / 2).toFixed(2);
  const cropStyle = `width:${cropW}px;height:${cropH}px;transform-origin:0 0;transform:translate(0,${translateY}px) rotate(-90deg)`;
  const imgStyle = `width:${imgW}px;height:${imgH}px`;
  return `<div class="relative shrink-0" style="${boxStyle}"><div class="absolute top-0 left-0 overflow-hidden" style="${cropStyle}"><img src="${src}" alt="" class="absolute top-0 left-0" style="${imgStyle}" /></div>${HEX_BORDER_SVG}</div>`;
}

// Self-contained fragment ready to drop straight into the tooltip's
// innerHTML: a small cropped card image beside the compact preview body
// (no flavor/illustrator; a pack-name footer line instead).
export function renderCardTooltipFragment(code: string): string | undefined {
  const card = getCardByCode(code);
  if (!card) return undefined;
  const image = renderTooltipHexImage(card);
  const body = renderCardPreviewBody(card, { flavor: false });
  return `<div class="flex gap-3">${image}<div class="min-w-0">${body}</div></div>`;
}

// Self-contained fragment ready to drop straight into the modal's
// innerHTML: a large card image beside the full preview body (with
// flavor text and illustrator credit), matching #card-modal-content's
// `grid-cols-[200px_1fr]` two-child layout.
export function renderCardModalFragment(code: string): string | undefined {
  const card = getCardByCode(code);
  if (!card) return undefined;
  const image = `<img src="${cardImagePath(card, "large")}" alt="${
    card.title
  }" class="w-full rounded-lg border border-neutral-200" />`;
  const body = renderCardPreviewBody(card, { flavor: true });
  return `${image}<div>${body}</div>`;
}
