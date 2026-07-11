// Blocklist for the guest "name" field. Covers profanity plus slurs, hate
// phrases, threats, self-harm, and exploitation terms, with handling for common
// obfuscation (leetspeak, spacing, stretched letters, backwards spelling,
// dropped vowels).
//
// This is a heuristic wordlist — it is NOT complete and can be defeated by a
// determined person. Treat it as a first line of defense; strict approval mode
// (every name is reviewed before it can play) and the "close queue" control are
// the real backstops. Add terms below as needed.

// Substring matches on the cleaned string. Keep entries long/specific enough to
// avoid flagging real names. Double letters are preserved (see collapse2), so
// "nigger"/"faggot" match as written.
const HARD = [
  // profanity
  'fuck', 'shit', 'bitch', 'asshole', 'dickhead', 'bastard', 'motherfucker',
  'pussy', 'wanker', 'bollocks', 'jizz', 'douche', 'twat', 'whore', 'slut',
  'retard',
  // racial / ethnic slurs
  'nigger', 'nigga', 'chink', 'chinky', 'chinaman', 'gook', 'spick', 'kike',
  'wetback', 'beaner', 'faggot', 'tranny', 'uncletom',
  // hate phrases
  'ihate', 'aremonkeys', 'aresubhuman', 'subhuman', 'whitepower', 'whitepride',
  'heilhitler', 'siegheil', 'hitler', 'holohoax', 'gasthe', 'gaschamber',
  'bythejews', 'jewsdid', 'jewdid', 'kkk',
  // exploitation / CSAM
  'pedophile', 'pedophilia', 'pedo', 'ilovechildren', 'ilovekids', 'childlover',
  'childporn', 'childmolest', 'loli', 'lolilover', 'lolicon', 'epstein',
  'rapist', 'molest', 'molester',
  // threats / self-harm
  'killyourself', 'killurself', 'killall', 'iwillkill', 'shootup', 'schoolshoot',
  'ihaveabomb', 'haveabomb', 'imabomb', 'bomb',
  // sexual
  'porn', 'cuck', 'gangbang', 'dildo', 'blowjob', 'handjob', 'cumshot', 'creampie',
];

// Slurs people commonly spell backwards — also checked reversed.
const REVERSIBLE = ['nigger', 'nigga', 'faggot', 'kike'];

// Whole-word only (short / high-collision), so "class", "Scunthorpe",
// "Hancock", "Dickinson", "Sexton", "Spicer", "Nazir", "Witherspoon" pass.
const WORDS = [
  'ass', 'damn', 'hell', 'crap', 'piss', 'dick', 'penis', 'boob', 'sex',
  'cock', 'cunt', 'nazi', 'coon', 'fag', 'spic', 'gook',
];

// Exact obfuscations kept with their digits (checked before leet-folding).
const LITERAL = ['n1553r', 'ih8', 'kys', '1488'];

// Core slurs with vowels dropped — catches "N-GG-R", "NGGR", "FGGT".
const VOWELLESS = ['nggr', 'fggt'];

function deleet(s) {
  return s
    .replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/[!1]/g, 'i')
    .replace(/0/g, 'o').replace(/3/g, 'e').replace(/7/g, 't')
    .replace(/8/g, 'b').replace(/9/g, 'g');
}
const collapse2 = s => s.replace(/(.)\1{2,}/g, '$1$1'); // 3+ repeats -> 2 (keeps real doubles)
const collapse1 = s => s.replace(/(.)\1+/g, '$1');      // any repeats -> 1 (catches "fuuuck")

function containsProfanity(input) {
  if (!input) return false;
  const lower = String(input).toLowerCase();
  const deleeted = deleet(lower);

  const letters = deleeted.replace(/[^a-z]/g, '');
  const squished2 = collapse2(letters);
  const squished1 = collapse1(letters);
  const reversed2 = squished2.split('').reverse().join('');
  const vowelless = squished2.replace(/[aeiou]/g, '');
  const withDigits = collapse2(lower.replace(/[^a-z0-9]/g, ''));

  for (const l of LITERAL) if (withDigits.includes(l)) return true;
  for (const w of HARD) if (squished2.includes(w) || squished1.includes(w)) return true;
  for (const w of REVERSIBLE) if (reversed2.includes(w)) return true;
  for (const v of VOWELLESS) if (vowelless.includes(v)) return true;

  for (const t of deleeted.split(/[^a-z]+/).filter(Boolean)) {
    const c = collapse1(t);
    if (WORDS.includes(t) || WORDS.includes(c)) return true;
  }
  return false;
}

module.exports = { containsProfanity };
