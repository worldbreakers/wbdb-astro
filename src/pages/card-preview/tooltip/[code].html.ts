import type { APIRoute } from "astro";
import { getAllCards, renderCardTooltipFragment } from "../../../lib/catalog";

export function getStaticPaths() {
  return getAllCards().map((card) => ({ params: { code: card.code } }));
}

export const GET: APIRoute = ({ params }) => {
  const html = renderCardTooltipFragment(params.code!);
  if (!html) return new Response("Not found", { status: 404 });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
};
