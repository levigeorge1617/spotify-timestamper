// Lightweight profanity check for the guest "name" field.
// Not exhaustive — just enough to keep obvious junk off the public screen.
// Tune the lists below to taste.

// Strong terms matched even when embedded/obfuscated (checked against the
// de-spaced, de-leeted string). Keep these long/unambiguous to avoid flagging
// innocent names (the "Scunthorpe problem").
const HARD = [
  'fuck', 'shit', 'bitch', 'asshole', 'dickhead', 'bastard', 'motherfucker',
  'pussy', 'dildo', 'wanker', 'bollocks', 'nigger', 'nigga',
  'faggot', 'retard', 'whore', 'slut', 'douche', 'twat', 'jizz',
];

// Milder or high-collision terms matched only as whole words, so "class",
// "assassin", "Scunthorpe", "Hancock", "Dickinson" don't get flagged.
const WORDS = [
  'ass', 'damn', 'hell', 'crap', 'piss', 'dick', 'penis', 'boob', 'sex', 'porn',
  'cock', 'cunt',
];

// Fold common leetspeak to letters so "sh1t" / "a$$" / "f4g" are caught.
function deleet(s) {
  return s
    .replace(/[@4]/g, 'a').replace(/[$5]/g, 's').replace(/0/g, 'o')
    .replace(/1/g, 'i').replace(/3/g, 'e').replace(/7/g, 't').replace(/8/g, 'b');
}

function containsProfanity(input) {
  if (!input) return false;
  const lowered = deleet(String(input).toLowerCase());

  // whole-word pass (tokens split on any non-letter; collapse repeats to one
  // letter so "fuuuck"/"piiiss" still match)
  const tokens = lowered.split(/[^a-z]+/).filter(Boolean);
  for (const t of tokens) {
    const c = t.replace(/(.)\1+/g, '$1');
    if (WORDS.includes(t) || WORDS.includes(c) || HARD.includes(t) || HARD.includes(c)) return true;
  }

  // obfuscation pass: strip everything but letters and collapse repeats
  // (catches "f u c k", "s-h-i-t", "fuuuck") — HARD list only, to limit
  // false positives on real names.
  const squished = lowered.replace(/[^a-z]/g, '').replace(/(.)\1+/g, '$1');
  for (const w of HARD) {
    if (squished.includes(w)) return true;
  }
  return false;
}

module.exports = { containsProfanity };
