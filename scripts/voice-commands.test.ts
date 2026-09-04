/**
 * Master Voice command-recognition test.
 *
 * Dependency-free: run with Node 24+, which strips the type annotations from
 * the imported hook module directly.
 *
 *   node scripts/voice-commands.test.ts
 *
 * It exercises the PURE resolver only — no browser, microphone or React.
 */

import { resolveVoiceCommand } from "../src/hooks/useVoiceControl.ts";

type Expect = "next" | "prev" | "ignore" | { slide: number } | { byText: string };

let passed = 0;
const failures: string[] = [];

function check(utterance: string, expected: Expect): void {
  const cmd = resolveVoiceCommand(utterance, true);
  const actual =
    cmd === null
      ? "ignore"
      : cmd.kind === "slide"
        ? `slide ${cmd.n}`
        : cmd.kind === "slideByText"
          ? `byText ${cmd.text}`
          : cmd.kind === "prev"
            ? "prev"
            : cmd.kind === "highlight"
              ? `highlight ${cmd.color} ${cmd.text}`
              : cmd.kind === "removeHighlight"
                ? `removeHighlight ${cmd.text}`
                : cmd.kind;

  const want =
    typeof expected === "string"
      ? expected === "prev"
        ? "prev"
        : expected
      : "slide" in expected
        ? `slide ${expected.slide}`
        : `byText ${expected.byText}`;

  if (actual === want) passed++;
  else failures.push(`  "${utterance}"\n      expected ${want}\n      got      ${actual}`);
}

function group(title: string, cases: Array<[string, Expect]>): void {
  const before = failures.length;
  for (const [utterance, expected] of cases) check(utterance, expected);
  const failed = failures.length - before;
  const label = failed === 0 ? "PASS" : `FAIL (${failed})`;
  console.log(`${label.padEnd(10)} ${title}  [${cases.length} cases]`);
}

/* ---------------------------------------------------------------- *
 * 1. NEXT — must navigate forward
 * ---------------------------------------------------------------- */
const NEXT_PHRASES = [
  // The exact list from the specification.
  "next",
  "next slide",
  "go to the next slide",
  "go next",
  "move to the next slide",
  "show the next slide",
  "let us go to the next slide",
  "let's go to the next slide",
  "take me to the next slide",
  // Same intent, other natural shapes.
  "Next.",
  "NEXT SLIDE",
  "next page",
  "next one",
  "the next slide",
  "the next one",
  "go to next slide",
  "go to next",
  "goto next slide",
  "move next",
  "move to next slide",
  "jump to the next slide",
  "skip to the next slide",
  "advance to the next slide",
  "continue to the next slide",
  "proceed to the next slide",
  "switch to the next slide",
  "flip to the next slide",
  "scroll to the next slide",
  "navigate to the next slide",
  "change to the next slide",
  "show next",
  "show next slide",
  "show me the next slide",
  "display the next slide",
  "bring me to the next slide",
  "give me the next slide",
  "open the next slide",
  "pull up the next slide",
  "to the next slide",
  "on to the next slide",
  "onto the next slide",
  "over to the next slide",
  "moving on to the next slide",
  "going to the next slide",
  "lets go to the next slide",
  "let me go to the next slide",
  "can we go to the next slide",
  "can you go to the next slide",
  "could you go to the next slide",
  "would you go to the next slide",
  "shall we go to the next slide",
  "i want to go to the next slide",
  "i would like to go to the next slide",
  "we will go to the next slide",
  "you can go to the next slide",
  "please go to the next slide",
  "ok next",
  "okay next",
  "alright next",
  "so next",
  "and next",
  "now next",
  "well next",
  "um next",
  "uh next",
  "oh next",
  "right next slide",
  "yeah next slide",
  "hey next slide",
  "next please",
  "next slide please",
  "next slide now",
  "next slide thanks",
  "go to the next slide please",
  "ok let us go to the next slide please",
  // Forward, but only with a verb or a counted noun.
  "go forward",
  "move forward",
  "jump forward",
  "skip forward",
  "forward one slide",
  "go forward one slide",
  // Mis-recognitions folded back.
  "nekst",
  "nexts",
  "nekst slide",
  "text slide",
  "nest slide",
  "necks slide",
  "next slade",
];
group(
  "NEXT phrases navigate forward",
  NEXT_PHRASES.map((p) => [p, "next"] as [string, Expect]),
);

