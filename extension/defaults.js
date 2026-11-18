// Shared word lists and settings for the content script and the popup.
/* eslint-disable no-unused-vars */

// Spoiler levels. 1 = yellow, 2 = orange, 3 = red.
const GSS_LEVELS = {
  1: { key: "mild", label: "Possible spoiler", color: "#F2C230", text: "#111111" },
  2: { key: "story", label: "Story spoiler", color: "#F08A24", text: "#111111" },
  3: { key: "major", label: "MAJOR/CRITICAL SPOILER", color: "#D7263D", text: "#FFFFFF" }
};

// YELLOW: anything that mentions the game. These are the only built-in words
// that trigger on their own; orange and red words only count next to one of these.
const GSS_WORDS_YELLOW = [
  "GTA 6", "GTA6", "GTA VI", "GTAVI", "GTA Six",
  "Grand Theft Auto 6", "Grand Theft Auto VI", "Grand Theft Auto Six",
  "Leonida", "Leonida Keys", "Vice City", "Port Gellhorn", "Grassrivers", "Mount Kalaga",
  "Lucia Caminos", "Jason Duval", "Jason and Lucia", "Lucia and Jason",
  "Cal Hampton", "Boobie Ike", "Dre'Quan Priest", "Real Dimez", "Raul Bautista", "Brian Heder"
];

// ORANGE: story and gameplay details.
const GSS_WORDS_ORANGE = [
  "walkthrough", "playthrough", "gameplay", "mission", "first mission", "side mission",
  "story mode", "storyline", "plot", "cutscene", "chapter", "boss", "heist",
  "side quest", "easter egg", "secret", "hidden", "leak", "leaked", "full map",
  "map reveal", "cameo", "collectible", "100%", "first hour", "act 2", "act 3"
];

// RED: endings, deaths, twists.
const GSS_WORDS_RED = [
  "ending", "ending explained", "true ending", "secret ending", "good ending", "bad ending",
  "final mission", "last mission", "final boss", "finale", "epilogue", "post-credits",
  "credits scene", "who dies", "dies", "died", "death", "killed", "kills", "murdered",
  "survives", "arrested", "betrayal", "betrays", "betrayed", "traitor", "twist",
  "plot twist", "full story", "story explained", "fate of", "spoiler"
];

// Phrases removed before checking red words, so "spoiler-free review" isn't red.
const GSS_SAFE_PHRASES = ["no spoilers", "no spoiler", "spoiler-free", "spoiler free", "without spoilers"];

const GSS_DEFAULT_SETTINGS = {
  enabled: true,
  mode: "blur", // "blur" | "hide"
  minLevel: 1, // shield items at this level and above
  warnPages: true,
  useDefaultKeywords: true,
  custom1: [], // custom words always trigger at their level
  custom2: [],
  custom3: [],
  disabledSites: []
};
