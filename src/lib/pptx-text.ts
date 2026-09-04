/**
 * Reads text boxes (with normalised positions) straight out of the uploaded
 * .pptx in the browser. Read-only: the original file is never modified.
 */

export type SlideTextElement = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type SlideText = {
  index: number;
  title: string | null;
  text_elements: SlideTextElement[];
};

function num(v: string | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function slideNumber(path: string): number {
  const m = path.match(/slide(\d+)\.xml$/);
  return m?.[1] ? parseInt(m[1], 10) : 0;
}

export async function extractSlideText(buffer: ArrayBuffer): Promise<SlideText[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(buffer.slice(0));

  const parser = new DOMParser();

  // Slide size in EMU.
  let slideW = 9144000;
  let slideH = 6858000;
  const presFile = zip.file("ppt/presentation.xml");
  if (presFile) {
    const doc = parser.parseFromString(await presFile.async("string"), "application/xml");
    const sz =
      doc.getElementsByTagName("p:sldSz")[0] ||
      (doc.getElementsByTagNameNS ? doc.getElementsByTagNameNS("*", "sldSz")[0] : null) ||
      doc.getElementsByTagName("sldSz")[0];
    if (sz) {
      slideW = num(sz.getAttribute("cx")) || slideW;
      slideH = num(sz.getAttribute("cy")) || slideH;
    }
  }

  const paths = Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  const slides: SlideText[] = [];

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i]!;
    const xml = await zip.file(path)!.async("string");
    const doc = parser.parseFromString(xml, "application/xml");

    const getTags = (root: Element | Document, tag: string): Element[] => {
      const pTag = `p:${tag}`;
      const aTag = `a:${tag}`;
      const list: Element[] = [];
      if (root.getElementsByTagNameNS) {
        list.push(...Array.from(root.getElementsByTagNameNS("*", tag)));
      }
      list.push(...Array.from(root.getElementsByTagName(pTag)));
      list.push(...Array.from(root.getElementsByTagName(aTag)));
      list.push(...Array.from(root.getElementsByTagName(tag)));
      return Array.from(new Set(list));
    };

    const spShapes = getTags(doc, "sp");
    const gfShapes = getTags(doc, "graphicFrame");
    const allShapes = Array.from(new Set([...spShapes, ...gfShapes]));

    const elements: SlideTextElement[] = [];

    for (const sp of allShapes) {
      const textNodes = getTags(sp, "t");
      const texts = textNodes
        .map((t) => t.textContent || "")
        .join("")
        .trim();
      if (!texts) continue;

      const offList = getTags(sp, "off");
      const extList = getTags(sp, "ext");
      const off = offList[0];
      const ext = extList[0];
      const x = num(off?.getAttribute("x"));
      const y = num(off?.getAttribute("y"));
      const cx = num(ext?.getAttribute("cx"));
      const cy = num(ext?.getAttribute("cy"));

      elements.push({
        text: texts,
        left: slideW && cx ? x / slideW : 0,
        top: slideH && cy ? y / slideH : 0,
        width: slideW && cx ? cx / slideW : 0,
        height: slideH && cy ? cy / slideH : 0,
      });
    }

    slides.push({
      index: i,
      title: elements[0]?.text.split("\n")[0]?.slice(0, 120) ?? null,
      text_elements: elements,
    });
  }

  return slides;
}