/* ---------------------------------------------------------------- *
 * 2. PREVIOUS — must navigate backward
 * ---------------------------------------------------------------- */
const PREV_PHRASES = [
  "previous",
  "previous slide",
  "go to the previous slide",
  "go previous",
  "move to the previous slide",
  "show the previous slide",
  "let us go to the previous slide",
  "let's go to the previous slide",
  "take me to the previous slide",
  "Previous.",
  "PREVIOUS SLIDE",
  "previous page",
  "previous one",
  "the previous slide",
  "go to previous slide",
  "go back to the previous slide",
  "jump to the previous slide",
  "skip to the previous slide",
  "switch to the previous slide",
  "flip to the previous slide",
  "scroll to the previous slide",
  "navigate to the previous slide",
  "show previous",
  "show me the previous slide",
  "display the previous slide",
  "bring me to the previous slide",
  "give me the previous slide",
  "open the previous slide",
  "to the previous slide",
  "on to the previous slide",
  "moving on to the previous slide",
  "going to the previous slide",
  "lets go to the previous slide",
  "can we go to the previous slide",
  "could you go to the previous slide",
  "shall we go to the previous slide",
  "i want to go to the previous slide",
  "we will go to the previous slide",
  "please go to the previous slide",
  "ok previous",
  "okay previous",
  "so previous",
  "and previous",
  "um previous slide",
  "previous please",
  "previous slide please",
  "previous slide now",
  // Back, but only with a verb or a counted noun.
  "go back",
  "move back",
  "jump back",
  "scroll back",
  "can we go back",
  "let us go back",
  "please go back",
  "go back one slide",
  "back one slide",
  "back one page",
  "go back a slide",
  "back 1 slide",
  // Mis-recognitions folded back.
  "prevs",
  "prevous",
  "previus",
  "pervious",
  "previews",
  "preview",
  "previous slade",
];
group(
  "PREVIOUS phrases navigate backward",
  PREV_PHRASES.map((p) => [p, "prev"] as [string, Expect]),
);

/* ---------------------------------------------------------------- *
 * 3. Standalone numbers — the reported bug
 * ---------------------------------------------------------------- */
group("Digits jump to that slide", [
  ["1", { slide: 1 }],
  ["2", { slide: 2 }],
  ["3", { slide: 3 }],
  ["4", { slide: 4 }],
  ["5", { slide: 5 }],
  ["6", { slide: 6 }],
  ["7", { slide: 7 }],
  ["8", { slide: 8 }],
  ["9", { slide: 9 }],
  ["10", { slide: 10 }],
  ["11", { slide: 11 }],
  ["12", { slide: 12 }],
  ["15", { slide: 15 }],
  ["20", { slide: 20 }],
  ["21", { slide: 21 }],
  ["30", { slide: 30 }],
  ["47", { slide: 47 }],
  ["100", { slide: 100 }],
  ["04", { slide: 4 }],
  ["8.", { slide: 8 }],
  ["10 .", { slide: 10 }],
  ["#4", { slide: 4 }],
  ["4,", { slide: 4 }],
  ["15?", { slide: 15 }],
]);

group("Number words jump to that slide", [
  ["one", { slide: 1 }],
  ["two", { slide: 2 }],
  ["three", { slide: 3 }],
  ["four", { slide: 4 }],
  ["five", { slide: 5 }],
  ["six", { slide: 6 }],
  ["seven", { slide: 7 }],
  ["eight", { slide: 8 }],
  ["nine", { slide: 9 }],
  ["ten", { slide: 10 }],
  ["eleven", { slide: 11 }],
  ["twelve", { slide: 12 }],
  ["thirteen", { slide: 13 }],
  ["fourteen", { slide: 14 }],
  ["fifteen", { slide: 15 }],
  ["sixteen", { slide: 16 }],
  ["seventeen", { slide: 17 }],
  ["eighteen", { slide: 18 }],
  ["nineteen", { slide: 19 }],
  ["twenty", { slide: 20 }],
  ["Eight", { slide: 8 }],
  ["FIVE", { slide: 5 }],
  ["twenty one", { slide: 21 }],
  ["twenty-one", { slide: 21 }],
  ["thirty five", { slide: 35 }],
  ["forty four", { slide: 44 }],
  ["ninety nine", { slide: 99 }],
  ["one hundred", { slide: 100 }],
  ["a hundred", { slide: 100 }],
  ["hundred", { slide: 100 }],
  ["one hundred five", { slide: 105 }],
  ["one hundred and five", { slide: 105 }],
]);

group("Recognition variants of a spoken number", [
  ["for", { slide: 4 }],
  ["fore", { slide: 4 }],
  ["hive", { slide: 5 }],
  ["ate", { slide: 8 }],
  ["ait", { slide: 8 }],
  ["nain", { slide: 9 }],
  ["tin", { slide: 10 }],
  ["twelv", { slide: 12 }],
  ["forteen", { slide: 14 }],
  ["fiveteen", { slide: 15 }],
  ["ninteen", { slide: 19 }],
  ["fourty", { slide: 40 }],
]);

group("Ordinals resolve to the same slide", [
  ["fourth", { slide: 4 }],
  ["fifth", { slide: 5 }],
  ["eighth", { slide: 8 }],
  ["tenth", { slide: 10 }],
  ["fifteenth", { slide: 15 }],
  ["twentieth", { slide: 20 }],
  ["1st", { slide: 1 }],
  ["2nd", { slide: 2 }],
  ["3rd", { slide: 3 }],
  ["4th", { slide: 4 }],
  ["8th", { slide: 8 }],
  ["8 th", { slide: 8 }],
  ["15th", { slide: 15 }],
  ["the eighth slide", { slide: 8 }],
  ["4th slide", { slide: 4 }],
  ["go to the fourth slide", { slide: 4 }],
  ["go to the 10th page", { slide: 10 }],
]);

group("Fillers around a bare number are ignored", [
  ["okay 8", { slide: 8 }],
  ["ok 4", { slide: 4 }],
  ["um four", { slide: 4 }],
  ["uh 8", { slide: 8 }],
  ["oh 4", { slide: 4 }],
  ["so 8", { slide: 8 }],
  ["and 4", { slide: 4 }],
  ["alright 12", { slide: 12 }],
  ["8 please", { slide: 8 }],
  ["four please", { slide: 4 }],
  ["okay 8 please", { slide: 8 }],
  ["ok so 15", { slide: 15 }],
]);

group("Multi-token digit runs", [
  ["1 0", { slide: 10 }],
  ["1 5", { slide: 15 }],
  ["2 0", { slide: 20 }],
  ["4 2", { slide: 42 }],
  ["1 0 0", { slide: 100 }],
  ["one five", { slide: 15 }],
  ["twenty 1", { slide: 21 }],
  ["40 4", { slide: 44 }],
]);

group("Slide / page / number prefix", [
  ["slide 4", { slide: 4 }],
  ["slide four", { slide: 4 }],
  ["slide 8", { slide: 8 }],
  ["slide eight", { slide: 8 }],
  ["page 8", { slide: 8 }],
  ["page ten", { slide: 10 }],
  ["number 4", { slide: 4 }],
  ["slide number 4", { slide: 4 }],
  ["go to slide 4", { slide: 4 }],
  ["go to slide five", { slide: 5 }],
  ["go to the slide 4", { slide: 4 }],
  ["jump to slide 12", { slide: 12 }],
  ["move to slide 3", { slide: 3 }],
  ["take me to slide 9", { slide: 9 }],
  ["show me slide 7", { slide: 7 }],
  ["go back to slide 4", { slide: 4 }],
  ["slide 8 please", { slide: 8 }],
  ["okay go to slide 8", { slide: 8 }],
  ["let us go to slide 8", { slide: 8 }],
]);

/* ---------------------------------------------------------------- *
 * 4. Ordinary speech — must do nothing at all
 * ---------------------------------------------------------------- */
const IGNORED = [
  // From the specification.
  "hello everyone",
  "welcome to my presentation",
  "today we will discuss five topics",
  "this slide has eight points",
  "please explain slide five",
  // Sentences that contain a trigger word.
  "the next slide shows our pricing",
  "we will talk about that on the next slide",
  "the details are on the next slide",
  "as you can see on the next slide",
  "in the next slide we cover revenue",
  "next quarter looks strong",
  "the next quarter looks strong",
  "our next big milestone is in june",
  "next up we have the roadmap",
  "next question",
  "next section",
  "let us go to the next section",
  "moving on to the next topic",
  "the next step is validation",
  "in the previous year we grew",
  "as i said in the previous section",
  "the previous quarter was flat",
  "previously we discussed this",
  "back in 2019 we started",
  "back to the point i was making",
  "go back to the drawing board",
  "can we go back to that later",
  "looking back at last year",
  "moving forward we expect growth",
  "going forward this is our plan",
  "i look forward to your questions",
  // Bare ambiguous words.
  "back",
  "forward",
  "last slide",
  "the last slide",
  "first",
  "second",
  "third",
  "first slide",
  // Numbers embedded in speech.
  "today we have four points",
  "there are eight reasons for this",
  "we grew five percent",
  "five percent",
  "50%",
  "$5",
  "revenue was 4 million",
  "it took four years",
  "four of our customers",
  "the fourth quarter was strong",
  "one of the five pillars",
  "slide four explains the model",
  "slide 4 has three bullets",
  "number five is important",
  "our number one priority",
  "page eight covers pricing",
  "this is slide four",
  "please move to 4",
  "one two three",
  "one fourth",
  "three quarters",
  "a hundred percent",
  "zero",
  "0",
  "0 0",
  // Non-commands.
  "india is an important market",
  "thank you very much",
  "any questions",
  "let us begin",
  "so",
  "okay",
  "um",
  "and",
  "please",
  "yes",
  "no",
  "to",
  "too",
  "won",
  "on",
  "a",
  "hey",
  "wait",
  "then",
  "when",
  "free",
  "hate",
  "sick",
  "text",
  "nest",
];
group(
  "Ordinary speech is ignored",
  IGNORED.map((p) => [p, "ignore"] as [string, Expect]),
);

/* ---------------------------------------------------------------- *
 * 5. Pre-existing commands must be untouched
 * ---------------------------------------------------------------- */
group("Existing highlight / title commands still resolve", [
  ["highlight india", "highlight yellow india" as unknown as Expect],
  ["highlight india in red", "highlight red india" as unknown as Expect],
  ["highlight the revenue in green", "highlight green revenue" as unknown as Expect],
  ["highlight the next slide", "highlight yellow next slide" as unknown as Expect],
  ["remove highlight india", "removeHighlight india" as unknown as Expect],
  ["clear highlights", "clearHighlights" as unknown as Expect],
  ["clear all highlights", "clearHighlights" as unknown as Expect],
  ["remove all highlights", "clearHighlights" as unknown as Expect],
  ["go to the introduction slide", { byText: "introduction" }],
  ["go to the revenue slide", { byText: "revenue" }],
]);

/* ---------------------------------------------------------------- */
console.log("");
if (failures.length === 0) {
  console.log(`All ${passed} cases passed.`);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:\n`);
  console.log(failures.join("\n"));
  process.exitCode = 1;
}
