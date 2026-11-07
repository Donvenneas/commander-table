// Turns Oracle text into effects the simulator can execute.
// This covers the common Commander staples (removal, wipes, draw, ramp, tokens, burn, counters,
// anthems, equipment, auras, planeswalkers, ETB/attack/upkeep/dies triggers). Anything else is
// still cast and put on the battlefield, but its unusual abilities are not modelled.

const WORDNUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
export function num(s) {
  if (s == null) return 1;
  s = String(s).toLowerCase();
  if (s === 'x') return 'X';
  return WORDNUM[s] ?? (Number.isFinite(+s) ? +s : 1);
}

export const KEYWORDS = ['flying', 'reach', 'trample', 'deathtouch', 'lifelink', 'vigilance', 'haste', 'first strike',
  'double strike', 'menace', 'defender', 'hexproof', 'indestructible', 'shroud', 'flash', 'ward', 'prowess',
  'infect', 'wither', 'intimidate', 'skulk', 'horsemanship'];
const kwList = s => (s ? KEYWORDS.filter(k => new RegExp(`\\b${k}\\b`).test(s)) : []);
// Keywords lords hand out besides KEYWORDS (fear, landwalk, riot…)
const KW2 = [...KEYWORDS, 'fear', 'shadow', 'islandwalk', 'swampwalk', 'forestwalk', 'mountainwalk', 'plainswalk', 'riot', 'myriad', 'melee', 'exalted', 'persist', 'undying'];
const kwList2 = s => (s ? KW2.filter(k => new RegExp(`\\b${k}\\b`).test(s)) : []);
// Words that are also card names (Sacrifice, Flashback, Mana Flare): never read as the card calling itself
const RULE_WORDS = new Set(['mana', 'sacrifice', 'flashback', 'fog', 'time', 'life', 'death', 'fire', 'blood', 'soul', 'mind', 'dark']);
// "goblins" → "goblin", "elves" → "elf", "nonlegendary" → "non-legendary"
const singular = w => ({ elves: 'elf', dwarves: 'dwarf', mercenaries: 'mercenary', allies: 'ally', faeries: 'faerie', commanders: 'commander' }[w] || (w.endsWith('ss') ? w : w.replace(/s$/, ''))).replace(/^non(?!-)(?=\w)/, 'non-');
// Keyword abilities the engine models (from the card's keyword list or its text), besides KEYWORDS
export const MORE_KEYWORDS = ['fear', 'shadow', 'exalted', 'battle cry', 'bushido', 'flanking', 'rampage', 'annihilator',
  'toxic', 'afflict', 'melee', 'dethrone', 'training', 'mentor', 'evolve', 'riot', 'modular', 'fabricate', 'outlast',
  'backup', 'ravenous', 'undying', 'persist', 'afterlife', 'decayed', 'changeling', 'devoid', 'kicker', 'multikicker',
  'buyback', 'cycling', 'jump-start', 'escape', 'unearth', 'embalm', 'eternalize', 'dash', 'blitz', 'spectacle',
  'affinity', 'improvise', 'echo', 'vanishing', 'fading', 'cumulative upkeep', 'crew', 'living weapon', 'for mirrodin!',
  'split second', 'cascade', 'extort', 'ninjutsu', 'bloodthirst', 'myriad', 'protection', 'landwalk', 'islandwalk',
  'swampwalk', 'forestwalk', 'mountainwalk', 'plainswalk', 'channel', 'enchant', 'equip', 'convoke', 'delve', 'evoke',
  'flashback', 'storm', 'landcycling', 'reconfigure', 'partner', 'companion', 'poisonous', 'absorb', 'amplify'];
const COLOR_NAME = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };

export function cleanText(text, name) {
  let t = (text || '').replace(/\([^)]*\)/g, '').toLowerCase();
  // Legends are often called by their first name ("Loran" for Loran of the Third Path)
  const first = name.split(' // ')[0].split(',')[0].split(/ (?:of|the|from|and) /)[0];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // (cards named after a rules word, like Sacrifice or Flashback, only call themselves "this spell")
  const names = [...new Set([name, name.split(' // ')[0], name.split(',')[0]])]
    .filter(n => n && n.length >= 4 && !RULE_WORDS.has(n.toLowerCase())).map(n => n.toLowerCase()).sort((a, b) => b.length - a.length);
  for (const n of names) t = t.split(n).join('~');
  // A short name only counts where it's used as the card's name (followed by what it does)
  for (const n of [...new Set([first, first.split(' ')[0]])].filter(n => n.length >= 3 && !names.includes(n.toLowerCase()) && !RULE_WORDS.has(n.toLowerCase())).map(n => n.toLowerCase())) {
    // "Return Arcanis to its owner's hand"
    t = t.replace(new RegExp(`(?<=\\breturn )${esc(n)}(?= to )`, 'gm'), '~');
    t = t.replace(new RegExp(`\\b${esc(n)}\\b(?=(?:'s)? (?:enters?|deals|gets|has|have|can't|attacks|dies|is|becomes|gains|loses|isn't|doesn't|blocks|power|toughness|leaves)\\b|[.,]|$)`, 'gm'), '~');
  }
  return t.replace(/\bthis (creature|artifact|enchantment|permanent|land|vehicle|card|spell|equipment|aura|class|siege|spacecraft|planet|token)\b/g, '~');
}

const N = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|x|\\d+)';
// A modal trigger or ability's modes, parsed from its bullet lines (see analyzeCard)
let MODAL_STASH = null;
// The last "roll a d20" read, so the table lines under it can fill it in
let LAST_ROLL = null;
/** @type {Array<[RegExp, (m: RegExpMatchArray) => any]>} */
const PATTERNS = [
  [/\bmodalx\b/, () => { const e = MODAL_STASH; MODAL_STASH = null; return e; }],
  // Jeska's Will: one {R} per card in the opponent's hand (the target with the most cards)
  [/add \{([wubrgc])\} for each card in (?:target opponent's|an opponent's) hand/, m => ({ k: 'addManaN', n: { dyn: 'oppMaxHand' }, color: m[1].toUpperCase() })],
  [/(destroy|exile) all (other creatures|creatures|nonland permanents|artifacts and enchantments|artifacts|enchantments)(?! you don't control| your opponents control)/, m => ({ k: 'wipe', mode: m[1], what: m[2] })],
  [/deals? (\d+|x) damage to each creature(?! you control)/, m => ({ k: 'sweep', n: num(m[1]) })],
  [/counter target ([\w, ]*?)spell/, m => ({ k: 'counter', what: m[1].replace(/,/g, '').trim() || 'any' })],
  [/exile (?:any number of |up to \w+ )?target spells?/, () => ({ k: 'counter', what: 'any' })],
  // Silence, Orim's Chant: a player (or every opponent) can't cast spells this turn
  [/(your opponents|target player|target opponent|each opponent) can't cast spells this turn/, m => ({ k: 'silence', who: m[1] })],
  // Ad Nauseam: reveal cards into hand, losing life for each
  [/reveal the top card of your library and put that card into your hand\. you lose life equal to its mana value/, () => ({ k: 'adNauseam' })],
  // Orcish Bowmasters and friends
  [/amass (?:\w+ )?(\d+)/, m => ({ k: 'token', n: 1, p: +m[1], t: +m[1], desc: 'orc army', kw: [] })],
  [/counter (?:up to one )?target (?:activated or triggered |activated |triggered )ability/, () => ({ k: 'counterAbility' })],
  // Dramatic Reversal, Turnabout-style untaps: tapped mana sources become mana again
  [/untap all (nonland permanents|artifacts|creatures|lands|permanents) you control/, m => ({ k: 'untapAll', what: m[1] })],
  [/untap (?:up to (\w+) )?target (artifact|creature|land|permanent|nonland permanent)s?(?! and gain control)(?: you control)?(?=[.,]|$)/, m => ({ k: 'untapAll', what: m[2] + 's', n: m[1] ? num(m[1]) : 1 })],
  [/untap up to (\w+) lands/, m => ({ k: 'untapAll', what: 'lands', n: num(m[1]) })],
  // Brain Freeze and friends (storm makes copies; see Game.cast)
  [new RegExp(`(target player|target opponent|each opponent|each player) mills? ${N} cards?`), m => ({ k: 'mill', who: m[1], n: num(m[2]) })],
  // Redirect Lightning, Deflecting Swat: change the target of a spell or ability
  [/(?:change the target of|choose new targets for) target (?:spell or ability|spell|activated or triggered ability)(?: with a single target)?/, () => ({ k: 'redirect' })],
  [/(destroy|exile) (?:up to (?:one|two|three) )?(?:another |other )?target (?:[\w-]+ )*?(creature or planeswalker|artifact or enchantment|nonland permanent|creature|artifact|enchantment|planeswalker|permanent)\b(?! cards?| spells?)/, m => ({ k: 'remove', mode: m[1], what: m[2] })],
  [/return (?:up to one )?target (?:[\w-]+ )*?(creature|nonland permanent|permanent|artifact|enchantment)(?: an opponent controls| you don't control)? to its owner's hand/, m => ({ k: 'bounce', what: m[1] })],
  [/deals? (\d+|x) damage to (any target|any other target|target creature or planeswalker|target creature|target player or planeswalker|target opponent or planeswalker|target opponent|target player|each opponent|each player)/, m => ({ k: 'damage', n: num(m[1]), to: m[2] })],
  [new RegExp(`(?<!each player |each opponent |that player |each other player )\\bdraws? ${N} cards?`), m => ({ k: 'draw', n: num(m[1]) })],
  [/you gain (\d+|x) life/, m => ({ k: 'gain', n: num(m[1]) })],
  [/each opponent loses (\d+|x) life/, m => ({ k: 'drain', n: num(m[1]) })],
  [/target (?:player|opponent) loses (\d+|x) life/, m => ({ k: 'loseLife', n: num(m[1]) })],
  [new RegExp(`create ${N} (?:tapped )?(\\d+|x)\\/(\\d+|x) ([\\w -]*?) ?creature tokens?(?: with ([\\w, ]+))?`), m => ({ k: 'token', n: num(m[1]), p: num(m[2]), t: num(m[3]), desc: m[4], kw: kwList(m[5]) })],
  [new RegExp(`create ${N} (?:tapped )?treasure tokens?`), m => ({ k: 'treasure', n: num(m[1]) })],
  [/create a (?:food|clue|blood) token or a treasure token/, () => ({ k: 'treasure', n: 1 })],
  [/creatures you control get \+(\d+|x)\/\+(\d+|x)(?: and gain ([\w, ]+))? until end of turn/, m => ({ k: 'teamPump', p: num(m[1]), t: num(m[2]), kw: kwList(m[3]) })],
  // "Until end of turn, creatures you control gain trample and get +X/+X", "creatures you control gain flying until end of turn"
  [/(?:until end of turn, )?creatures you control gain ([\w, ]+?)(?: and get \+(\d+|x)\/\+(\d+|x))?(?: until end of turn|[.,]|$)/, m => (kwList(m[1]).length ? { k: 'teamPump', p: m[2] ? num(m[2]) : 0, t: m[3] ? num(m[3]) : 0, kw: kwList(m[1]) } : null)],
  [/target creature (?:you control )?gets \+(\d+|x)\/\+(\d+|x)(?: and gains ([\w, ]+))? until end of turn/, m => ({ k: 'pump', p: num(m[1]), t: num(m[2]), kw: kwList(m[3]) })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on each of up to (\\w+) target creatures`), m => ({ k: 'counters', n: num(m[1]), on: 'up to', count: num(m[2]) })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on (target (?:artifact or )?creature(?: you control)?|(?:up to one )?(?:other )?target creature(?: you control)?|each (?:other )?(?:[\\w-]+ )?creature you control|each (?:other )?[\\w-]+ you control|~|it|that creature)`), m => ({ k: 'counters', n: num(m[1]), on: /^(?:up to one )?(?:other )?target/.test(m[2]) ? 'target creature' : m[2] === 'it' || m[2] === 'that creature' ? '~' : m[2].startsWith('each') ? (m[2].includes('other') ? 'each other creature you control' : 'each creature you control') : m[2] })],
  [/double the number of \+1\/\+1 counters on (each creature you control|~|target creature)/, m => ({ k: 'doubleCounters', on: m[1] })],
  [/(?:return|put) (?:up to one )?(?:another )?target ([\w ]*?)cards? from (a|your|an opponent's) graveyard (?:to|onto) the battlefield/, m => ({ k: 'reanimate', any: m[2] !== 'your', types: typeWords(m[1]) })],
  [/gain control of (?:up to one )?target (?:[\w-]+ )*?(creature|artifact or creature|nonland permanent|permanent|artifact)(?: an opponent controls| you don't control)?( until end of turn)?( for as long as (?:~|you control ~)[^.]*)?/, m => ({ k: 'steal', what: m[1], temp: !!m[2], whileSrc: !!m[3] })],
  [/untap target (creature|artifact or creature|permanent) and gain control of it until end of turn/, m => ({ k: 'steal', what: m[1], temp: true })],
  [/takes? an extra turn after this one/, () => ({ k: 'extraTurn' })],
  // Rituals: "Add {B}{B}{B}." (mana abilities of permanents are handled separately)
  [/\badd ((?:\{[wubrgc]\})+)(?! for each card in)/, m => ({ k: 'addMana', syms: m[1].match(/[wubrgc]/g).map(c => c.toUpperCase()) })],
  [new RegExp(`(target player|target opponent|each opponent|each player|each other player) discards? ${N} cards?`), m => ({ k: 'discard', who: m[1], n: num(m[2]) })],
  [/create (?:a|one) token that's a copy of (?:up to one )?(?:another )?target (?:nonlegendary )?(creature|artifact|permanent)/, m => ({ k: 'copyToken', what: m[1] })],
  [/create (?:a|one) token that's a copy of (equipped creature|enchanted creature|it|that creature|that artifact|that permanent|~)/, m => ({ k: 'copyToken', what: 'creature', of: m[1] })],
  [/draws? a card for each (creature|artifact|land|enchantment) you control/, m => ({ k: 'draw', n: { dyn: 'count', what: m[1] } })],
  [/(untap all creatures (?:that attacked this turn|you control)[^.]*\. )?after this (?:main )?phase, there is an additional combat phase/, m => ({ k: 'extraCombat', untap: !!m[1] })],
  [/exile (?:up to one )?(?:another )?target (?:[\w-]+ )*?(creature|nonland permanent|permanent)[^.]*\. return (?:that card|it|the exiled card) to the battlefield under its owner's control at the beginning of the next end step/, m => ({ k: 'flickerDelay', what: m[1] })],
  [/return (?:up to (\w+) )?(?:another )?target ([\w ]*?)cards? from your graveyard to your hand/, m => ({ k: 'regrow', n: m[1] ? num(m[1]) : 1, types: typeWords(m[2]) })],
  [/(each opponent|each other player|target player|target opponent|that player) sacrifices (a|an|one|two|three|x|\d+) (nontoken )?(creature or planeswalker|creatures?|permanents?|nonland permanents?|artifacts?|enchantments?|lands?)(?: of their choice)?/, m => ({ k: 'edict', n: num(m[2]) === 'X' ? 1 : num(m[2]), nontoken: !!m[3], what: m[4].replace(/s$/, '').replace(' or planeswalker', ''), that: m[1] === 'that player' })],
  [/that player loses (\d+|x) life/, m => ({ k: 'loseThat', n: num(m[1]) })],
  [/that player discards (a|an|one|two|\d+) cards?/, m => ({ k: 'discard', who: 'that player', n: num(m[1]) })],
  [/(each player|each opponent|target player|target opponent) gets? (a|an|one|two|three|\d+) poison counters?/, m => ({ k: 'poison', who: m[1], n: num(m[2]) })],
  [/at the beginning of your next upkeep, pay ((?:\{[^}]+\})+)\. if you don't, you lose the game/, m => ({ k: 'pact', cost: m[1].toUpperCase() })],
  [/search your library for [^.]*/, m => searchEffect(m[0])],
  [/exile (?:up to one )?(another )?target (?:[\w-]+ )*?(creature|nonland permanent|permanent|artifact or creature)(?: you (?:control|own))?,? then return (?:it|that card) to the battlefield/, m => ({ k: 'blink', other: !!m[1], what: m[2] })],
  [/copy target (?:instant or sorcery |instant |sorcery |activated or triggered ability or instant or sorcery )?spell/, () => ({ k: 'copySpell' })],
  [/(target creature you control|target creature|target permanent you control|creatures you control|permanents you control|~) gains? ((?:hexproof|indestructible|shroud|protection from [\w ]+?)(?:(?:,|,? and) (?:hexproof|indestructible|shroud|protection from [\w ]+?))*) until end of turn/,
    m => ({ k: 'protect', scope: m[1].startsWith('target') ? 'one' : m[1] === '~' ? 'self' : 'all', kw: [...new Set(kwList(m[2]).concat(/protection/.test(m[2]) ? ['hexproof'] : []))] })],
  // ---- library: scry, surveil, milling yourself, looking at the top cards, playing from exile
  [/\bscry (\d+|x|a|an|one|two|three|four|five)/, m => ({ k: 'scry', n: num(m[1]) })],
  [/\bsurveil (\d+|x|a|an|one|two|three|four|five)/, m => ({ k: 'surveil', n: num(m[1]) })],
  [new RegExp(`(?:^|[.,:;] |then |you |and )mill ${N} cards?`), m => ({ k: 'mill', who: 'you', n: num(m[1]) })],
  [new RegExp(`put the top ${N} cards? of your library into your graveyard`), m => ({ k: 'mill', who: 'you', n: num(m[1]) })],
  [/(?:look at|reveal) the top (\w+) cards? of your library[^.]*\.?([^.]*\.?[^.]*)/, m => digEffect(m)],
  [/exile the top (?:(\w+) )?cards? of your library\.? (?:until (?:the )?end of (?:the )?turn|until (?:the end of )?your next turn|until your next end step|you may (?:play|cast))/, m => ({ k: 'impulse', n: m[1] ? num(m[1]) : 1, next: /next turn|next end/.test(m[0]) })],
  // ---- tokens and keyword actions
  [/investigate(?: (twice|three times))?/, m => ({ k: 'artifactToken', kind: 'clue', n: m[1] === 'twice' ? 2 : m[1] ? 3 : 1 })],
  [new RegExp(`create ${N} (?:tapped )?(food|clue|blood|map|powerstone) tokens?(?! or)`), m => ({ k: 'artifactToken', kind: m[2], n: num(m[1]) })],
  [/(?:target creature you control|~|it) fights (?:another )?(?:up to one )?target creature(?: you don't control| an opponent controls)?/, () => ({ k: 'fight' })],
  [/(?:target creature you control|~) deals damage equal to its power to (?:another )?(?:up to one )?target (?:creature|creature or planeswalker)(?: you don't control| an opponent controls)?/, () => ({ k: 'fight', bite: true })],
  [/goad (target creature|each creature (?:your opponents control|target player controls))/, m => ({ k: 'goad', all: m[1].startsWith('each') })],
  [/\bproliferate\b/, () => ({ k: 'proliferate' })],
  [/\bpopulate\b/, () => ({ k: 'populate' })],
  [/monstrosity (\d+|x)/, m => ({ k: 'monstrous', n: num(m[1]) })],
  [/\badapt (\d+)/, m => ({ k: 'adapt', n: +m[1] })],
  [/\bbolster (\d+|x)/, m => ({ k: 'bolster', n: num(m[1]) })],
  [/\bsupport (\d+)/, m => ({ k: 'support', n: +m[1] })],
  [/\bconnives?\b/, () => ({ k: 'connive' })],
  [/\bexplores?\b/, () => ({ k: 'explore' })],
  [/\bdiscover (\d+)/, m => ({ k: 'cascade', n: +m[1], discover: true })],
  [/\bincubate (\d+|x)/, m => ({ k: 'token', n: 1, p: num(m[1]), t: num(m[1]), desc: 'phyrexian', kw: [] })],
  [/regenerate (~|target creature)/, m => ({ k: 'regen', self: m[1] === '~' })],
  [/\btap (?:up to (\w+) )?target (creature|artifact|permanent|nonland permanent|land)s?(?! you control)/, m => ({ k: 'tap', what: m[2], n: m[1] ? num(m[1]) : 1 })],
  [/\btap all (creatures|nonland permanents|permanents|artifacts|lands) (?:your opponents control|target player controls|you don't control)/, m => ({ k: 'tapAll', what: m[1] })],
  [new RegExp(`each player draws ${N} cards?`), m => ({ k: 'drawEach', n: num(m[1]) })],
  [new RegExp(`(?:^|[.,] |then |and )discard ${N} cards?`), m => ({ k: 'discardSelf', n: num(m[1]) })],
  [/(?:^|[.,] |then )sacrifice (?:a|an|another) (creature|artifact|land|enchantment|permanent|nonland permanent)(?! you)/, m => ({ k: 'sacOwn', what: m[1] })],
  [/each player sacrifices (a|an|one|two|three|x|\d+) (nontoken )?(creatures?|permanents?|nonland permanents?)/, m => ({ k: 'edict', all: true, n: num(m[1]) === 'X' ? 1 : num(m[1]), nontoken: !!m[2], what: m[3].replace(/s$/, '') })],
  [new RegExp(`(?:put|place) ${N} -1\\/-1 counters? on (target creature(?: an opponent controls| you don't control)?|each creature(?: your opponents control| you don't control)?|each other creature)`), m => ({ k: 'minus', n: num(m[1]), on: m[2] })],
  [/target creature (?:an opponent controls |you don't control )?gets -(\d+|x)\/-(\d+|x) until end of turn/, m => ({ k: 'shrink', p: num(m[1]), t: num(m[2]) })],
  [/(creatures your opponents control|creatures you don't control|all creatures|each creature|all other creatures) gets? -(\d+|x)\/-(\d+|x) until end of turn/, m => ({ k: 'shrinkAll', p: num(m[2]), t: num(m[3]), opp: /opponent|don't/.test(m[1]) })],
  [/you lose (\d+|x) life/, m => ({ k: 'loseSelf', n: num(m[1]) })],
  [/(?:^|[.,] |and )(?:~|it) gets \+(\d+|x)\/\+(\d+|x)(?: and gains ([\w, ]+))? until end of turn/, m => ({ k: 'pumpSelf', p: num(m[1]), t: num(m[2]), kw: kwList(m[3]) })],
  [/(?:^|[.,] )~ gains ((?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach)(?:(?:,|,? and) (?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach))*) until end of turn/, m => ({ k: 'pumpSelf', p: 0, t: 0, kw: kwList(m[1]) })],
  [/deals (\d+) damage to (?:the player or planeswalker it's attacking|the player it's attacking|defending player|that player)/, m => ({ k: 'damage', n: +m[1], to: 'defender' })],
  [/each player loses (\d+|x) life/, m => ({ k: 'loseAll', n: num(m[1]) })],
  // Past in Flames, Snapcaster Mage, Mission Briefing: flashback for a card's mana cost this turn
  [/(each instant and sorcery card in your graveyard|target instant or sorcery card in your graveyard|target instant card in your graveyard|target sorcery card in your graveyard) gains flashback until end of turn/, m => ({ k: 'grantFlashback', all: m[1].startsWith('each') })],
  // Cabal Therapy, Thoughtseize-style: name a card, discards
  [/choose a (nonland )?card name\. target (?:player|opponent) reveals their hand and discards all cards with that name/, () => ({ k: 'discard', who: 'target opponent', n: 1, named: true })],
  [/target (?:player|opponent) reveals their hand\. you choose an? ([\w ]*?)card from it\. that player discards that card/, m => ({ k: 'discard', who: 'target opponent', n: 1, chosen: typeWords(m[1]) })],
  // ---- 1.5.1 families from the card scan
  [/(?:^|[.,] |and |then )(?:you )?may gain (\d+|x) life/, m => ({ k: 'gain', n: num(m[1]) })],
  [/target (?:player|opponent) loses that much life/, () => ({ k: 'loseLife', n: { dyn: 'trigN' } })],
  [/each opponent loses that much life/, () => ({ k: 'drain', n: { dyn: 'trigN' } })],
  [/untap (?:up to (\w+) )?another target (artifact|creature|permanent|land)s?/, m => ({ k: 'untapAll', what: m[2] + 's', n: m[1] ? num(m[1]) : 1 })],
  [/your opponents can't cast noncreature spells this turn/, () => ({ k: 'silence', who: 'your opponents' })],
  [/(?:target (?:attacking )?creature|target permanent|~) (?:you control )?gains? ((?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach)(?:(?:,|,? and) (?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach))*) until end of turn/, m => (/^~/.test(m[0]) ? null : { k: 'pump', p: 0, t: 0, kw: kwList(m[1]) })],
  [/(?:any number of )?target (?:nonland )?permanents? you control phases? out/, () => ({ k: 'protect', scope: 'all', kw: ['hexproof', 'indestructible'] })],
  [/put (?:up to one )?target ([\w ]*?)card from your graveyard on top of your library/, m => ({ k: 'regrow', n: 1, types: typeWords(m[1]), top: true })],
  [/return (?:up to one )?target ([\w ]*?)cards? with mana value (\d+) or less from your graveyard to the battlefield/, m => ({ k: 'reanimate', any: false, types: typeWords(m[1]), maxMv: +m[2] })],
  [/return (?:up to one )?target ([\w ]*?)cards? with mana value (\d+) or less from your graveyard to your hand/, m => ({ k: 'regrow', n: 1, types: typeWords(m[1]), maxMv: +m[2] })],
  [/(destroy|exile) (?:up to (?:one|two|three) )?target (artifacts? and\/or enchantments?|artifacts?,? (?:creatures?,? )?(?:and\/or|or) enchantments?)/, m => ({ k: 'remove', mode: m[1], what: 'artifact or enchantment' })],
  [/add x mana (?:in any combination of colors|of any one color)/, () => ({ k: 'addManaN', n: 'X' })],
  [/draw cards equal to the greatest toughness among creatures you control/, () => ({ k: 'draw', n: { dyn: 'maxToughness' } })],
  [/deals damage equal to the sacrificed creature's power to (any target|target opponent|each opponent)/, m => ({ k: 'damage', n: { dyn: 'sacPower' }, to: m[1] })],
  [/return ~ from your graveyard to the battlefield/, () => ({ k: 'returnSelf', counters: 0, fromGy: true })],
  [/that player draws (an additional card|a card|(\w+) additional cards)/, m => ({ k: 'drawThat', n: m[2] ? num(m[2]) : 1 })],
  [/you may cast (?:a|an|up to one) ([\w ]*?)spell with mana value (\d+) or less from your hand without paying its mana cost/, m => ({ k: 'freeCast', types: typeWords(m[1]), maxMv: +m[2] })],
  [/put a (\w+) counter on ~/, m => (['+1/+1', '-1/-1', 'indestructible', 'flying'].includes(m[1]) ? null : { k: 'namedCounter', kind: m[1] })],
  // ---- 1.5.0 families from the card scan
  [/look at the top (\w+) cards? of your library,? then put them back in any order/, m => ({ k: 'scry', n: num(m[1]), keepAll: true })],
  [/return (?:it|~) to the battlefield(?: tapped)?(?: under (?:its owner's|your) control)?/, () => ({ k: 'returnSelf', counters: 0 })],
  [/return (?:it|~) to (?:its owner's|your) hand/, () => ({ k: 'returnSelfHand' })],
  [/deals? (\d+|x) damage to (?:them|that creature's controller)(?:[.,]|$)/, m => ({ k: 'damage', n: num(m[1]), to: 'defender' })],
  [/(?:it|~) deals that much damage to (any target|target opponent|target player|each opponent|target creature)/, m => ({ k: 'damage', n: { dyn: 'trigN' }, to: m[1] })],
  [/deals damage equal to (?:that creature's|its) power to (any target|target opponent|each opponent|target creature)/, m => ({ k: 'damage', n: { dyn: 'trigP' }, to: m[1] })],
  [/draws? that many cards/, () => ({ k: 'draw', n: { dyn: 'trigN' } })],
  [/you gain (?:that much life|life equal to (?:that creature's|its) toughness)/, m => ({ k: 'gain', n: /toughness/.test(m[0]) ? { dyn: 'trigT' } : { dyn: 'trigN' } })],
  [/create that many (\d+)\/(\d+) ([\w -]*?) ?creature tokens?(?: with ([\w, ]+))?/, m => ({ k: 'token', n: { dyn: 'trigN' }, p: +m[1], t: +m[2], desc: m[3], kw: kwList(m[4]) })],
  [/create that many treasure tokens/, () => ({ k: 'treasure', n: { dyn: 'trigN' } })],
  [/draw cards equal to (?:the greatest power among creatures you control|the number of (creature|artifact|land|enchantment)s? you control|the number of cards in your hand)/, m => ({ k: 'draw', n: m[1] ? { dyn: 'count', what: m[1] } : /hand/.test(m[0]) ? { dyn: 'hand' } : { dyn: 'maxPower' } })],
  [/prevent all combat damage that would be dealt this turn/, () => ({ k: 'fog' })],
  [/you win the game/, () => ({ k: 'win' })],
  [/(?:^|[.,] |then )exile ~(?:[.,]|$)/, () => ({ k: 'exileSelf' })],
  [/untap ~(?:[.,]|$)/, () => ({ k: 'untapSelf' })],
  [/(target creature|~|target creature you control) can't be blocked this turn/, m => ({ k: 'evade', self: m[1] === '~' })],
  [/put an? (indestructible|flying|first strike|deathtouch|lifelink|trample|hexproof|menace|reach|vigilance) counter on (~|target creature(?: you control)?)/, m => ({ k: 'kwCounter', kw: m[1], self: m[2] === '~' })],
  [/reveal the top card of your library\. if it's a land card, put it onto the battlefield(?: tapped)?\. otherwise, put (?:that card|it) into your hand/, () => ({ k: 'topLandOrHand' })],
  [/(?:~ becomes|until end of turn, ~ becomes) an? (\d+)\/(\d+) ([\w ,]*?)creature(?: with ([\w, ]+?))?(?: until end of turn|[.]|$)/, m => ({ k: 'animate', p: +m[1], t: +m[2], kw: kwList(m[4] || m[3]) })],
  [/attach (?:it|~) to (?:up to one )?target (?:legendary )?creature you control/, () => ({ k: 'attachSelf' })],
  [/return (?:a|an) (land|creature|permanent|nonland permanent|artifact|enchantment) you control to its owner's hand/, m => ({ k: 'bounceOwn', what: m[1] })],
  [/you may play an additional land this turn/, () => ({ k: 'extraLand' })],
  [/you become the monarch/, () => ({ k: 'monarch' })],
  [/put (?:a|an|up to one) (land|creature|permanent|artifact|nonland permanent) card from your hand onto the battlefield/, m => ({ k: 'fromHand', what: m[1] })],
  [/shuffle your graveyard into your library/, () => ({ k: 'reshuffle' })],
  [/exile (?:all cards from )?(?:target player's|each opponent's|all opponents'|all|each player's) graveyards?|exile all graveyards/, () => ({ k: 'exileGy', all: true })],
  [/exile (?:up to (?:one|two|three) )?target cards? from (?:a|an opponent's) graveyard/, () => ({ k: 'exileGy', all: false })],
  [/return all (creature|artifact|enchantment|land|permanent)? ?cards from (your|all|each player's) graveyards? to the battlefield/, m => ({ k: 'massReanimate', what: m[1] || 'permanent', all: m[2] !== 'your' })],
  [/\badd (one|two|three|x) mana of any (?:one )?(?:color|type)/, m => ({ k: 'addMana', syms: Array(num(m[1]) === 'X' ? 1 : num(m[1])).fill('*') })],
  // ---- 1.6.0 families from the card scan
  [/that player mills (\w+|that many) cards?/, m => ({ k: 'mill', who: 'that player', n: m[1] === 'that many' ? { dyn: 'trigN' } : num(m[1]) })],
  [/(each opponent|target player|target opponent|each player) mills? cards equal to the number of cards in (?:your hand|their graveyard)/, m => ({ k: 'mill', who: m[1], n: /hand/.test(m[0]) ? { dyn: 'hand' } : 3 })],
  [/(?:it|~) deals (\d+|x) damage to you(?:[.,]|$)/, m => ({ k: 'loseSelf', n: num(m[1]) })],
  [/\bthey (?:each )?lose (\d+|x) life/, m => ({ k: 'loseThat', n: num(m[1]) })],
  [/double the power and toughness of each creature you control/, () => ({ k: 'doublePT', all: true })],
  [/double (?:the power(?: and toughness)? of )?target creature(?:'s power(?: and toughness)?)?/, () => ({ k: 'doublePT', all: false })],
  [/target creature(?: you control)? with power (\d+) or less can't be blocked this turn/, () => ({ k: 'evade', self: false })],
  [/choose a color\. add an amount of mana of that color equal to your devotion to that color/, () => ({ k: 'addManaN', n: { dyn: 'devotionMax' } })],
  [/return (?:up to one )?target ([\w-]+) you control to its owner's hand/, m => (['creature', 'permanent', 'artifact', 'enchantment', 'land', 'nonland'].includes(m[1]) ? null : { k: 'bounceOwn', what: m[1] })],
  [/put an (\w+) counter on ~/, m => (['indestructible'].includes(m[1]) ? null : { k: 'namedCounter', kind: m[1] })],
  [/(?:^|[.,] )(?:it|that creature) gains ((?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach|indestructible|hexproof)(?:(?:,|,? and) (?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach|indestructible|hexproof))*) until end of turn/, m => ({ k: 'pumpTrig', p: 0, t: 0, kw: kwList(m[1]) })],
  [/(?:^|[.,] )(?:it|that creature) gets \+(\d+|x)\/\+(\d+|x)(?: and gains ([\w, ]+))? until end of turn/, m => ({ k: 'pumpTrig', p: num(m[1]), t: num(m[2]), kw: kwList(m[3]) })],
  [/copy that spell/, () => ({ k: 'copyTrig' })],
  [/you gain protection from everything until your next turn|your life total can't change and you gain protection from everything/, () => ({ k: 'shieldSelf' })],
  [/the ring tempts you/, () => ({ k: 'ring' })],
  [/you get (an?|one|two|three|\d+) (experience|energy|rad) counters?/, m => ({ k: 'playerCounter', kind: m[2], n: num(m[1]) })],
  [/you get ((?:\{e\})+)/, m => ({ k: 'playerCounter', kind: 'energy', n: m[1].match(/\{e\}/g).length })],
  [/attach ~ to (?:it|that creature)/, () => ({ k: 'attachSelf', toTrig: true })],
  [/enchanted creature gains ([\w ,]+?) until end of turn/, m => (kwList(m[1]).length ? { k: 'pumpAttached', p: 0, t: 0, kw: kwList(m[1]) } : null)],
  [/(?:enchanted|equipped) creature gets \+(\d+|x)\/\+(\d+|x)(?: and gains ([\w, ]+))? until end of turn/, m => ({ k: 'pumpAttached', p: num(m[1]), t: num(m[2]), kw: kwList(m[3]) })],
  [/the next (?:[\w ]+ )?spell you cast this turn can't be countered/, () => ({ k: 'uncounterNext' })],
  [/target (?:legendary|nonlegendary|attacking|blocking|artifact|tapped|untapped) creature(?: you control)? gains ((?:hexproof|indestructible|shroud)(?:(?:,|,? and) (?:hexproof|indestructible|shroud))*) until end of turn/, m => ({ k: 'protect', scope: 'one', kw: kwList(m[1]) })],
  [/(?:up to one )?target creature(?: you control)? phases out/, () => ({ k: 'protect', scope: 'one', kw: ['hexproof', 'indestructible'] })],
  [/any number of (?:other )?target creatures you control phase out/, () => ({ k: 'protect', scope: 'all', kw: ['hexproof', 'indestructible'] })],
  [/regenerate target (?!creature\b)[\w, ]+/, () => ({ k: 'regen', self: false })],
  [/put (?:it|~) on the bottom of its owner's library/, () => ({ k: 'bottomSelf' })],
  [/return that card to the battlefield under (?:your|its owner's) control/, () => ({ k: 'returnTrig' })],
  [/earthbend (\d+|x)/, m => ({ k: 'token', n: 1, p: num(m[1]), t: num(m[1]), desc: 'land elemental', kw: ['haste'] })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on (?:equipped|enchanted) creature`), m => ({ k: 'counters', n: num(m[1]), on: 'attached' })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on each (other )?([\\w ,\\/-]+?) (?:you control )?that entered(?: the battlefield)? this turn`), m => ({ k: 'counters', n: num(m[1]), on: 'each', what: m[3].replace(/creatures?$/, '').trim() || 'creature', recent: true, other: !!m[2] })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on each (other )?((?:[\\w-]+ )+(?:and\\/or|or) [\\w ,-]+?) you control`), m => ({ k: 'counters', n: num(m[1]), on: 'each', what: m[3].replace(/ and\/or /g, ' or ').replace(/creatures? /g, '').trim(), other: !!m[2] })],
  [new RegExp(`put ${N} \\+1\\/\\+1 counters? on (?:him|her|them)\\b`), m => ({ k: 'counters', n: num(m[1]), on: '~' })],
  [/transform ~/, () => ({ k: 'transform' })],
  [/return all attacking creatures to their owners?'s? hands?/, () => ({ k: 'bounceAll', what: 'attacking' })],
  [/return all (creatures|nonland permanents|artifacts|enchantments|other creatures) to their owners?'s? hands?/, m => ({ k: 'bounceAll', what: m[1] })],
  [/(?:it|~) deals that much damage to each other opponent/, () => ({ k: 'damage', n: { dyn: 'trigN' }, to: 'each opponent' })],
  [/(?:you may )?put a land card from among them into your hand/, () => ({ k: 'regrow', n: 1, types: ['land'] })],
  [/reveal cards from the top of your library until you reveal (?:a|an|x) (basic )?land cards?[^.]*\. put (?:that card|it|those cards|them) onto the battlefield( tapped)?/, m => ({ k: 'rampLand', n: 1, bf: true, tapped: !!m[2], basic: !!m[1] })],
  [/look at the top card of your library\. if it's an? ([\w ]+?) card( of the chosen type)?,? you may (?:reveal it and )?put it (onto the battlefield(?: tapped)?|into your hand)/, m => ({ k: 'dig', n: 1, take: 1, types: typeWords(m[1]), bf: m[3].startsWith('onto'), chosen: !!m[2] })],
  [/exile the top card of each player's library/, () => ({ k: 'impulse', n: 1 })],
  [/exile the top (\w+) cards? of target opponent's library/, m => ({ k: 'impulse', n: num(m[1]) === 'X' ? 2 : num(m[1]) })],
  [/exile the top card of (?:target opponent's|that player's|each opponent's) library\. you may (?:play|cast) (?:that card|those cards|it)/, () => ({ k: 'impulse', n: 1 })],
  [/\broll a d(\d+)\b/, m => (LAST_ROLL = { k: 'roll', d: +m[1], table: [] })],
  [/you may cast spells this turn as though they had flash/, () => ({ k: 'flashTurn' })],
  [/you may cast (?:a|target) ([\w ]*?)(?:creature )?(?:spell|card) from your graveyard this turn/, m => ({ k: 'gyCastTurn', types: typeWords(m[1]) })],
  [/you may play lands and cast spells from your graveyard/, () => ({ k: 'gyCastTurn', types: [] })],
  [/each creature you control with power (\d+) or greater gets \+(\d+)\/\+(\d+)(?: and gains ([\w, ]+))? until end of turn/, m => ({ k: 'teamPump', p: +m[2], t: +m[3], kw: kwList(m[4]), minPower: +m[1] })],
  [/creatures your opponents control attack this turn if able/, () => ({ k: 'goad', all: true })],
  [/(destroy|exile) target (land|nonbasic land)/, m => ({ k: 'remove', mode: m[1], what: 'land' })],
  [/gain control of all artifacts that player controls/, () => ({ k: 'stealAll', what: 'artifact' })],
  // ---- 1.6.0 second batch: one-of-a-kind staples
  [/the owner of target (permanent|nonland permanent|creature) shuffles it into their library/, m => ({ k: 'remove', mode: 'exile', what: m[1] })],
  [/each player discards their hand, then draws cards equal to the greatest number of cards a player discarded this way/, () => ({ k: 'wheel', n: 'most' })],
  [/each player (?:shuffles their hand and graveyard into their library|discards their hand), then draws seven cards/, () => ({ k: 'wheel', n: 7 })],
  [/put your commander into your hand from the command zone/, () => ({ k: 'commanderToHand' })],
  [/permanents your opponents control lose hexproof and indestructible until end of turn/, () => ({ k: 'stripProt', kws: ['hexproof', 'indestructible'] })],
  [/creatures your opponents control lose hexproof and shroud/, () => ({ k: 'stripProt', kws: ['hexproof', 'shroud'] })],
  [/exile the top card of your library\.?$/, () => ({ k: 'impulse', n: 1 })],
  [/^exile that creature\.?$/, () => ({ k: 'remove', mode: 'exile', what: 'creature' })],
  [/each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield/, () => ({ k: 'livingDeath' })],
  [/target creature you control deals damage equal to its power to each other creature and each opponent/, () => ({ k: 'ignition' })],
  [/put all creature cards from all graveyards onto the battlefield under your control/, () => ({ k: 'massReanimate', what: 'creature', all: true, mine: true })],
  [/exile that card from your graveyard/, () => ({ k: 'exileTrigCard' })],
  [/look at target (?:player's|opponent's) hand/, () => ({ k: 'peek' })],
  [/for each token you control, create a token that's a copy of that permanent/, () => ({ k: 'copyAllTokens' })],
  [/untap target attacking creature\. prevent all combat damage that would be dealt to and dealt by that creature this turn/, () => ({ k: 'maze' })],
  [/remove target attacking creature you control from combat and untap it/, () => ({ k: 'maze', own: true })],
  [/return target spell to its owner's hand/, () => ({ k: 'counter', what: 'any', toHand: true })],
  [/exile (?:two|up to two|any number of) target [\w ,/]+? you control,? (?:then )?(?:and )?return (?:those cards|them) to the battlefield/, () => ({ k: 'blink', other: false, what: 'creature' })],
  [/exile any number of target creatures you control\. return those cards to the battlefield/, () => ({ k: 'blink', other: false, what: 'creature' })],
  [/choose target ([\w ]*?)card in your graveyard\. you may cast that card this turn/, m => ({ k: 'gyCastTurn', types: typeWords(m[1]) })],
  [/untap target (forest|island|swamp|mountain|plains|legendary permanent|legendary creature)/, m => ({ k: 'untapAll', what: /legendary/.test(m[1]) ? 'permanents' : 'lands', n: 1 })],
  [/target (?:legendary creature|commander|creature you control) gains (fear|lifelink|deathtouch|trample|flying|haste|menace|first strike|intimidate|shadow) until end of turn/, m => ({ k: 'pump', p: 0, t: 0, kw: [m[1]] })],
  [/create a token that's a copy of (?:another )?target (token|artifact or enchantment|nonland permanent|creature or artifact) you control/, m => ({ k: 'copyToken', what: m[1] === 'token' ? 'creature' : m[1] })],
  [/put (?:up to one )?target ([\w ]*?)card from a graveyard on top of its owner's library/, m => ({ k: 'regrow', n: 1, types: typeWords(m[1]), top: true })],
  [/(?:^|[.,] )add (two|three|four|five|six|seven|eight|ten) \{([wubrgc])\}/, m => ({ k: 'addMana', syms: Array(num(m[1])).fill(m[2].toUpperCase()) })],
  [/attach that equipment to target creature you control/, () => ({ k: 'attachTrig' })],
  [/target opponent creates (a|an|one|two|\d+) (\d+)\/(\d+) ([\w ]*?) ?creature tokens?/, m => ({ k: 'oppToken', n: num(m[1]), p: +m[2], t: +m[3], desc: m[4] })],
  [/(?:other )?((?:[a-z]+, )*[a-z]+,? and [a-z]+|[a-z]+s) you control get \+(\d+|x)\/\+(\d+|x)(?: and gain ([\w, ]+))? until end of turn/, m => (/^(?:creatures|permanents)$/.test(m[1]) ? null : { k: 'teamPump', p: num(m[2]), t: num(m[3]), kw: kwList(m[4]), what: m[1].replace(/,? and /g, ' or ').replace(/, /g, ' or ').split(' or ').map(w => w.replace(/s$/, '')).join(' or ') })],
  [/(?:until end of turn, )?whenever a player taps an? (island|swamp|forest|mountain|plains) for mana, that player adds an additional \{([wubrg])\}/, m => ({ k: 'tempLandBoost', what: m[1], sym: m[2].toUpperCase() })],
  [/sacrifice (two|three) lands/, m => ({ k: 'sacOwn', what: 'land', n: num(m[1]) })],
  [/exile x target creatures/, () => ({ k: 'remove', mode: 'exile', what: 'creature' })],
  [/that creature gets -(\d+)\/-(\d+) until end of turn/, m => ({ k: 'shrink', p: +m[1], t: +m[2] })],
  [/goad all creatures (?:you don't control|your opponents control)/, () => ({ k: 'goad', all: true })],
  [/creatures your opponents control attack each combat if able/, () => ({ k: 'goad', all: true })],
  [/exile the top card of your library\. you may put that card into your hand unless it has the same name as another card exiled this way/, () => ({ k: 'tutor', types: [] })],
  [/choose a card name\. exile the top six cards of your library, then reveal cards from the top of your library until you reveal a card with the chosen name/, () => ({ k: 'tutor', types: [] })],
  [/sacrifice ~ unless you sacrifice an? (land|creature|artifact)/, m => ({ k: 'sacUnless', what: m[1] })],
  [/each player sacrifices all permanents they control that are one or more colors/, () => ({ k: 'allIsDust' })],
  [/its owner shuffles their graveyard into their library/, () => ({ k: 'reshuffle' })],
  [/put an? (equipment|aura) card from your hand onto the battlefield/, m => ({ k: 'fromHand', what: m[1] })],
  // ---- 1.6.0 third batch
  [/each player sacrifices (four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fifteen|twenty) creatures/, m => ({ k: 'edict', all: true, n: num(m[1]), nontoken: false, what: 'creature' })],
  [/(?:you may )?have that player lose (\d+) life/, m => ({ k: 'loseThat', n: +m[1] })],
  [/(?:^|[.,] )sacrifice ~(?:[.,]|$)/, () => ({ k: 'sacSelf' })],
  [/exile up to one target nonland, nontoken permanent you don't control with mana value (\d+) or less/, m => ({ k: 'remove', mode: 'exile', what: 'nonland permanent', maxMv: +m[1] })],
  [/(?:^|[.,] )(?:you )?may mill (\w+) cards?/, m => ({ k: 'mill', who: 'you', n: num(m[1]) })],
  [/(destroy|exile) all (nontoken creatures|nonartifact creatures|creatures you don't control|creatures your opponents control|nonland permanents you don't control|nonland permanents your opponents control|planeswalkers|lands)/, m => ({ k: 'wipe', mode: m[1], what: m[2] })],
  [/after this main phase, there are two additional combat phases/, () => ({ k: 'extraCombat', untap: false, n: 2 })],
  [/\btap another target (creature|permanent|artifact)/, m => ({ k: 'tap', what: m[1], n: 1 })],
  [/exile two target permanents/, () => ({ k: 'remove', mode: 'exile', what: 'nonland permanent' })],
  [/defending player exiles the top (\w+) cards of their library/, m => ({ k: 'mill', who: 'defending player', n: num(m[1]), exile: true })],
  [/copy it for each other instant and sorcery spell you've cast before it this turn/, () => ({ k: 'copyTrig', storm: true })],
  [/deals (x|\d+) damage divided as you choose among (?:up to )?(?:one|two|three|any number of|one, two, or three) (?:target )?(?:creatures and\/or planeswalkers|targets?)/, m => ({ k: 'damage', n: num(m[1]), to: /planeswalkers/.test(m[0]) ? 'target creature' : 'any target' })],
  [/it deals that much damage to each creature that player controls/, () => ({ k: 'sweepThat', n: { dyn: 'trigN' } })],
  [/put that many (\w+) counters on ~/, m => ({ k: 'namedCounter', kind: m[1], n: { dyn: 'trigN' } })],
  // ---- 1.6.0 fourth batch
  [/(destroy|exile) target ((?:non[\w-]+, )+non[\w-]+) (creature|permanent)/, m => ({ k: 'remove', mode: m[1], what: m[3] === 'permanent' ? 'nonland permanent' : 'creature', not: m[2].split(', ').map(w => w.replace(/^non-?/, '')) })],
  [/draw cards equal to the difference/, () => ({ k: 'draw', n: { dyn: 'toSeven' } })],
  [/untap (?:enchanted|equipped) creature/, () => ({ k: 'untapAttached' })],
  [/untap all creatures and gain control of them until end of turn/, () => ({ k: 'insurrection' })],
  [/deals (\d+) damage to target (?:attacking or blocking|attacking|blocking|tapped) creature/, m => ({ k: 'damage', n: +m[1], to: 'target creature' })],
  [/each other creature gets -(\d+)\/-(\d+) until end of turn/, m => ({ k: 'shrinkAll', p: +m[1], t: +m[2], opp: false, other: true })],
  [/put a basic land card from your hand onto the battlefield/, () => ({ k: 'fromHand', what: 'land' })],
  [/create a number of (?:tapped )?(\d+)\/(\d+) ([\w ]*?) ?creature tokens equal to its power/, m => ({ k: 'token', n: { dyn: 'selfPower' }, p: +m[1], t: +m[2], desc: m[3], kw: [] })],
  [/create a number of (?:tapped )?treasure tokens equal to its power/, () => ({ k: 'treasure', n: { dyn: 'selfPower' } })],
  [/all (\w+)s gain (menace|flying|trample|haste|deathtouch|lifelink|indestructible) until end of turn/, m => ({ k: 'teamPump', p: 0, t: 0, kw: [m[2]], what: m[1] })],
  [/amass (?:\w+ )?x\b/, () => ({ k: 'token', n: 1, p: 'X', t: 'X', desc: 'orc army', kw: [] })],
  [/you can't lose the game this turn and your opponents can't win the game this turn/, () => ({ k: 'cantLoseTurn' })],
  // ---- 1.7.0
  [/prevent all damage that would be dealt to you this turn/, () => ({ k: 'preventMe' })],
  [/add an amount of \{b\} equal to the sacrificed creature's mana value/, () => ({ k: 'addManaN', n: { dyn: 'sacMv' }, color: 'B' })],
  [/that player draws (seven|two|three|four) cards/, m => ({ k: 'drawThat', n: num(m[1]) })],
  [/~ deals damage equal to that spell's mana value to any target/, () => ({ k: 'damage', n: { dyn: 'trigMV' }, to: 'any target' })],
  [/each opponent loses life equal to the number of tapped creatures you control/, () => ({ k: 'drain', n: { dyn: 'tappedCreatures' } })],
  [/create a number of 1\/1 (\w+) (\w+) creature tokens equal to the number of opponents you have/, m => ({ k: 'token', n: { dyn: 'opps' }, p: 1, t: 1, desc: `${m[1]} ${m[2]}`, kw: [] })],
  [/sacrifice it unless you pay \{(\d+)\}/, m => ({ k: 'sacUnlessPay', n: +m[1] })],
  [/sacrifice it unless you tap an untapped permanent you control/, () => ({ k: 'sacUnlessTap' })],
  [/target (?:creature|creature you don't control) can't block this turn/, () => ({ k: 'noBlock' })],
  [/target creature can't attack or block this turn/, () => ({ k: 'noBlock', attack: true })],
  [/target player gains (\d+) life/, m => ({ k: 'gain', n: +m[1] })],
  [/each player chooses a creature or planeswalker they control, then sacrifices the rest/, () => ({ k: 'keepOne', n: 1, who: 'each', pw: true })],
  [/that player chooses up to two creatures they control, then sacrifices the rest/, () => ({ k: 'keepOne', n: 2, who: 'that player' })],
  [/if a card would be put into your graveyard from anywhere this turn, exile that card instead/, () => ({ k: 'gyExileTurn' })],
  [/add x mana in any combination of \{b\} and\/or \{r\}, where x is the sacrificed creature's mana value/, () => ({ k: 'addManaN', n: { dyn: 'sacMv' } })],
  [/(target player|each opponent|target opponent) mills half their library, rounded (down|up)/, m => ({ k: 'millHalf', who: m[1], up: m[2] === 'up' })],
  [/double target player's life total/, () => ({ k: 'doubleLife' })],
  [/shuffle ~ into its owner's library/, () => ({ k: 'shuffleSelf' })],
  [/target player takes two extra turns after this one/, () => ({ k: 'extraTurn', n: 2 })],
  [/you may play up to (\w+) additional lands this turn/, m => ({ k: 'extraLand', n: num(m[1]) })],
  [/add two mana in any combination of colors/, () => ({ k: 'addMana', syms: ['*', '*'] })],
  [/draw cards equal to (?:its|~'s) power/, () => ({ k: 'draw', n: { dyn: 'selfPower' } })],
  [/draw cards equal to the sacrificed creature's power/, () => ({ k: 'draw', n: { dyn: 'sacPower' } })],
  [/draw cards equal to the power of target creature you control/, () => ({ k: 'draw', n: { dyn: 'maxPower' } })],
  [/draw cards equal to the greatest mana value among artifacts you control/, () => ({ k: 'draw', n: { dyn: 'maxMv', what: 'artifact' } })],
  [/you gain life equal to its power/, () => ({ k: 'gain', n: { dyn: 'selfPower' } })],
  [/(?:they|that player) loses? half their life, rounded up/, () => ({ k: 'loseHalf' })],
  [/return all (creature|artifact and enchantment|legendary permanent|zombie creature) cards(?: with mana value (\d+) or less)? from your graveyard to the battlefield( tapped)?/, m => ({ k: 'massReanimate', what: m[1].replace(' and ', ' or '), maxMv: m[2] ? +m[2] : null, tapped: !!m[3] })],
  [/return (?:up to )?two (?:other )?target (creatures|nonland permanents)(?: controlled by different players)? to their owners' hands/, m => ({ k: 'bounce', what: m[1] === 'creatures' ? 'creature' : 'nonland permanent', n: 2 })],
  [/return all nonland permanents target player controls to their owner's hand/, () => ({ k: 'bounceOpp' })],
  [/target opponent reveals their hand\. you choose a noncreature, nonland card from it\. that player discards that card/, () => ({ k: 'discard', who: 'target opponent', n: 1, chosen: ['instant', 'sorcery', 'artifact', 'enchantment', 'planeswalker', 'battle'] })],
  [/each opponent loses two times x life\. you gain life equal to the life lost this way/, () => ({ k: 'drain', n: 'X', times: 2, gain: true })],
  [/~ deals damage to each player equal to (?:twice )?the number of nonbasic lands that player controls/, m => ({ k: 'nonbasicBurn', times: /twice/.test(m[0]) ? 2 : 1 })],
  [/it deals damage to each player equal to the number of nonbasic lands that player controls/, () => ({ k: 'nonbasicBurn', times: 1 })],
  // ---- 1.17.0 (card scan, item 82)
  // Tribal and filtered targets: "target blinkmoth creature gets +1/+1", "untap target elf", "target dinosaur gains haste"
  [/target ([a-z]+) (?:creature )?gets \+(\d+)\/\+(\d+) until end of turn/, m => (['creature', 'attacking', 'blocking', 'legendary', 'tapped', 'untapped'].includes(m[1]) ? null : { k: 'pump', p: +m[2], t: +m[3], kw: [] })],
  [/untap target creature that /, () => ({ k: 'untapAll', what: 'creatures', n: 1 })],
  [/untap target ([a-z]+)(?=[.,]|$)/, m => (['artifact', 'creature', 'land', 'permanent', 'forest', 'island', 'swamp', 'mountain', 'plains'].includes(m[1]) ? null : { k: 'untapAll', what: 'creatures', n: 1 })],
  [/untap (two|three) other target [\w ]+? creatures/, m => ({ k: 'untapAll', what: 'creatures', n: num(m[1]) })],
  [/target ([a-z]+) gains (haste|flying|trample|lifelink|deathtouch|vigilance|menace|first strike|double strike) until end of turn/, m => (['creature', 'permanent'].includes(m[1]) ? null : { k: 'pump', p: 0, t: 0, kw: [m[2]] })],
  [/target creature you control with [^.]*? gains (haste|flying|trample|lifelink|deathtouch|vigilance|menace|first strike|double strike) until end of turn/, m => ({ k: 'pump', p: 0, t: 0, kw: [m[1]] })],
  [/target creature becomes (?:white|blue|black|red|green) and gains (haste|flying|trample|menace) until end of turn/, m => ({ k: 'pump', p: 0, t: 0, kw: [m[1]] })],
  [/target creature gains (shadow|fear|intimidate|horsemanship) until end of turn/, m => ({ k: 'pump', p: 0, t: 0, kw: [m[1]] })],
  [/regenerate another target [a-z]+/, () => ({ k: 'regen', self: false })],
  [/target [\w ]+? you control gains protection from (?:the color of your choice|[\w ]+?) until end of turn/, () => ({ k: 'protect', scope: 'one', kw: ['hexproof'] })],
  // Graveyards: tribal or filtered returns
  [/return target ((?:[a-z]+, )+(?:or )?[a-z]+) card from your graveyard to your hand/, () => ({ k: 'regrow', n: 1, types: ['creature'] })],
  [/return target ([\w ]*?)card that [^.]*? from your graveyard to your hand/, m => ({ k: 'regrow', n: 1, types: typeWords(m[1]) })],
  [/return an? ([\w ]*?)card at random from your graveyard to your hand/, m => ({ k: 'regrow', n: 1, types: typeWords(m[1]), random: true })],
  [/return up to two creature cards with total mana value (\d+) or less from your graveyard to the battlefield/, m => ({ k: 'reanimate', any: false, types: ['creature'], maxMv: +m[1] })],
  [/for each opponent, you may put up to one target creature card from that player's graveyard onto the battlefield under your control/, () => ({ k: 'reanimate', any: true, types: ['creature'], eachOpp: true })],
  [/put target creature card from that player's graveyard onto the battlefield under your control/, () => ({ k: 'reanimate', any: true, types: ['creature'], fromThat: true })],
  [/shuffle any number of target cards from your graveyard into your library/, () => ({ k: 'reshuffle' })],
  [/choose a card at random in your graveyard\. if it's a creature card, put it onto the battlefield\. otherwise, put it into your hand/, () => ({ k: 'deadbridge' })],
  [/choose a creature type\. return all creature cards of the chosen type from your graveyard to the battlefield/, () => ({ k: 'massReanimate', what: 'creature', bestType: true })],
  // Lands and libraries
  [/target player searches their library for (?:a|up to \w+) basic land cards?, puts? (?:it|them) onto the battlefield( tapped)?/, m => ({ k: 'rampLand', n: 1, bf: true, tapped: !!m[1], basic: true })],
  [/reveal cards from the top of your library until you reveal a basic land card\. put that card into your hand and all other cards revealed this way into your graveyard/, () => ({ k: 'hermit' })],
  [/(each opponent|target player|target opponent) mills cards equal to the number of cards in their hand/, m => ({ k: 'mill', who: m[1], n: { dyn: 'theirHand' } })],
  [/any number of target players each mill (\w+) cards/, m => ({ k: 'mill', who: 'each opponent', n: num(m[1]) })],
  [/each of those players mills (\w+) cards/, m => ({ k: 'mill', who: 'each opponent', n: num(m[1]) })],
  [/search target opponent's library for a creature card and put that card onto the battlefield under your control/, () => ({ k: 'bribery' })],
  [/target player draws cards equal to half the number of cards in their library and loses half their life/, () => ({ k: 'peer' })],
  // Your own creatures and equipment
  [/return (?:another )?target creature you control to its owner's hand/, () => ({ k: 'bounceOwn', what: 'creature' })],
  [/attach target (?:aura or )?equipment you control to target creature you control/, () => ({ k: 'moveEquip' })],
  [/distribute (\w+) \+1\/\+1 counters among (?:one or two|up to \w+|any number of) target creatures(?: you control)?/, m => ({ k: 'counters', n: num(m[1]), on: 'target creature' })],
  [/put a \+1\/\+1 counter on each creature target player controls/, () => ({ k: 'counters', n: 1, on: 'each creature you control' })],
  [/put a \+1\/\+1 counter, a reach counter, and a deathtouch counter on target creature/, () => ({ k: 'kwCounter', kw: 'deathtouch', also: ['reach'], plus: 1, self: false })],
  [/double the number of \+1\/\+1 counters on enchanted creature/, () => ({ k: 'doubleCounters', on: 'enchanted creature' })],
  [/another target creature you control gains haste and gets \+x\/\+x until end of turn, where x is that creature's power/, () => ({ k: 'doublePT', all: false, haste: true })],
  [/put any number of creature cards from your hand onto the battlefield/, () => ({ k: 'fromHand', what: 'creature', n: 99 })],
  [/\{t\}: tap enchanted creature|^tap enchanted creature/, () => ({ k: 'tapAttached' })],
  [/put (two|three|four) (\w+) counters on ~/, m => (m[2] === '+1/+1' ? null : { k: 'namedCounter', kind: m[2], n: num(m[1]) })],
  // Mana
  [/double the amount of each type of unspent mana you have/, () => ({ k: 'doublePool' })],
  [/add (two|three) mana in any combination of \{([wubrg])\} and\/or \{([wubrg])\}/, m => ({ k: 'addMana', syms: Array(num(m[1])).fill(m[2].toUpperCase() + m[3].toUpperCase()) })],
  [/add x mana in any combination of \{([wubrg])\} and\/or \{([wubrg])\}, where x is ~'s power/, () => ({ k: 'addManaN', n: { dyn: 'selfPower' } })],
  [/create your choice of a blood token, a clue token, or a food token/, () => ({ k: 'artifactToken', kind: 'clue', n: 1 })],
  // Damage and life
  [/~ deals damage to each player equal to half that player's life total, rounded down/, () => ({ k: 'halfLifeDamage' })],
  [/~ deals damage equal to the number of ([\w ]+?)s you control to (target creature or planeswalker|any target|target creature)/, m => ({ k: 'damage', n: { dyn: 'countWhere', what: singular(m[1]), where: 'you' }, to: m[2] })],
  [/(?:he|she|it|~) deals damage equal to the number of ([\w ]+?)s you control to (any target|target creature or planeswalker|target creature|target opponent)/, m => ({ k: 'damage', n: { dyn: 'countWhere', what: singular(m[1]), where: 'you' }, to: m[2] })],
  [/deals (x|\d+) damage to each of up to (?:two|three|x) targets/, m => ({ k: 'damage', n: num(m[1]), to: 'any target' })],
  [/deals five times x damage to each of up to x targets/, () => ({ k: 'damage', n: 'X', mult: 5, to: 'any target' })],
  [/choose any target, then choose another target for each time ~ was kicked\. ~ deals (x|\d+) damage to each of them/, m => ({ k: 'damage', n: num(m[1]), to: 'any target' })],
  [/each opponent loses life equal to the life (?:that player|they) lost this turn/, () => ({ k: 'lostAgain' })],
  [/(?:target opponent|that player) loses life equal to (?:its|~'s) power/, () => ({ k: 'loseLife', n: { dyn: 'selfPower' } })],
  [/(?:you may )?have target opponent lose (\d+) life/, m => ({ k: 'loseLife', n: +m[1] })],
  [/you gain half x life/, () => ({ k: 'gain', n: { dyn: 'halfX' } })],
  [/draw half x cards/, () => ({ k: 'draw', n: { dyn: 'halfX' } })],
  [/prevent all damage that would be dealt this turn by creatures your opponents control/, () => ({ k: 'fog' })],
  // Mass effects with a chosen creature type (the pilot names the type it has most of)
  [/choose a creature type\. creatures that aren't of the chosen type get -(\d+)\/-(\d+) until end of turn/, m => ({ k: 'shrinkAll', p: +m[1], t: +m[2], opp: false, keepType: true })],
  [/choose a creature type\. return all creatures that aren't of the chosen type to their owners' hands/, () => ({ k: 'bounceAll', what: 'creatures', keepType: true })],
  [/choose two target creatures controlled by different players\. return those creatures to their owners' hands/, () => ({ k: 'bounce', what: 'creature', n: 2 })],
  [/return target creature that player controls to its owner's hand/, () => ({ k: 'bounce', what: 'creature' })],
  [/all creatures gain ((?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach)(?:(?:,|,? and) (?:flying|trample|haste|first strike|double strike|lifelink|deathtouch|vigilance|menace|reach))*) until end of turn/, m => ({ k: 'teamPump', p: 0, t: 0, kw: kwList(m[1]) })],
  [/whenever ~ attacks, (?:it|~) gets \+(\d+)\/\+(\d+) until end of turn/, m => ({ k: 'pumpSelf', p: +m[1], t: +m[2], kw: [] })],
  // ---- 1.17.0 second batch
  [/copy target (?:activated or triggered|triggered) ability you control(?: from an enchantment source)?/, () => ({ k: 'copyAbility' })],
  [/creature tokens you control gain indestructible until end of turn/, () => ({ k: 'protect', scope: 'tokens', kw: ['indestructible'] })],
  [/search target opponent's library for a card and exile it face down\. then that player shuffles\. you may play that card for as long as it remains exiled/, () => ({ k: 'grasp' })],
  [/return that card from your graveyard to the battlefield/, () => ({ k: 'reanimate', any: false, types: ['creature'] })],
  [/airbend up to one (?:other )?target creature/, () => ({ k: 'bounce', what: 'creature' })],
  [/create half x (food|treasure|clue) tokens, rounded up/, m => ({ k: 'artifactToken', kind: m[1], n: { dyn: 'halfXup' } })],
  [/target creature can't be blocked by creatures that player controls this turn/, () => ({ k: 'evade', self: false })],
  [/two target creatures you control that share a creature type can't be blocked this turn/, () => ({ k: 'evade', self: false })],
  [/shuffle your library, then exile the top card\. until end of turn, you may play that card without paying its mana cost/, () => ({ k: 'impulse', n: 1, free: true })],
  [/double the number of each kind of counter on (any number of target permanents|(?:up to two )?target [\w ,/]+)/, m => ({ k: 'doubleCounters', on: m[1].startsWith('any') ? 'each creature you control' : 'target creature', all: true })],
  [/regenerate each creature you control/, () => ({ k: 'regen', all: true })],
  [/each non-(\w+) creature gets -x\/-x until end of turn, where x is the number of \1s you control/, m => ({ k: 'shrinkAll', p: { dyn: 'countWhere', what: m[1], where: 'you' }, t: { dyn: 'countWhere', what: m[1], where: 'you' }, opp: false, keepTribe: m[1] })],
  [/each player chooses a creature type\. each player returns all creature cards of a type chosen this way from their graveyard to the battlefield/, () => ({ k: 'massReanimate', what: 'creature', all: true, bestType: true })],
  [/(?:any number of target players|each opponent) each mill cards equal to the number of cards in their graveyard/, () => ({ k: 'mill', who: 'each opponent', n: { dyn: 'theirGy' } })],
  [/enchanted creature deals damage equal to its power to any other target/, () => ({ k: 'damage', n: { dyn: 'attachedPower' }, to: 'any target' })],
  [/create (two|three) tapped tokens that are copies of ~/, m => ({ k: 'copyToken', what: 'artifact', of: '~', n: num(m[1]), tapped: true })],
  [/there is an additional combat phase after this phase followed by an additional main phase/, () => ({ k: 'extraCombat', untap: false })],
  [/(destroy|exile) all non-([\w]+) creatures/, m => ({ k: 'wipe', mode: m[1], what: 'creatures', notTribe: m[2] })],
  [/put an? (deathtouch|flying|lifelink|trample|indestructible|first strike|hexproof|menace|reach|vigilance) counter on each creature you control/, m => ({ k: 'kwCounter', kw: m[1], all: true })],
  [/sacrifice it unless it escaped/, () => ({ k: 'sacUnlessEscaped' })],
  [/you may cast target instant card from your graveyard without paying its mana cost/, () => ({ k: 'gyFreeCast', types: ['instant'] })],
  [/you may put an? ((?:[a-z]+, )*[a-z]+,? or [a-z]+) creature card from your hand onto the battlefield tapped and attacking/, m => ({ k: 'fromHand', what: 'creature', tribes: m[1].split(/,? or |, /), attacking: true })],
  [/create a number of (?:tapped )?(\d+)\/(\d+) ([\w ]*?) ?creature tokens equal to ~'s power/, m => ({ k: 'token', n: { dyn: 'selfPower' }, p: +m[1], t: +m[2], desc: m[3], kw: [] })],
  [/double the power of each ([a-z]+) you control until end of turn/, m => ({ k: 'doublePT', all: true, what: singular(m[1]), powerOnly: true })],
  [/return (?:up to one )?target ([\w ]*?)card with mana value less than or equal to ~'s power from your graveyard to the battlefield/, m => ({ k: 'reanimate', any: false, types: typeWords(m[1]), maxMvPower: true })],
  [/you may cast your commander from the command zone without paying its mana cost/, () => ({ k: 'castCommanderFree' })],
  [/that player gets (a|an|one|two|three|\d+) poison counters?/, m => ({ k: 'poison', who: 'that player', n: num(m[1]) })],
  [/~ deals damage equal to its power to that player/, () => ({ k: 'damage', n: { dyn: 'selfPower' }, to: 'that player' })],
  [/double its power until end of turn/, () => ({ k: 'doublePT', all: false, trig: true })],
  [/double ~'s power until end of turn/, () => ({ k: 'doublePT', all: false, self: true })],
  [/put that many \+1\/\+1 counters on (target [\w ]+?|each creature you control)(?=[.,]|$)/, m => ({ k: 'counters', n: { dyn: 'trigN' }, on: m[1].startsWith('each') ? 'each creature you control' : 'target creature' })],
  [/untap all creatures(?=[.,]|$)/, () => ({ k: 'untapAll', what: 'creatures' })],
  [/for each attacking creature, its owner puts it on their choice of the top or bottom of their library/, () => ({ k: 'bounceAll', what: 'attacking', toLibrary: true })],
  [/return each creature without a \+1\/\+1 counter on it to its owner's hand/, () => ({ k: 'bounceAll', what: 'creatures', noCounters: true })],
  [/(?:you may )?put that card (?:from a graveyard )?onto the battlefield under your control/, () => ({ k: 'reanimateTrig' })],
  // ---- 1.17.0 third batch
  [/~ becomes a copy of (?:another )?target ([\w ,]+?)( card in your graveyard| you control)?(?:,? except [^.]*?)?( until end of turn)?(?=\.|$)/, m => (/mana value x/.test(m[0]) ? null : { k: 'becomeCopy', what: m[1].replace(/,? or |, /g, ' or '), gy: /graveyard/.test(m[2] || ''), own: /you control/.test(m[2] || ''), eot: !!m[3], keep: /this ability/.test(m[0]) })],
  [/have ~ become a copy of (another target creature you control|it|any creature on the battlefield) until end of turn/, m => ({ k: 'becomeCopy', what: 'creature', own: m[1].startsWith('another'), trig: m[1] === 'it', eot: true, haste: false })],
  [/shuffle your library, then exile the top card\./, () => ({ k: 'impulse', n: 1, free: true })],
  [/(?:^|[.,] )copy it(?=[.,]|$)/, () => ({ k: 'copyTrig' })],
  [/\bdiscover x\b/, () => ({ k: 'cascade', n: { dyn: 'trigMV' }, discover: true })],
  [/~ gains (trample|flying|haste|menace) and gets \+x\/\+x/, m => ({ k: 'pumpSelf', p: 'X', t: 'X', kw: [m[1]] })],
  [/(?:it|that spell) gains rebound/, () => ({ k: 'grantRebound' })],
  [/return that card to its owner's hand at the beginning of the next end step/, () => ({ k: 'returnTrigHand', later: true })],
  [/return it to your hand unless target opponent pays (\d+) life/, m => ({ k: 'returnTrigHand', unlessLife: +m[1] })],
  [/until end of turn, (?:creatures you control|each ([a-z]+) creature you control) ha(?:ve|s) base power and toughness (x|\d+)\/(x|\d+)/, m => ({ k: 'teamBase', p: num(m[2]), t: num(m[3]), what: m[1] || null })],
  [/(?:creatures you control|each ([a-z]+) creature you control) ha(?:ve|s) base power and toughness (x|\d+)\/(x|\d+)[^.]*? until end of turn/, m => ({ k: 'teamBase', p: num(m[2]), t: num(m[3]), what: m[1] || null })],
  [/each noncreature artifact you control becomes a (\d+)\/(\d+) artifact creature until end of turn/, m => ({ k: 'animateAll', p: +m[1], t: +m[2] })],
  [/(?:it|~) deals damage to defending player equal to the number of (\w+)s they control/, m => ({ k: 'damage', n: { dyn: 'defCount', what: m[1] }, to: 'defender' })],
  [/~ deals damage equal to that spell's mana value to (target opponent|each opponent)/, m => ({ k: 'damage', n: { dyn: 'trigMV' }, to: m[1] })],
  [/for each aura and equipment you control, you may attach it to a creature you control/, () => ({ k: 'moveEquip', all: true })],
];


// Costs of activated abilities and additional costs of spells (601.2f–h, 602.2): mana, {T}, life,
// discards, sacrifices, exiling from the graveyard, tapping other permanents, removing counters,
// returning a permanent to hand. Returns null when some part of the cost isn't understood.
const COSTN = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|x|\\d+)';
export function parseCostText(s) {
  const c = { mana: '', tap: false, life: 0, discard: null, discardHand: false, sacSelf: false, sac: null, exileSelf: false, exileGy: 0, tapOthers: null, removeCounters: 0, bounce: null };
  let m;
  for (let part of s.split(/,\s*(?![^{]*\})/).map(x => x.trim()).filter(Boolean)) {
    part = part.replace(/^and /, '');
    if (/^(\{[^}]+\})+$/.test(part)) {
      for (const [sym] of part.matchAll(/\{[^}]+\}/g)) { if (sym === '{t}') c.tap = true; else if (sym === '{q}') c.untapSelf = true; else c.mana += sym.toUpperCase(); }
    } else if ((m = part.match(/^pay (\d+) life$/))) c.life += +m[1];
    // "Pay life equal to …" / "pay X life": counted as a few life
    else if (/^pay (?:x life|life equal to .+)$/.test(part)) c.life += 3;
    else if (/^return ~ to its owner's hand$/.test(part)) c.bounceSelf = true;
    else if (part === 'discard your hand') c.discardHand = true;
    else if ((m = part.match(new RegExp(`^discard ${COSTN} ?([\\w ]*?)cards?(?: at random)?$`)))) c.discard = { n: num(m[1]) === 'X' ? 1 : num(m[1]), types: typeWords(m[2]) };
    else if (/^(sacrifice|exile) ~$/.test(part)) { if (part.startsWith('sac')) c.sacSelf = true; else c.exileSelf = true; }
    else if ((m = part.match(new RegExp(`^sacrifice (another |${COSTN} (?:other |untapped )?)([\\w -]+?)s?$`)))) c.sac = { n: m[1].trim() === 'another' ? 1 : num(m[2] || 'a'), what: m[3].replace(/ you control$/, '').trim(), other: /another|other/.test(m[1]) };
    else if ((m = part.match(new RegExp(`^exile ${COSTN} (?:other )?([\\w ]*?)cards? from your graveyard$`)))) c.exileGy = num(m[1]) === 'X' ? 1 : num(m[1]);
    else if ((m = part.match(new RegExp(`^tap ${COSTN} (?:other )?untapped ([\\w -]+?)s? you control$`)))) c.tapOthers = { n: num(m[1]) === 'X' ? 1 : num(m[1]), what: m[2].trim() };
    else if ((m = part.match(new RegExp(`^remove ${COSTN} ([+\\-\\d/]+ |\\w+ )?counters? from ~$`)))) c.removeCounters = num(m[1]) === 'X' ? 1 : num(m[1]);
    else if ((m = part.match(/^return (?:a|an) ([\w ]+?) you control to its owner's hand$/))) c.bounce = { what: m[1] };
    // ---- 1.6.0 costs
    else if ((m = part.match(new RegExp(`^mill ${COSTN} cards?$`)))) c.mill = num(m[1]) === 'X' ? 1 : num(m[1]);
    else if ((m = part.match(new RegExp(`^untap ${COSTN} tapped ([\\w ]+?)s? you control$`)))) c.untapOthers = { n: num(m[1]), what: m[2] };
    else if (part === 'exert ~') c.exert = true;
    else if (part === 'unattach ~') c.unattach = true;
    else if (/^put a -1\/-1 counter on ~$/.test(part)) c.minusSelf = 1;
    else if ((m = part.match(/^exile (?:a|an|another) ([\w ]+?) you control$/))) c.exileOwn = { what: m[1] };
    else if ((m = part.match(new RegExp(`^remove ${COSTN} (?:[+\\-\\d/]+ |\\w+ )?counters? from (?:among )?(?:a |an )?(?:other )?([\\w ,]+?)(?: you control)?$`)))) c.removeAny = num(m[1]) === 'X' ? 1 : num(m[1]);
    else if (part === 'forage') c.forage = true;
    else if (/^tap another untapped creature you control$/.test(part)) c.tapOthers = { n: 1, what: 'creature' };
    else if ((m = part.match(/^sacrifice ~ and (?:a|an) ([\w ]+)$/))) { c.sacSelf = true; c.sac = { n: 1, what: m[1], other: true }; }
    else if ((m = part.match(new RegExp(`^sacrifice ${COSTN} (other )?(\\w+)s? and\\/or (\\w+?)s?$`)))) c.sac = { n: num(m[1]) === 'X' ? 1 : num(m[1]), what: `${m[3]} or ${m[4]}`, other: !!m[2] };
    else if ((m = part.match(new RegExp(`^sacrifice ${COSTN} (\\w+)s? or (\\w+?)s?$`)))) c.sac = { n: num(m[1]) === 'X' ? 1 : num(m[1]), what: `${m[2]} or ${m[3]}`, other: false };
    else if ((m = part.match(/^pay (\w+) \{e\}$|^pay (?:\{e\})+$/))) c.energy = m[1] ? (num(m[1]) === 'X' ? 1 : num(m[1])) : (part.match(/\{e\}/g) || []).length;
    else if ((m = part.match(/^discard (?:a|an) ([\w ]*?)card with mana value x$/))) c.discard = { n: 1, types: typeWords(m[1]) };
    else return null;
  }
  return c;
}
export function costText(c) {
  if (!c) return '';
  return [c.mana, c.tap && '{T}', c.life && `pay ${c.life} life`, c.discardHand && 'discard your hand', c.discard && `discard ${c.discard.n} ${c.discard.types.join('/') || ''} card${c.discard.n > 1 ? 's' : ''}`.replace('  ', ' '),
    c.sacSelf && 'sacrifice it', c.exileSelf && 'exile it', c.sac && `sacrifice ${c.sac.n > 1 ? c.sac.n + ' ' : c.sac.other ? 'another ' : /^[aeiou]/.test(c.sac.what) ? 'an ' : 'a '}${c.sac.what}`,
    c.exileGy && `exile ${c.exileGy} from graveyard`, c.tapOthers && `tap ${c.tapOthers.n} untapped ${c.tapOthers.what}`, c.removeCounters && `remove ${c.removeCounters} counter${c.removeCounters > 1 ? 's' : ''}`,
    c.bounce && `return a ${c.bounce.what}`, c.mill && `mill ${c.mill}`, c.untapOthers && `untap ${c.untapOthers.n} tapped ${c.untapOthers.what}`, c.exert && 'exert it',
    c.minusSelf && 'put a -1/-1 counter on it', c.exileOwn && `exile a ${c.exileOwn.what}`, c.removeAny && `remove ${c.removeAny} counter${c.removeAny > 1 ? 's' : ''} from among your permanents`,
    c.forage && 'forage', c.energy && `pay ${c.energy} energy`].filter(Boolean).join(', ');
}

// Lines that are only keywords the simulator treats as plain text with no rules effect here
const reminderOnly = l => /^(?:enchant [\w ,]+|fuse|splice onto arcane .*|equip(?: [\w ]+)? \{[^}]+\}(?:\{[^}]+\})*|(?:flying|vigilance|reach|haste|trample|lifelink|deathtouch|menace|first strike|double strike|defender|hexproof|indestructible|flash|shroud)(?:, [\w ]+)*)\.?$/.test(l);

// Card types named in a phrase ("creature or artifact card" → ['creature', 'artifact'])
const TYPES = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land'];
function typeWords(s) {
  const w = s || '';
  const out = TYPES.filter(t => new RegExp(`\\b${t}\\b`).test(w));
  if (/\bpermanent\b/.test(w) && !out.length) return /nonland/.test(w) ? ['creature', 'artifact', 'enchantment', 'planeswalker'] : ['creature', 'artifact', 'enchantment', 'planeswalker', 'land'];
  return out;
}

// "Look at the top N cards of your library. Put one of them into your hand and the rest on the bottom"
function digEffect(m) {
  const n = num(m[1]);
  const rest = m[2] || '';
  if (!/into your hand|onto the battlefield/.test(rest)) return null;
  const all = /put (?:all|each|those) [^.]*?(?:revealed this way |cards? )?into your hand/.test(rest) && !/(?:one|two|a|an) of (?:them|those)/.test(rest);
  const takeM = rest.match(/put (one|two|three|a|an|up to (\w+)|any number)(?: of (?:them|those cards))?/);
  const take = all ? 99 : !takeM ? 1 : takeM[1] === 'any number' ? 99 : takeM[2] ? num(takeM[2]) : num(takeM[1]);
  const typeM = rest.match(/(?:put|reveal) (?:a|an|up to \w+|all|any number of) ([\w ]*?)cards? (?:revealed this way |from among (?:them|those cards) )?(?:into your hand|onto the battlefield)/);
  return { k: 'dig', n, take, types: typeM ? typeWords(typeM[1]) : [], bf: /onto the battlefield/.test(rest), gy: /(?:rest|other|others) into your graveyard/.test(rest) };
}

// Conditions: "if you control an artifact", "threshold" and friends. Unknown ones are kept as text.
const COUNTW = '(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\\d+)';
export function parseCond(s) {
  let m;
  s = s.trim().replace(/\.$/, '');
  if (/^(?:~ was kicked|it was kicked|~'s kicker was paid|~ was bargained|it was bargained)/.test(s)) return { c: 'kicked' };
  // Gifts are never promised by the pilots (the opponent would get the gift)
  if (/^the gift was promised/.test(s)) return { c: 'gift' };
  if (/^you control a commander as you cast ~|^you control your commander/.test(s)) return { c: 'commander' };
  if ((m = s.match(new RegExp(`^${COUNTW} or more cards are in your graveyard|^there are ${COUNTW} or more cards in your graveyard`)))) return { c: 'gy', n: num(m[1] || m[2]) };
  if ((m = s.match(new RegExp(`^there are ${COUNTW} or more card types among cards in your graveyard`)))) return { c: 'gyTypes', n: num(m[1]) };
  if ((m = s.match(new RegExp(`^there are ${COUNTW} or more ([\\w /]+?) cards in your graveyard`)))) return { c: 'gyType', n: num(m[1]), types: typeWords(m[2]) };
  if (/^(?:a|another) creature died this turn/.test(s)) return { c: 'died' };
  if (/^you attacked (?:with a creature )?this turn/.test(s)) return { c: 'attacked' };
  if (/^you have no cards in hand/.test(s)) return { c: 'handEmpty' };
  if ((m = s.match(/^you control a creature with power (\d+) or greater/))) return { c: 'power', n: +m[1] };
  if (/^a permanent you controlled left the battlefield this turn/.test(s)) return { c: 'revolt' };
  if (/^you control three or more creatures with different powers/.test(s)) return { c: 'coven' };
  if ((m = s.match(/^creatures you control have total power (\d+) or greater/))) return { c: 'totalPower', n: +m[1] };
  if ((m = s.match(new RegExp(`^an opponent has ${COUNTW} or more poison counters`)))) return { c: 'poison', n: num(m[1]) };
  if ((m = s.match(/^you have (\d+) or less life|^your life total is (\d+) or less/))) return { c: 'lifeLE', n: +(m[1] || m[2]) };
  if (/^you have less life than (?:half your starting life total|your starting life total)/.test(s)) return { c: 'lifeLE', n: /half/.test(s) ? 19 : 39 };
  if ((m = s.match(/^you have (\d+) or more life|^your life total is (\d+) or greater/))) return { c: 'lifeGE', n: +(m[1] || m[2]) };
  if (/^you have at least (\d+) life more than your starting life total/.test(s)) return { c: 'lifeGE', n: 40 + +s.match(/(\d+)/)[1] };
  if (/^you control (?:a|your) commander/.test(s)) return { c: 'commander' };
  if (/^you have the city's blessing/.test(s)) return { c: 'blessing' };
  // Thassa's Oracle: X (devotion to blue) at least the cards left in the library
  if ((m = s.match(/^x is greater than or equal to the number of cards in your library/))) return { c: 'oracle' };
  if ((m = s.match(new RegExp(`^~ has ${COUNTW} or more (\\w+) counters on it`)))) return { c: 'named', n: num(m[1]), kind: m[2] };
  if ((m = s.match(/^~ is attacking/))) return { c: 'selfAttacking' };
  if ((m = s.match(/^~ is untapped/))) return { c: 'selfUntapped' };
  if ((m = s.match(/^~ is tapped/))) return { c: 'selfUntapped', neg: true };
  if ((m = s.match(/^you control (?:an?|another) (\w+) or (?:an? )?(\w+)$/))) return { c: 'controlAny', what: [m[1], m[2]] };
  if ((m = s.match(/^you control (\w+) or more artifacts/))) return { c: 'control', n: num(m[1]), what: 'artifact' };
  if ((m = s.match(/^an opponent controls more (lands|creatures|artifacts) than you/))) return { c: 'oppMore', what: m[1].slice(0, -1) };
  if (/^it'?s your turn/.test(s)) return { c: 'myTurn' };
  if (/^it'?s not your turn/.test(s)) return { c: 'myTurn', neg: true };
  if (/^you gained life this turn/.test(s)) return { c: 'gainedLife' };
  if (/^you(?:'ve| have) cast (?:another|two or more) spells? this turn/.test(s)) return { c: 'castOther' };
  if ((m = s.match(/^x is (\d+) or (?:more|greater)/))) return { c: 'x', n: +m[1] };
  if (/^an opponent lost life this turn/.test(s)) return { c: 'oppLostLife' };
  if ((m = s.match(new RegExp(`^there are ${COUNTW}(?: or more)? creatures on the battlefield|^there are (thirteen|twelve|ten|eight) or more creatures on the battlefield`)))) return { c: 'bfCreatures', n: num(m[1] || m[2]) };
  if (/^you cast it from your hand/.test(s)) return { c: 'castFromHand' };
  if (/^you're the monarch|^you are the monarch/.test(s)) return { c: 'monarch' };
  if ((m = s.match(new RegExp(`^you control ${COUNTW}(?: or more)? (?:other )?([\\w -]+?)s?$`))) || (m = s.match(/^you control (an?|another) ([\w -]+?)$/))) {
    const what = m[2].replace(/ (?:card|permanent)$/, '').trim();
    return { c: 'control', n: m[1] === 'another' ? 1 : num(m[1]), what: what.replace(/s$/, ''), other: /other|another/.test(s) };
  }
  return { c: '?', text: s };
}
const COND_TEXT = {
  kicked: () => 'kicked', gy: c => `${c.n}+ cards in graveyard`, gyTypes: c => `${c.n}+ card types in graveyard`, gyType: c => `${c.n}+ ${c.types.join('/')} cards in graveyard`,
  died: () => 'a creature died this turn', attacked: () => 'you attacked this turn', handEmpty: () => 'no cards in hand', power: c => `you control power ${c.n}+`,
  revolt: () => 'a permanent of yours left', coven: () => 'three different powers', totalPower: c => `total power ${c.n}+`, poison: c => `an opponent has ${c.n}+ poison`,
  lifeLE: c => `life ${c.n} or less`, lifeGE: c => `life ${c.n} or more`, commander: () => 'you control your commander', oppMore: c => `an opponent has more ${c.what}s`,
  myTurn: c => (c.neg ? "not your turn" : 'your turn'), gainedLife: () => 'you gained life this turn', castOther: () => 'you cast another spell this turn',
  named: c => `${c.n}+ ${c.kind} counters`, selfAttacking: () => "it's attacking", selfUntapped: c => (c.neg ? "it's tapped" : "it's untapped"), controlAny: c => `you control a ${c.what.join(' or ')}`,
  x: c => `X ≥ ${c.n}`, blessing: () => "you have the city's blessing", oracle: () => 'devotion to blue ≥ cards in library', oppLostLife: () => 'an opponent lost life this turn', monarch: () => "you're the monarch", control: c => `you control ${c.n > 1 ? c.n + '+ ' : 'a '}${c.what}`,
  '?': c => c.text, gift: () => 'the gift was promised',
};
export const condText = c => (COND_TEXT[c.c] || (() => c.c))(c);

// Triggered abilities beyond the classic ones: "whenever you gain life", "whenever equipped creature
// attacks", "at the beginning of each upkeep"… The engine fires these events and queues the matches.
const WATCHERS = [
  [/^whenever ~ blocks or becomes blocked,? (.*)/, () => [{ ev: 'block', self: true }, { ev: 'blocked', self: true }]],
  [/^whenever ~ blocks(?: a creature)?,? (.*)/, () => [{ ev: 'block', self: true }]],
  [/^whenever ~ becomes blocked(?: by a creature)?,? (.*)/, () => [{ ev: 'blocked', self: true }]],
  [/^whenever ~ is dealt damage,? (.*)/, () => [{ ev: 'damaged', self: true }]],
  [/^(?:when|whenever) ~ leaves the battlefield,? (.*)/, () => [{ ev: 'ltb', self: true }]],
  [/^whenever ~ deals combat damage(?: to a creature)?, (.*)/, () => [{ ev: 'selfCombat', self: true }]],
  [/^whenever ~ becomes the target of a spell or ability(?: an opponent controls)?,? (.*)/, () => [{ ev: 'targeted', self: true }]],
  [/^whenever you cast a spell that targets ~,? (.*)/, () => [{ ev: 'heroic', self: true }]],
  [/^whenever (?:equipped|enchanted) creature attacks,? (.*)/, () => [{ ev: 'attachedAttacks' }]],
  [/^whenever (?:equipped|enchanted) creature deals (?:combat )?damage(?: to a player| to an opponent)?,? (.*)/, () => [{ ev: 'attachedDamage' }]],
  [/^whenever (?:equipped|enchanted) creature dies,? (.*)/, () => [{ ev: 'attachedDies' }]],
  [/^whenever ~ and at least (one|two|three) other creatures attack,? (.*)/, m => [{ ev: 'youAttack', min: num(m[1]) + 1, selfAttacking: true }]],
  [/^whenever (a|another) (nontoken )?creature you control attacks,? (.*)/, m => [{ ev: 'allyAttacks', other: m[1] === 'another' }]],
  [/^whenever (?:you attack|one or more creatures you control attack)(?: with one or more creatures)?,? (.*)/, () => [{ ev: 'youAttack' }]],
  [/^whenever (a|another|one or more) (?:other )?creatures? you control deals? combat damage to (?:a player|an opponent|one or more players),? (.*)/, m => [{ ev: 'allyCombat', other: m[1] === 'another' }]],
  [/^whenever (you|a player|an opponent|another player) gains? life,? (.*)/, m => [{ ev: 'gainLife', who: whoOf(m[1]) }]],
  [/^whenever (you|a player|an opponent|another player) loses? life,? (.*)/, m => [{ ev: 'loseLife', who: whoOf(m[1]) }]],
  [/^whenever (you|a player|an opponent|another player) draws? (?:a|their first) card,? (.*)/, m => [{ ev: 'draw', who: whoOf(m[1]) }]],
  [/^whenever (you|a player|an opponent) sacrifices? (?:a|an|another|one or more) (creature|artifact|permanent|food|clue|treasure|land|nontoken creature|token)s?,? (.*)/, m => [{ ev: 'sac', who: whoOf(m[1]), what: m[2] }]],
  [/^whenever (you|a player|an opponent) discards? (?:a|an|one or more) ([\w, ]*?)cards?,? (.*)/, m => [{ ev: 'discard', who: whoOf(m[1]), what: /noncreature, nonland/.test(m[2]) ? 'spell' : typeWords(m[2])[0] || null }]],
  [/^whenever you cycle(?: or discard)? (?:a|another) card,? (.*)/, () => [{ ev: 'discard', who: 'you' }]],
  [/^whenever you create (?:a|one or more) (?:creature )?tokens?,? (.*)/, () => [{ ev: 'tokenMade', who: 'you' }]],
  [/^whenever a player casts (?:a|an) ([\w ]*?)spell,? (.*)/, m => [{ ev: 'anyCast', what: m[1].trim() || 'any' }]],
  [/^at the beginning of each opponent's upkeep,? (.*)/, () => [{ ev: 'upkeep', whose: 'opp' }]],
  [/^at the beginning of (?:each|each player's) upkeep,? (.*)/, () => [{ ev: 'upkeep', whose: 'any' }]],
  [/^at the beginning of (?:each )?combat on your turn,? (.*)/, () => [{ ev: 'begCombat', whose: 'you' }]],
  [/^at the beginning of each combat,? (.*)/, () => [{ ev: 'begCombat', whose: 'any' }]],
  [/^at the beginning of your (?:precombat |first )?main phase,? (.*)/, () => [{ ev: 'main1', whose: 'you' }]],
  [/^at the beginning of your draw step,? (.*)/, () => [{ ev: 'drawStep', whose: 'you' }]],
  [/^at the beginning of each (?:player's|opponent's) draw step,? (.*)/, m => [{ ev: 'drawStep', whose: /opponent/.test(m[0]) ? 'opp' : 'any' }]],
  [/^whenever you create or sacrifice a token,? (.*)/, () => [{ ev: 'tokenMade', who: 'you' }, { ev: 'sac', who: 'you', what: 'token' }]],
  [/^whenever a land you control is put into a graveyard from the battlefield,? (.*)/, () => [{ ev: 'sac', who: 'you', what: 'land' }]],
  [/^whenever (?:a commander you control|your commander) deals combat damage to (?:a player|an opponent),? (.*)/, () => [{ ev: 'allyCombat', commander: true }]],
  [/^at the beginning of each opponent's end step,? (.*)/, () => [{ ev: 'endStep', whose: 'opp' }]],
  [/^at the beginning of (?:each|each player's|the) end step,? (.*)/, () => [{ ev: 'endStep', whose: 'any' }]],
  // ---- 1.6.0 triggers from the card scan
  // Combat damage and attacks by some of your creatures ("a dinosaur", "one or more artifact creatures", "a creature token", "a modified creature")
  [/^whenever (a|an|another|one or more) (other )?(.+?) you control((?:,? each)? with(?:out)? [^,]+?| that [^,]+?)? deals? (?:combat )?damage to (?:a player|an opponent|one or more players|one of your opponents|your opponents|an opponent or a planeswalker),? (.*)/,
    m => [{ ev: 'allyCombat', other: m[1] === 'another' || !!m[2], what: descOf(m[3]), with: m[4]?.trim() || null, once: m[1] === 'one or more' }]],
  [/^whenever (a|an|another) (other )?(.+?) you control((?:,? each)? with(?:out)? [^,]+?)? attacks,? (.*)/, m => [{ ev: 'allyAttacks', other: m[1] === 'another' || !!m[2], what: descOf(m[3]), with: m[4]?.trim() || null }]],
  [/^whenever one or more (?:other )?(.+?) you control((?:,? each)? with(?:out)? [^,]+?)? attack(?: a player| one or more players| an opponent)?,? (.*)/, m => [{ ev: 'youAttack', what: descOf(m[1]), with: m[2]?.trim() || null }]],
  [/^whenever (a player|an opponent|another player) attacks with (\w+) or more creatures,? (.*)/, m => [{ ev: 'youAttack', who: whoOf(m[1]), min: num(m[2]) }]],
  [/^whenever an opponent attacks (you|you and\/or (?:one or more )?planeswalkers you control|you or a planeswalker you control|you and\/or planeswalkers you control|with creatures|with one or more creatures)(?: with (\w+) or more creatures)?,? (?:if [^,]+, )?(.*)/, m => [{ ev: 'youAttack', who: 'opp', atMe: m[1].startsWith('you'), min: m[2] ? num(m[2]) : 0 }]],
  [/^whenever a creature (?:an opponent controls )?attacks you(?: or a planeswalker you control)?,? (.*)/, () => [{ ev: 'allyAttacks', who: 'opp', atMe: true }]],
  [/^whenever a creature an opponent controls attacks,? (?:if you're the defending player, )?(.*)/, m => [{ ev: 'allyAttacks', who: 'opp', atMe: /defending/.test(m[0]) }]],
  // Second draws and second spells each turn
  [/^whenever (you|a player|an opponent) draws? (?:your|their) second card (?:each turn|during (?:their|your) turn),? (.*)/, m => [{ ev: 'draw', who: whoOf(m[1]), nth: 2, ownTurn: /during/.test(m[0]) }]],
  [/^whenever (you|a player|an opponent|another player) casts? (?:your|their) second spell (?:each turn|during (?:their|your) turn),? (.*)/, m => [{ ev: 'anyCast', what: 'any', who: whoOf(m[1]), nth: 2, ownTurn: /during/.test(m[0]) }]],
  [/^whenever (an opponent|another player) casts a spell from anywhere other than their hand,? (.*)/, () => [{ ev: 'anyCast', what: 'any', who: 'opp', notHand: true }]],
  [/^whenever (an opponent|another player) casts (?:a|an) ([\w ]*?)spell,? (.*)/, m => [{ ev: 'anyCast', what: m[2].trim() || 'any', who: 'opp' }]],
  // Counters
  [/^whenever (?:one or more \+1\/\+1 counters are|a \+1\/\+1 counter is|one or more counters are|you put one or more (?:\+1\/\+1 )?counters) (?:put )?on ~,? (.*)/, () => [{ ev: 'counterPut', self: true, once: true }]],
  [/^whenever (?:one or more \+1\/\+1 counters are put|you put one or more (?:\+1\/\+1 )?counters) on (?:a|another) (?:creature|permanent)( you control| you don't control)?(?: or player)?,? (.*)/, m => [{ ev: 'counterPut', ctl: m[1] === " you don't control" ? 'opp' : 'you', once: true }]],
  // Graveyards
  [/^whenever one or more (?:(creature|land|other) )?cards? leaves? your graveyard,? (.*)/, m => [{ ev: 'gyLeave', what: m[1] && m[1] !== 'other' ? m[1] : null, once: true }]],
  [/^whenever one or more cards are put into exile from your library and\/or your graveyard,? (.*)/, () => [{ ev: 'gyLeave', once: true }]],
  [/^whenever one or more (land )?cards are put into your graveyard from anywhere(?: for the first time each turn)?,? (.*)/, m => [{ ev: 'toGy', who: 'you', what: m[1] ? 'land' : null, once: true }]],
  [/^whenever (?:a|another) (?:nontoken )?(creature|artifact|land|card|creature card) is put into (your|an opponent's|a) graveyard from (?:anywhere|the battlefield),? (.*)/, m => [{ ev: 'toGy', who: m[2] === 'your' ? 'you' : m[2] === 'a' ? 'any' : 'opp', what: m[1] === 'card' ? null : m[1].replace(' card', ''), fromBf: /battlefield/.test(m[0]) }]],
  [/^when(?:ever)? ~ is put into (?:a|your) graveyard from (?:the battlefield|anywhere),? (.*)/, () => [{ ev: 'selfGy', self: true }]],
  [/^when(?:ever)? enchanted (?:creature|permanent) dies(?: or is put into exile)?,? (.*)/, () => [{ ev: 'attachedDies' }]],
  [/^when you cycle ~(?: or discard it)?,? (.*)/, () => [{ ev: 'cycled', self: true }]],
  // Searching, land drops, tapping and untapping
  [/^whenever (an opponent|a player) searches (?:their|a) library,? (.*)/, m => [{ ev: 'search', who: whoOf(m[1]) }]],
  [/^whenever (you|a player|an opponent|another player) plays? a land,? (.*)/, m => [{ ev: 'landPlay', who: whoOf(m[1]) }]],
  [/^whenever you play a land or cast a spell,? (.*)/, () => [{ ev: 'landPlay', who: 'you' }, { ev: 'anyCast', what: 'any', who: 'you' }]],
  [/^whenever (~|a creature you control|an? ([\w-]+) you control) becomes tapped,? (.*)/, m => [m[1] === '~' ? { ev: 'tapped', self: true } : { ev: 'tapped', what: m[2] || 'creature' }]],
  [/^whenever you tap ~ for mana,? (.*)/, () => [{ ev: 'tapped', self: true }]],
  [/^whenever ~ becomes untapped,? (.*)/, () => [{ ev: 'untapped', self: true }]],
  // Damage
  [/^whenever (?:a|an) ([\w-]+) you control is dealt damage,? (.*)/, m => [{ ev: 'damaged', what: m[1], ctl: 'you' }]],
  [/^whenever (?:enchanted|equipped) creature is dealt damage,? (.*)/, () => [{ ev: 'damaged', attached: true }]],
  [/^whenever a source you control deals noncombat damage to an opponent,? (.*)/, () => [{ ev: 'noncombat' }]],
  [/^whenever (?:a|an) ([\w-]+) you control becomes the target of a spell(?: or ability)?( an opponent controls)?,? (.*)/, m => [{ ev: 'targeted', what: m[1], ctl: 'you', byOpp: !!m[2] }]],
  // Crimes (targeting an opponent or what they control), the Ring, proliferate, main phases, class levels
  [/^whenever (you|an opponent) commits? a crime,? (.*)/, m => [{ ev: 'crime', who: whoOf(m[1]) }]],
  [/^whenever (?:the ring tempts you|you choose a creature as your ring-bearer),? (.*)/, () => [{ ev: 'ring', who: 'you' }]],
  [/^whenever you proliferate,? (.*)/, () => [{ ev: 'proliferate', who: 'you' }]],
  [/^at the beginning of (?:each of )?your (?:postcombat|second) main phases?,? (.*)/, () => [{ ev: 'main2' }]],
  [/^at the beginning of each of your main phases,? (.*)/, () => [{ ev: 'main1' }, { ev: 'main2' }]],
  [/^at the beginning of enchanted (?:player's|opponent's) (upkeep|end step),? (.*)/, m => [{ ev: m[1] === 'upkeep' ? 'upkeep' : 'endStep', whose: 'opp' }]],
  [/^when(?:ever)? ~ becomes level (\d+),? (.*)/, m => [{ ev: 'level', self: true, n: +m[1] }]],
];
const whoOf = s => (s === 'you' ? 'you' : s === 'a player' ? 'any' : 'opp');
// "artifact creatures" → "artifact", "non-human creatures" → "non-human", "ninja or rogue creatures" → "ninja or rogue"
function descOf(s) {
  return s.replace(/ and\/or /g, ' or ').split(/ or |, /).map(alt => alt.replace(/\b(?:creatures?)\b/g, '').replace(/\s+/g, ' ').trim().replace(/s$/, '') || 'creature').join(' or ');
}
// "Whenever a creature or artifact you control leaves the battlefield / is put into a graveyard from the battlefield / is exiled"
const LEAVE_RE = /^whenever (a|an|another|one or more)( other)? (nontoken )?([\w ,-]+?)s? (you control |an opponent controls |you don't control )?(?:is put into a graveyard from the battlefield|are put into a graveyard from the battlefield|leaves? the battlefield|(?:is|are) exiled from the battlefield)( without dying)?,? (.*)/;
// "Whenever another creature you control enters", "whenever a creature an opponent controls enters", tribal ("an elf")
const ENTER_RE = /^whenever (a|an|another|~ or another|one or more(?: other)?) (nontoken )?([\w -]+?)s?(?: tokens?)? (you control |an opponent controls |your opponents control )?(?:enters?|enter)(?: the battlefield)?(?: under (your|an opponent's) control)?,? (.*)/;

// Keyword abilities written on their own line ("cycling {2}", "afterlife 1", "ward {2}"), returns true if the line was all keywords
function keywordLine(line, fx) {
  let m;
  // "Flashback—{1}{U}, Pay 3 life." / "Flashback—Sacrifice three creatures." (any cost the cost reader knows)
  if ((m = line.match(/^flashback—(.+?)\.?$/))) {
    const c = parseCostText(m[1].replace(/^sacrifice (\w+) creatures$/, 'sacrifice $1 creatures'));
    if (c) { fx.flashback = c.mana || '{0}'; fx.flashbackCosts = c; fx.kw.add('flashback'); return true; }
  }
  if ((m = line.match(/^escape—((?:\{[^}]+\})+), exile (\w+) other cards? from your graveyard/))) { fx.escape = { cost: m[1].toUpperCase(), n: num(m[2]) }; return true; }
  if ((m = line.match(/^channel — ((?:\{[^}]+\})+), discard ~: (.*)/))) { fx.channel = { cost: m[1].toUpperCase(), effects: parseEffects(m[2]) }; return true; }
  if ((m = line.match(/^cumulative upkeep(?:—| )(?:pay (\d+) life|((?:\{[^}]+\})+))/))) { fx.cumulative = m[1] ? { life: +m[1] } : { cost: m[2].toUpperCase() }; return true; }
  if ((m = line.match(/^ward(?:—| )pay (\d+) life/))) { fx.wardLife = +m[1]; fx.kw.add('ward'); return true; }
  const segs = line.replace(/\.$/, '').split(/,\s*(?![^{]*\})/).map(s => s.trim());
  let all = true;
  for (const s of segs) {
    if ((m = s.match(/^(annihilator|toxic|afflict|bushido|rampage|afterlife|modular|fabricate|backup|bloodthirst|vanishing|fading|crew|poisonous|absorb) (\d+|x)$/))) {
      const n = m[2] === 'x' ? 1 : +m[2];
      fx.kwN[m[1]] = n;
      fx.kw.add(m[1]);
      if (m[1] === 'afterlife') fx.dies.push({ k: 'token', n, p: 1, t: 1, desc: 'white black spirit', kw: ['flying'] });
      if (m[1] === 'fabricate') fx.etb.push({ k: 'counters', n, on: '~' });
      if (m[1] === 'backup') fx.etb.push({ k: 'counters', n, on: 'target creature you control' });
      if (m[1] === 'modular') { fx.entersCounters = (+fx.entersCounters || 0) + n; fx.dies.push({ k: 'modular' }); }
      if (m[1] === 'crew') fx.crew = n;
      continue;
    }
    if ((m = s.match(/^(kicker|multikicker|buyback|unearth|embalm|eternalize|dash|blitz|spectacle|echo|ninjutsu|outlast|flashback|evoke|reconfigure) ((?:\{[^}]+\})+)$/))) {
      const cost = m[2].toUpperCase();
      fx.kw.add(m[1]);
      if (m[1] === 'outlast') fx.abilities.push({ cost: m[2], tap: true, effects: [{ k: 'counters', n: 1, on: '~' }], text: 'outlast', sorcery: true });
      else if (m[1] === 'multikicker') fx.kicker = cost;
      else if (m[1] !== 'reconfigure') fx[m[1]] = cost;
      continue;
    }
    if ((m = s.match(/^((?:basic )?land|plains|island|swamp|mountain|forest)?cycling ((?:\{[^}]+\})+)$/))) { fx.cycling = { cost: m[2].toUpperCase(), land: m[1] ? m[1].replace('basic land', 'basic') : null }; fx.kw.add('cycling'); continue; }
    if ((m = s.match(/^ward \{(\d+)\}$/))) { fx.ward = +m[1]; fx.kw.add('ward'); continue; }
    if ((m = s.match(/^protection from (white|blue|black|red|green)(?: and from (white|blue|black|red|green))?$/))) { fx.prot = [COLOR_NAME[m[1]], m[2] && COLOR_NAME[m[2]]].filter(Boolean); continue; }
    if ((m = s.match(/^(plains|island|swamp|mountain|forest)walk$/))) { fx.landwalk = m[1]; continue; }
    if (s === 'jump-start') { fx.jumpstart = true; continue; }
    if (s === 'affinity for artifacts') { fx.affinity = true; continue; }
    if (s === 'living weapon') { fx.etb.push({ k: 'germ', p: 0, t: 0, desc: 'black phyrexian germ' }); continue; }
    if (s === 'for mirrodin!') { fx.etb.push({ k: 'germ', p: 2, t: 2, desc: 'red rebel' }); continue; }
    if (s === 'riot') { fx.entersCounters = (+fx.entersCounters || 0) + 1; fx.kw.add('riot'); continue; }
    if (s === 'ravenous') { fx.entersCounters = 'X'; continue; }
    if (s === 'split second') { fx.splitSecond = true; continue; }
    if (s === 'cascade') { fx.cascade = true; continue; }
    if (['fear', 'shadow', 'exalted', 'battle cry', 'flanking', 'melee', 'dethrone', 'training', 'mentor', 'evolve', 'undying', 'persist',
      'decayed', 'changeling', 'devoid', 'extort', 'improvise', 'myriad', 'storm', 'convoke', 'delve', 'partner'].includes(s) || /^partner with /.test(s)) { fx.kw.add(s); continue; }
    if ((m = s.match(/^equip(?: [a-z ]+)? ((?:\{[^}]+\})+)$/))) { fx.equip ||= m[1]; continue; }
    // ---- 1.6.0 keywords
    if ((m = s.match(/^(dredge|hideaway) (\d+)$/))) {
      fx[m[1]] = +m[2]; fx.kw.add(m[1]);
      // Hideaway: look at the top N, keep one for later (the simulator puts it into hand)
      if (m[1] === 'hideaway') fx.etb.push({ k: 'dig', n: +m[2], take: 1, types: [], bf: false, gy: false });
      continue;
    }
    if ((m = s.match(/^(overload|transmute|offspring|warp) ((?:\{[^}]+\})+)$/))) {
      const cost = m[2].toUpperCase();
      fx.kw.add(m[1]);
      if (m[1] === 'overload') fx.overload = cost;
      if (m[1] === 'transmute') fx.channel = { cost, effects: [{ k: 'tutor', types: [], sameMv: true }], transmute: true };
      // Offspring: an optional extra cost for a 1/1 token copy as it enters
      if (m[1] === 'offspring') { fx.kicker = cost; fx.etb.push({ k: 'if', cond: { c: 'kicked' }, effects: [{ k: 'copyToken', what: 'creature', of: '~', small: true }] }); }
      // Warp: cast it cheaply; it leaves at the end of the turn (like dash)
      if (m[1] === 'warp') fx.dash ||= cost;
      continue;
    }
    if (s === 'umbra armor' || s === 'totem armor') { fx.umbra = true; continue; }
    // 1.17.0: foretell (exile for {2}, cast later for this cost), plot (exile for this cost, cast free later), encore
    if ((m = s.match(/^(foretell|plot|encore) ((?:\{[^}]+\})+)$/))) { fx[m[1]] = m[2].toUpperCase(); fx.kw.add(m[1]); continue; }
    // Typecycling for a creature type ("wizardcycling {2}")
    if ((m = s.match(/^([a-z]+)cycling ((?:\{[^}]+\})+)$/)) && !['plains', 'island', 'swamp', 'mountain', 'forest', 'land', 'basic land'].includes(m[1])) { fx.cycling = { cost: m[2].toUpperCase(), land: null, tribe: m[1] }; fx.kw.add('cycling'); continue; }
    if ((m = s.match(/^devour (\d+)$/))) { fx.etb.push({ k: 'devour', n: +m[1] }); continue; }
    // Impending (the Overlords): cast for less; it isn't a creature until its time counters are gone
    if ((m = s.match(/^impending (\d+)—((?:\{[^}]+\})+)$/))) { fx.impending = { n: +m[1], cost: m[2].toUpperCase() }; continue; }
    if ((m = s.match(/^ward—(?:sacrifice|discard|exile|tap|collect|pay|waterbend) .+$/))) { fx.ward = 2; fx.kw.add('ward'); continue; }
    // Affinity for tokens, for Equipment…: one less per permanent of that kind you control
    if ((m = s.match(/^affinity for (\w+)$/)) && m[1] !== 'artifacts') { fx.selfReduce = { n: 1, each: singular(m[1]), where: 'you' }; continue; }
    if (s === 'station') {
      fx.station = true;
      fx.abilities.push({ cost: '', tap: false, effects: [{ k: 'station' }], text: 'station', sorcery: true, costs: { ...parseCostText('tap another untapped creature you control'), stationTap: true } });
      continue;
    }
    if ((m = s.match(/^gift an? ([\w ]+)$/))) { fx.gift = m[1]; continue; }
    if (s === 'start your engines!') { fx.speed = true; continue; }
    if (s === '~ can be your commander') continue;
    // ---- 1.7.0 keywords
    // Suspend: exile it with time counters for its suspend cost; it's cast free when the last one comes off
    if ((m = s.match(/^suspend (\d+)—((?:\{[^}]+\})+)$/))) { fx.suspend = { n: +m[1], cost: m[2].toUpperCase() }; fx.kw.add('suspend'); continue; }
    // Miracle: castable for its miracle cost on the turn it's drawn as that turn's first card
    if ((m = s.match(/^(miracle|entwine) ((?:\{[^}]+\})+)$/))) { fx[m[1]] = m[2].toUpperCase(); fx.kw.add(m[1]); continue; }
    if (s === 'exploit') { fx.exploit = true; fx.kw.add('exploit'); fx.etb.push({ k: 'exploit' }); continue; }
    // Compleated only changes loyalty when life is paid for its Phyrexian mana, which the simulator pays with mana
    if (s === 'compleated') continue;
    if (KEYWORDS.some(k => s === k) || /^(enchant|protection from|convoke|delve)\b/.test(s)) continue;
    all = false;
  }
  return all;
}

function searchEffect(s) {
  const landish = /(basic land|land cards?|forest|plains|island|swamp|mountain)/.test(s) && !/(creature|instant|sorcery|artifact|enchantment) card/.test(s);
  const upTo = s.match(/up to (\w+)/);
  const n = upTo ? num(upTo[1]) : 1;
  // ("a Forest card", "a basic Plains, Island, Swamp, or Mountain card": only those land types)
  const named = s.match(/for (?:a|an|up to \w+) (?:basic )?((?:plains|island|swamp|mountain|forest)(?:,? (?:or |and\/or )?(?:plains|island|swamp|mountain|forest))*)(?: cards?)/);
  if (landish) return { k: 'rampLand', n, bf: /onto the battlefield/.test(s), tapped: /battlefield tapped/.test(s), split: /other into your hand/.test(s), basic: /basic/.test(s), subs: named ? named[1].match(/plains|island|swamp|mountain|forest/g) : null };
  // Restricted tutors only find the card types they name ("a creature card", "an instant or sorcery card")
  const what = (s.match(/for (?:a|an|up to \w+)\s+([\w ,-]*?)\s*cards?\b/) || [])[1] || '';
  const types = ['creature', 'artifact', 'enchantment', 'instant', 'sorcery', 'planeswalker', 'land'].filter(t => new RegExp(`\\b${t}\\b`).test(what));
  return { k: 'tutor', bf: /onto the battlefield/.test(s), top: /on top/.test(s), gy: /into your graveyard/.test(s), types };
}

// Effects with conditions: "If <condition>, <effect>" sentences become {k:'if'} effects, and
// "... instead" replaces what the sentence before did when the condition holds. Sentences without a
// condition stay together (some patterns span two sentences).
export function parseEffects(t) {
  // "You may pay {4}. If you do, untap ~": the effect only happens if the cost is paid on resolution
  const pf = t.match(/^(.*?)you may pay ((?:\{[^}]+\})+)\. if you do, ([^.]+\.?)(.*)$/);
  if (pf) {
    const inner = parseFlat(pf[3]);
    const rest = [...(pf[1].trim() ? parseEffects(pf[1]) : []), ...(inner.length ? [{ k: 'payFor', cost: pf[2].toUpperCase(), effects: inner }] : []), ...(pf[4].trim() ? parseEffects(pf[4].trim()) : [])];
    return rest;
  }
  const out = [];
  let plain = [], lastPlain = null, lastIf = null;
  const flush = () => { if (plain.length) { lastPlain = parseFlat(plain.join(' ')); out.push(...lastPlain); plain = []; } };
  for (let s of t.split(/(?<=\.)\s+/)) {
    s = s.replace(/^(?!choose )[a-z0-9',! ]{3,30} — (?=if |\w)/, '');
    // (limits on how often something happens don't change what it does)
    if (/^this ability triggers only once each turn|^activate only once each turn|^activate only as a sorcery|^this effect doesn't remove/.test(s)) continue;
    // ("If a card would be put into your graveyard …, exile it instead" is a replacement, not a condition)
    let m = /^if [^,]* would /.test(s) ? null : s.match(/^(?:if|as long as) (?!you do\b|you don't\b|it's|that\b|they\b|a player does\b|no one does\b)(.+?), (.+)$/);
    let instead = false;
    if (!m && (m = s.match(/^(.+?) instead if (.+?)\.?$/))) { m = [s, m[2], m[1]]; instead = true; }
    if (m) {
      flush();
      const effects = parseFlat(m[2]);
      instead ||= /\binstead\b/.test(m[2]);
      if (!effects.length) continue;
      const e = { k: 'if', cond: parseCond(m[1]), effects };
      if (instead && lastPlain?.length) {
        e.else = lastPlain;
        for (const x of lastPlain) out.splice(out.indexOf(x), 1);
        lastPlain = null;
      } else if (instead) e.instead = true;   // (the plain version is on the line before: see analyzeCard)
      out.push(e);
      lastIf = e;
      continue;
    }
    if ((m = s.match(/^otherwise, (.+)/)) && lastIf && !lastIf.else) { flush(); lastIf.else = parseFlat(m[1]); continue; }
    plain.push(s);
  }
  flush();
  return out;
}

function parseFlat(t) {
  // "Until end of turn, X" reads like "X until end of turn" to the patterns
  t = t.replace(/(^|\. )until end of turn, ([^.]+)/g, '$1$2 until end of turn').replace(/(^|\. )until your next turn, ([^.]+)/g, '$1$2 until end of turn');
  const found = [];
  for (const [re, f] of PATTERNS) {
    for (const m of t.matchAll(new RegExp(re.source, 'g'))) { const e = f(m); if (e) found.push({ i: m.index, e }); }
  }
  // "Exile target creature you control, then return it" is a blink, not removal (same for delayed returns)
  const blinks = new Set(found.filter(x => x.e.k === 'blink' || x.e.k === 'flickerDelay').map(x => x.i));
  // "draw a card for each creature you control" is also matched as a plain "draw a card"
  const counted = new Set(found.filter(x => typeof x.e.n === 'object').map(x => x.i));
  const blinking = blinks.size > 0;
  let effects = found.filter(x => !(x.e.k === 'remove' && blinks.has(x.i)) && !(x.e.k === 'draw' && typeof x.e.n !== 'object' && counted.has(x.i)) && !((x.e.k === 'returnSelf' || x.e.k === 'returnTrig') && blinking))
    .sort((a, b) => a.i - b.i).map(x => x.e);
  // Only the first "add mana" counts (Cabal Ritual's threshold bonus is an "instead")
  const firstMana = effects.find(e => e.k === 'addMana');
  effects = effects.filter(e => e.k !== 'addMana' || e === firstMana);
  // "..., where X is your devotion to black" / "the number of creatures you control": X is counted on resolution
  const dyn = t.match(/where x is (?:your devotion to (white|blue|black|red|green)|the number of (creature|artifact|land|enchantment)s? you control|the number of cards in your hand|(the greatest power among creatures you control)|(the number of cards in your graveyard)|(that spell's mana value|its mana value))/);
  if (dyn) {
    const d = dyn[1] ? { dyn: 'devotion', color: 'WUBRG'['white blue black red green'.split(' ').indexOf(dyn[1])] } : dyn[2] ? { dyn: 'count', what: dyn[2] } : dyn[3] ? { dyn: 'maxPower' } : dyn[4] ? { dyn: 'gy' } : dyn[5] ? { dyn: 'trigMV' } : { dyn: 'hand' };
    for (const e of effects) for (const f of ['n', 'p', 't']) if (e[f] === 'X') e[f] = d;
  }
  return effects;
}

export function needsTarget(e) {
  if (e.k === 'copyToken' && e.of) return false;
  if (['remove', 'bounce', 'loseLife', 'pump', 'blink', 'copySpell', 'counter', 'counterAbility', 'steal', 'flickerDelay', 'copyToken', 'redirect', 'fight', 'tap', 'shrink', 'noBlock'].includes(e.k)) return true;
  if (e.k === 'goad') return !e.all;
  if (e.k === 'evade' || e.k === 'kwCounter') return !e.self && !e.all;
  if (e.k === 'regen') return !e.self && !e.all;
  if (e.k === 'doublePT') return !e.all && !e.trig && !e.self;
  if (e.k === 'minus') return e.on.startsWith('target');
  if (e.k === 'discard' || e.k === 'silence' || e.k === 'mill' || e.k === 'poison') return e.who.startsWith('target');
  if (e.k === 'protect') return e.scope === 'one';
  if (e.k === 'damage') return !e.to.startsWith('each') && e.to !== 'defender' && e.to !== 'that player';
  if (e.k === 'counters') return e.on.startsWith('target');
  return false;
}

export function analyzeCard(card) {
  const typeLine = (card.typeLine || '').toLowerCase();
  const main = typeLine.split('—')[0];
  const type = {
    land: /\bland\b/.test(main), creature: /\bcreature\b/.test(main), artifact: /\bartifact\b/.test(main),
    enchantment: /\benchantment\b/.test(main), planeswalker: /\bplaneswalker\b/.test(main),
    instant: /\binstant\b/.test(main), sorcery: /\bsorcery\b/.test(main), battle: /\bbattle\b/.test(main),
    legendary: /\blegendary\b/.test(main), basic: /\bbasic\b/.test(main),
    aura: /\baura\b/.test(typeLine), equipment: /\bequipment\b/.test(typeLine),
  };
  type.permanent = !type.instant && !type.sorcery;
  const subtypes = (typeLine.split('—')[1] || '').trim().split(/\s+/).filter(Boolean);
  const t = cleanText(card.text, card.frontName || card.name);
  const fx = {
    type, subtypes, kw: new Set(), spell: [], etb: [], attack: [], upkeep: [], endstep: [], dies: [],
    abilities: [], pw: [], anthem: null, attachBuff: null, pacify: false, equip: null, mana: null,
    entersTapped: false, fetch: false, entersCounters: 0, imprint: false, onDeath: null, sacOutlet: null,
    onCast: null, costReduce: null, modes: null, etbModes: null, saga: null,
    landfall: [], onOppCast: null, attackTax: 0, handOnly: false, flashback: null, evoke: null, altFree: null,
    convoke: false, delve: false, handMana: null, onOppDraw: null, combatDamage: [], clone: null,
    manaAnthem: /** @type {any} */ (false), manaBoost: false, untapOthers: false, necro: false, searchHate: false, uncounterable: false, protectsSpells: false, pingCounters: false,
    kwN: {}, watch: [], condBuff: null,
  };
  for (const k of card.keywords || []) if (KEYWORDS.includes(k.toLowerCase()) || MORE_KEYWORDS.includes(k.toLowerCase())) fx.kw.add(k.toLowerCase());
  const kws = (card.keywords || []).map(k => k.toLowerCase());
  fx.convoke = kws.includes('convoke');
  fx.delve = kws.includes('delve');
  fx.storm = kws.includes('storm');
  const produced = (card.produced || []).filter(c => 'WUBRGC'.includes(c));
  const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };

  const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
  LAST_ROLL = null;
  // Lines that changed nothing are kept in fx.unread (the deck viewer and coverage report them)
  fx.unread = [];
  let sig = null, pending = null;
  const check = () => { if (pending != null && describeFx(fx).join('|') === sig) fx.unread.push(pending); pending = null; };
  // Abilities that only work past a threshold: station "8+ |", class levels, max speed (see Game.gateOk)
  let gate = null, classLevel = 1, bgMark = null;
  // A background's granted ability only works while you control a commander
  const applyBg = () => {
    if (!bgMark) return;
    for (const w of fx.watch.slice(bgMark.w)) w.cmdr = true;
    if (fx.anthem && fx.anthem !== bgMark.anthem) fx.anthem.cond ||= { c: 'commander' };
    bgMark = null;
  };
  const applyGate = () => {
    if (!gate) return;
    const g = { kind: gate.kind, n: gate.n };
    for (const a of fx.abilities.slice(gate.a)) a.gate = g;
    for (const w of fx.watch.slice(gate.w)) w.gate = g;
    if (fx.mana && !gate.mana) fx.mana.gate = g;
    gate = null;
  };
  const openGate = (kind, n) => { gate = { kind, n, a: fx.abilities.length, w: fx.watch.length, mana: !!fx.mana }; };
  for (let li = 0; li < lines.length; li++) {
    check();
    applyGate();
    applyBg();
    if (classLevel > 1) openGate('level', classLevel);
    if (keywordLine(lines[li], fx)) continue;
    if (!/^(?:•|\(|reminder)/.test(lines[li]) && !reminderOnly(lines[li])) { sig = describeFx(fx).join('|'); pending = lines[li]; }
    if (/^max speed — /.test(lines[li])) openGate('speed', 4);
    // Ability words (threshold, morbid, raid, coven…) only name a condition the text spells out
    let line = subtypes.includes('saga') ? lines[li] : lines[li].replace(/^(?!choose )[a-z0-9',! ]{3,30} — (?=[{a-z~+])/, '');

    let m;
    // ---- 1.17.0 line shapes (card scan, item 82)
    // Backgrounds: "Commander creatures you own have "…"" (read as the background's own ability; it works only while
    // you control a commander, see bgMark below)
    if ((m = line.match(/^commander creatures you own have "(.+?)\.?"\.?$/)) && !/from exile|from anywhere/.test(m[1])) { line = m[1]; bgMark = { w: fx.watch.length, anthem: fx.anthem }; }
    // Auras and equipment that grant a trigger: "Enchanted creature has "Whenever ~ deals combat damage to a player, draw a card.""
    if ((m = line.match(/^(?:enchanted|equipped) creature has "whenever ~ (deals combat damage to a player|attacks), (.+?)"\.?$/))) {
      const e = parseEffects(m[2]);
      if (e.length) { fx.watch.push({ ev: m[1] === 'attacks' ? 'attachedAttacks' : 'attachedDamage', effects: e }); continue; }
    }
    if ((m = line.match(/^whenever a creature deals combat damage to one of your opponents, its controller may (draw a card|pay 1 life\. if they do, they draw a card)/))) {
      fx.watch.push({ ev: 'allyCombat', effects: /pay 1 life/.test(m[1]) ? [{ k: 'loseSelf', n: 1 }, { k: 'draw', n: 1 }] : [{ k: 'draw', n: 1 }] });
      continue;
    }
    if (/^whenever ~ deals combat damage to a creature, destroy that creature/.test(line)) { fx.combatKill = true; continue; }
    if ((m = line.match(/^whenever one or more creatures attack,? (?:you may have )?(.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.watch.push({ ev: 'youAttack', effects: e }); continue; } }
    // "As long as ~ is in the command zone or on the battlefield, other Dragon spells you cast cost {1} less" (eminence)
    if ((m = line.match(/^as long as ~ is in the command zone or on the battlefield, other (\w+) spells you cast cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: singular(m[1]), n: +m[2], cmdZone: true }; continue; }
    // Door of Destinies, Banner of Kinship, Chitterspitter: anthems that grow with counters on the source
    if ((m = line.match(/^(?:creatures you control of the chosen type|(\w+)s you control) get \+1\/\+1 for each (\w+) counter on ~/))) { fx.anthem = { other: false, tribe: m[1] || 'chosen', p: 0, t: 0, kw: [], perCounter: m[2] }; continue; }
    // Dragon's Rage Channeler: "as long as …, ~ gets +2/+2, has flying, and attacks each combat if able"
    if ((m = line.match(/^as long as (.+?), ~ gets \+(\d+)\/\+(\d+), has ([\w ]+?), and attacks each combat if able/))) { fx.condBuff = { cond: parseCond(m[1]), p: +m[2], t: +m[3], kw: kwList(m[4]), mustAttack: true }; continue; }
    if (/^as long as ~ is attached to a creature, your opponents can't cast spells during your turn/.test(line)) { fx.noCastMyTurn = 'attached'; continue; }
    // Lignify-style auras
    if ((m = line.match(/^enchanted creature is an? [\w ]+? with base power and toughness (\d+)\/(\d+) and loses all abilities/))) { fx.attachSet = { p: +m[1], t: +m[2] }; continue; }
    // Self cost reductions by the total mana value of what you control (Earthquake Dragon, Excalibur)
    if ((m = line.match(/^~ costs \{x\} less to cast, where x is the total mana value of ([\w ]+?) you control/))) { fx.selfReduce = { n: 1, dyn: { dyn: 'sumMv', what: m[1].split(' ').map(singular).join(' ') } }; continue; }
    // Strive: the simulator always takes a single target, so the extra cost never applies
    if (/^~ costs [{}\w]+ more to cast for each target beyond the first/.test(line)) { fx.strive = true; continue; }
    if ((m = line.match(/^spells you cast with mana value (\d+) or greater have cascade/))) { fx.cascadeGrant = { minMv: +m[1] }; continue; }
    if ((m = line.match(/^(creature spells you cast|spells you cast from exile) have convoke/))) { fx.convokeGrant = m[1].startsWith('creature') ? 'creature' : 'exile'; continue; }
    if (/^spells and abilities your opponents control can't cause their controller to search their library/.test(line)) { fx.searchHate = true; continue; }
    if (/^if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals double that damage/.test(line)) { fx.burnDouble = true; continue; }
    // Mana anthems for some creatures: slivers, allies, other legends
    if ((m = line.match(/^(all slivers|sliver creatures you control|each land and ally you control|other legendary creatures you control) (?:have|has) (vigilance and )?"\{t\}: add one mana of any color\.?"/))) {
      fx.manaAnthem = { tribe: /sliver/.test(m[1]) ? 'sliver' : /ally/.test(m[1]) ? 'ally' : 'legendary', other: /other/.test(m[1]) };
      if (m[2]) fx.anthem = { other: true, tribe: null, what: 'legendary', p: 0, t: 0, kw: ['vigilance'] };
      continue;
    }
    if ((m = line.match(/^whenever (?:a land's ability causes you to add one or more mana of the chosen color|you tap a land for \{c\}), add an additional (?:one mana of that color|\{c\})/))) { fx.landBoost = { what: 'land', sym: /\{c\}/.test(m[0]) ? 'C' : null, onlyC: /\{c\}/.test(m[0]) }; continue; }
    // Kess, Serra Paragon, Muldrotha: once each turn, a spell (or land) from your graveyard
    if ((m = line.match(/^(?:once )?during each of your turns, you may (?:cast an? (instant or sorcery|permanent) spell(?: with mana value (\d+) or less)? from your graveyard|play a land from your graveyard or cast a permanent spell with mana value (\d+) or less from your graveyard|play a land and cast a permanent spell of each permanent type from your graveyard)/))) {
      fx.gyCastOnce = { types: m[1] === 'instant or sorcery' ? ['instant', 'sorcery'] : ['creature', 'artifact', 'enchantment', 'planeswalker', 'battle'], maxMv: m[2] || m[3] ? +(m[2] || m[3]) : null, exile: /exile it instead/.test(line) };
      continue;
    }
    if ((m = line.match(/^each (\w+) you control enters with an additional \+1\/\+1 counter on it/))) { fx.teamCounter = { tribe: singular(m[1]) }; continue; }
    if (/^each instant and sorcery card in your graveyard has flashback/.test(line)) { fx.gyFlashbackAll = true; continue; }
    if ((m = line.match(/^if one or more counters would be put on a creature, spacecraft, or planet you control, twice that many/))) { fx.counterBonus = 'double'; continue; }
    if (/^prevent all combat damage that would be dealt to attacking artifact creatures you control/.test(line)) { fx.protectAttackers = 'artifact'; continue; }
    // ---- 1.17.0 second batch
    if (/^each opponent can't cast noncreature spells with mana value greater than the number of lands that player controls/.test(line)) { fx.landCap = true; continue; }
    // ---- 1.17.0 third batch
    if ((m = line.match(/^whenever another creature you own dies, (.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.onDeath = { who: 'yours', other: true, nontoken: false, what: null, effects: e }; continue; } }

    if ((m = line.match(/^as ~ enters, you may have it become a copy of any creature on the battlefield until end of turn/))) { fx.etb.push({ k: 'becomeCopy', what: 'creature', eot: true, haste: /haste/.test(line) }); continue; }
    if ((m = line.match(/^each other (creature|(\w+)) you control enters with (?:a number of additional \+1\/\+1 counters on it equal to ~'s (power|toughness)|an additional \+1\/\+1 counter on it for each \w+ you already control)/))) { fx.teamCounter = { tribe: m[2] ? singular(m[2]) : null, dynSelf: m[3] || null, perTribe: !m[3] }; continue; }
    if (/^if an opponent would put one or more counters on a permanent or player, they put half that many/.test(line)) { fx.counterHalfOpp = true; continue; }
    if (/^if an opponent would search a library, that player searches the top four cards of that library instead/.test(line)) { fx.searchTop4 = true; continue; }
    if ((m = line.match(/^whenever a spell or ability you control counters a spell, (?:you may )?(.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.watch.push({ ev: 'countered', effects: e }); continue; } }
    if (/^if a triggered ability of equipped creature triggers, that ability triggers an additional time/.test(line)) { fx.trigTwice = { kind: 'equipped' }; continue; }
    if (/^if you tap a basic land for mana, it produces three times as much of that mana instead/.test(line)) { fx.manaMult = 3; fx.manaMultBasic = true; continue; }
    if (/^double all damage that sources you control of the chosen type would deal/.test(line)) { fx.damageDouble = 2; fx.damageAny = true; fx.damageChosen = true; continue; }
    if (/^if a creature you control with a \+1\/\+1 counter on it would deal damage to a permanent or player, it deals double that damage instead/.test(line)) { fx.damageDouble = 2; fx.damageAny = true; fx.creatureDamageOnly = true; fx.damageCounters = true; continue; }
    if ((m = line.match(/^as long as there are (\w+) or more (\w+) counters on ~, untap all creatures you control during each other player's untap step/))) { fx.untapOthers = true; fx.untapOthersCond = { c: 'named', n: num(m[1]), kind: m[2] }; continue; }
    if ((m = line.match(/^(?:lieutenant — )?as long as you control your commander, other creatures you control have ([\w ,]+?)\.?$/)) && kwList2(m[1]).length) { fx.anthem = { other: true, tribe: null, p: 0, t: 0, kw: kwList2(m[1]), cond: { c: 'commander' } }; continue; }
    if (/^prevent all combat damage that would be dealt to and dealt by ~/.test(line)) { fx.fogBank = true; continue; }
    if (/^creatures with flying can't attack you or planeswalkers you control/.test(line)) { fx.noFlyAttack = true; continue; }
    if (/^goaded creatures your opponents control can't block/.test(line)) { fx.goadNoBlock = true; continue; }
    if (/^each creature that's attacking one of your opponents has trample/.test(line)) { fx.attackTrample = true; continue; }
    if ((m = line.match(/^each legendary creature you control gets \+1\/\+1 for each other legendary creature you control/))) { fx.anthem = { other: false, tribe: null, what: 'legendary', p: 0, t: 0, kw: [], perOther: 'legendary' }; continue; }
    if ((m = line.match(/^other creatures you control get \+1\/\+0 for each aura and equipment attached to ~/))) { fx.anthem = { other: true, tribe: null, p: 0, t: 0, kw: [], perAttachedP: true }; continue; }
    if ((m = line.match(/^whenever your commander enters or attacks, (.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.watch.push({ ev: 'enter', what: 'creature', commander: true, ctl: 'you', effects: e }, { ev: 'allyAttacks', commander: true, effects: e }); continue; } }
    if ((m = line.match(/^other artifact creatures you control get \+(\d+)\/\+(\d+) as long as (.+?)\.?$/))) { fx.anthem = { other: true, tribe: null, what: 'artifact', p: +m[1], t: +m[2], kw: [], cond: parseCond(m[3]) }; continue; }
    if ((m = line.match(/^(\w+)s you control enter untapped/)) && m[1] !== 'land') { fx.landsUntapped = { what: singular(m[1]) }; continue; }
    if (/^the first spell you cast from exile each turn has cascade/.test(line)) { fx.cascadeGrant = { minMv: 0, fromExile: true }; continue; }
    if ((m = line.match(/^~ gets \+(\d+)\/\+(\d+) for each aura attached to it/))) { fx.eachBuff = { p: +m[1], t: +m[2], other: false, what: 'aura', where: 'attached' }; continue; }
    if (/^as long as ~ is attached to a creature, you may play lands and cast spells from the top of your library/.test(line)) { fx.seeTop = true; fx.playTop = 'all'; fx.playTopAttached = true; continue; }
    if ((m = line.match(/^colorless spells you cast from your hand with mana value (\d+) or greater have "cascade, cascade\.?"/))) { fx.cascadeGrant = { minMv: +m[1], colorless: true, fromHand: true, n: 2 }; continue; }
    if ((m = line.match(/^as long as (.+?), you may cast (creature) spells from the top of your library/))) { fx.seeTop = true; fx.playTop = 'creature'; fx.playTopCond = parseCond(m[1]); continue; }
    if ((m = line.match(/^the second spell you cast each turn costs \{(\d+)\} less to cast/))) { fx.costReduce = { what: 'any', n: +m[1], second: true }; continue; }
    if (/^enchanted land has "\{t\}: add one mana of any color\.?"/.test(line)) { fx.auraFix = true; continue; }
    if ((m = line.match(/^as long as you control your commander, ~ gets \+(\d+)\/\+(\d+) and other creatures you control get \+(\d+)\/\+(\d+) and have ([\w ]+?)\.?$/))) {
      fx.condBuff = { cond: { c: 'commander' }, p: +m[1], t: +m[2], kw: [] };
      fx.anthem = { other: true, tribe: null, p: +m[3], t: +m[4], kw: kwList(m[5]), cond: { c: 'commander' } };
      continue;
    }
    if (/^whenever a basic land is tapped for mana of the chosen color, its controller adds an additional one mana of that color/.test(line)) { fx.landBoost = { what: 'basic land', sym: null }; continue; }
    if (/^whenever you tap a land for mana while you're the monarch, add an additional one mana of any color/.test(line)) { fx.landBoost = { what: 'land', sym: null, monarch: true }; continue; }
    if ((m = line.match(/^whenever a creature you control that's enchanted or equipped attacks, (.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.watch.push({ ev: 'allyAttacks', with: 'enchanted or equipped', effects: e }); continue; } }
    if (/^you may play historic lands and cast historic spells from the top of your library/.test(line)) { fx.seeTop = true; fx.playTop = 'historic'; continue; }
    if ((m = line.match(/^during your turn, ~ has ([\w ,]+?)\.?$/)) && kwList(m[1]).length) { fx.condBuff = { cond: { c: 'myTurn' }, p: 0, t: 0, kw: kwList(m[1]) }; continue; }
    if (/^no more than one creature can block each combat/.test(line)) { fx.blockCap = 1; continue; }
    if ((m = line.match(/^you can't cast ~ unless (.+?)\.?$/))) { fx.castCond = parseCond(m[1]); continue; }
    if ((m = line.match(/^you may pay \{0\} rather than pay the mana cost for (\w+) creature spells you cast/))) { fx.freeTribe = m[1]; continue; }
    if ((m = line.match(/^you may pay ((?:\{[^}]+\})+) rather than pay ~'s mana cost if (.+?)\.?$/))) { fx.altMana = m[1].toUpperCase(); fx.altManaCond = parseCond(m[2]); continue; }
    if (/^if you control a forest, rather than pay ~'s mana cost, you may have an opponent gain 3 life/.test(line)) { fx.altFree = 'forestGift'; continue; }
    if ((m = line.match(/^~ escapes with (\w+) \+1\/\+1 counters? on it/))) { fx.escapeCounters = num(m[1]); continue; }
    if ((m = line.match(/^whenever an opponent sacrifices a nontoken permanent( or discards a permanent card)?, (.*)/))) {
      const e = parseEffects(m[2]);
      if (e.length) { fx.watch.push({ ev: 'sac', who: 'opp', what: 'nontoken permanent', effects: e }); if (m[1]) fx.watch.push({ ev: 'discard', who: 'opp', what: 'permanentCard', effects: e }); continue; }
    }
    // ---- 1.6.0 line shapes

    // Station: "8+ | Flying" works once the spacecraft has that many charge counters
    if ((m = line.match(/^(\d+)\+ \| (.*)/))) {
      openGate('charge', +m[1]);
      line = m[2];
      if (card.power != null) fx.stationN = Math.min(fx.stationN || 99, +m[1]);
      if (kwList(line).length && /^[a-z, ]+$/.test(line)) { fx.condBuff = { cond: { c: 'named', kind: 'charge', n: +m[1] }, p: 0, t: 0, kw: kwList(line) }; continue; }
      if (keywordLine(line, fx)) continue;
    }
    // Class levels: "{1}{W}: Level 2" (the abilities written after it belong to that level)
    if ((m = line.match(/^((?:\{[^}]+\})+): level (\d+)$/))) {
      fx.abilities.push({ cost: m[1], tap: false, effects: [{ k: 'level', n: +m[2] }], text: `level ${m[2]}`, sorcery: true, levelTo: +m[2], costs: parseCostText(m[1]) });
      classLevel = +m[2];
      gate = null;
      continue;
    }
    // Die-roll tables: "1—14 | Create a Treasure token." under a "roll a d20" line
    if ((m = line.match(/^(\d+)(?:—(\d+))? \| (.*)/)) && LAST_ROLL) {
      const effects = parseEffects(m[3]);
      if (effects.length) { (LAST_ROLL.table ||= []).push({ lo: +m[1], hi: +(m[2] || m[1]), effects }); pending = null; }
      continue;
    }
    // "Choose one. If you control a commander as you cast ~, you may choose both instead." with bullet modes
    if ((m = line.match(/^choose one\. if (.+?), you may choose (both|two|any number) instead\.?$/))) {
      const bullets = [];
      while (lines[li + 1]?.startsWith('•')) bullets.push(parseEffects(lines[++li].slice(1)));
      const modal = { n: 1, modes: bullets.filter(b => b.length), up: { cond: parseCond(m[1].replace(/ as you cast ~$/, '')), n: m[2] === 'any number' ? 99 : 2 } };
      if (type.instant || type.sorcery) fx.modes = modal; else fx.etbModes = modal;
      continue;
    }
    // Modal: "Choose one —" followed by "• mode" lines; the pilot picks the modes when casting
    if ((m = line.match(/choose (one or both|one or more|any number|up to one|one|two|three)(?: that hasn't been chosen(?: this turn)?)? —$/))) {
      const bullets = [];
      while (lines[li + 1]?.startsWith('•')) bullets.push(parseEffects(lines[++li].slice(1)));
      const n = { one: 1, two: 2, three: 3, 'one or both': 2, 'up to one': 1 }[m[1]] || 99;
      const modal = { n, modes: bullets.filter(b => b.length) };
      if (/^(?:when|whenever) ~ enters/.test(line)) { fx.etbModes = modal; continue; }
      if (/whenever a land (?:you control enters|enters)/.test(line)) { fx.landfallModes = modal; continue; }
      if (type.instant || type.sorcery) { fx.modes = modal; continue; }
      // Any other trigger or activated ability: the modes become one effect, chosen on resolution
      if (!modal.modes.length) continue;
      MODAL_STASH = { k: 'modal', ...modal };
      line = line.replace(/choose [^—]*—$/, 'modalx.');
    }
    // Saga chapters: "i, ii — effect"
    if (subtypes.includes('saga') && (m = line.match(/^((?:i|ii|iii|iv|v|vi)(?:, (?:i|ii|iii|iv|v|vi))*) — (.*)/))) {
      fx.saga ||= [];
      for (const r of m[1].split(', ')) fx.saga[ROMAN[r] - 1] = parseEffects(m[2]);
      continue;
    }
    // Heroic: "Whenever you cast a spell that targets ~"
    if ((m = line.match(/^whenever you cast a spell that targets ~, (.*)/))) { const e = parseEffects(m[1]); if (e.length) fx.watch.push({ ev: 'heroic', self: true, effects: e }); continue; }
    // Spellslinger triggers ("Whenever you cast a noncreature spell, ..."), including magecraft
    if ((m = line.match(/^(?:[\w ]+ — )?whenever you cast (?:or copy )?(?:a |an |your first )?((?:[a-z]+(?:,? or |, | ))*?)spell[^,]*, (.*)/))) {
      const effects = parseEffects(m[2]);
      // ("a spell of the chosen type": Door of Destinies)
      if (effects.length) { fx.onCast = { what: /^(?:[\w ]+ — )?whenever you cast a spell of the chosen type/.test(line) ? 'chosen' : (m[1] || 'any').trim(), effects };
        // (Keeper of Secrets: only spells cast from elsewhere; Monstrous Vortex: big creatures; Ojer Pakpatiq: from your hand)
        if (/from anywhere other than your hand/.test(line)) fx.onCast.notHand = true;
        else if (/spell from your hand/.test(line)) fx.onCast.fromHand = true;
        if ((m = line.match(/spell with power (\d+) or greater/))) fx.onCast.minPower = +m[1];
        continue;
      }
    }
    if ((m = line.match(/^(?:landfall — )?whenever a land (?:you control enters|enters(?: the battlefield)? under your control),? (.*)/))) { fx.landfall.push(...parseEffects(m[1])); continue; }
    // Rhystic Study, Mystic Remora, Esper Sentinel: punish opponents for casting unless they pay
    if ((m = line.match(/^whenever an opponent casts (a |an |their first |their second )(noncreature |instant or sorcery |creature )?spell(?: each turn)?, (?:you may )?(.*)/))) {
      const tax = m[3].match(/unless that player pays \{(\d+|x)\}/);
      const effects = parseEffects(m[3]);
      if (effects.length) { fx.onOppCast = { noncreature: m[2] === 'noncreature ', what: (m[2] || '').trim(), first: m[1] === 'their first ', second: m[1] === 'their second ', tax: tax ? (tax[1] === 'x' ? 1 : +tax[1]) : 0, effects }; continue; }
    }
    // Smothering Tithe: opponents pay when they draw, or you get the effect
    if ((m = line.match(/^whenever an opponent draws a card, that player may pay \{(\d+)\}\. if the player doesn't, (.*)/))) {
      const effects = parseEffects(m[2]);
      if (effects.length) fx.onOppDraw = { tax: +m[1], effects };
      continue;
    }
    // Underworld Breach: every nonland card in your graveyard can be cast with escape
    if (/^each nonland card in your graveyard has escape/.test(line)) { fx.breach = true; continue; }
    if (/^at the beginning of the end step, sacrifice ~/.test(line)) { fx.sacAtEnd = true; continue; }
    // Lion's Eye Diamond: three mana for your whole hand
    if (/^(?:\{t\}, )?(?:sacrifice ~, discard your hand|discard your hand, sacrifice ~): add three mana of any one color/.test(line)) { fx.mana = { amount: 3, colors: ['W', 'U', 'B', 'R', 'G'], sac: true, discardHand: true }; continue; }
    // Faerie Mastermind
    if ((m = line.match(/^whenever an opponent draws their second card each turn, (.*)/))) { const e = parseEffects(m[1]); if (e.length) fx.onOppSecondDraw = e; continue; }
    // Valley Floodcaller, Leyline of Anticipation: noncreature (or all) spells as though they had flash
    if ((m = line.match(/^you may cast (noncreature )?spells as though they had flash/))) { fx.flashGrant = m[1] ? 'noncreature' : 'any'; continue; }
    // Redirect Lightning: "As an additional cost to cast this spell, pay 5 life or ..."
    if ((m = line.match(/^as an additional cost to cast (?:this spell|~), pay (\d+) life/))) { fx.lifeCost = +m[1]; continue; }
    // Fling, Thoughtcast-style extra costs: "As an additional cost to cast this spell, sacrifice a creature / discard a card"
    if ((m = line.match(/^as an additional cost to cast (?:this spell|~), (.+?)\.?$/))) {
      const c = parseCostText(m[1]);
      if (c) { fx.addCost = c; continue; }
    }
    // Spirit Guides: free mana by exiling the card from your hand
    if ((m = line.match(/^exile ~ from your hand: add ((?:\{[wubrgc]\})+)/))) { fx.handMana = m[1].match(/[wubrgc]/g).map(c => c.toUpperCase()); continue; }
    if ((m = line.match(/^whenever ~ attacks or blocks, (.*)/))) {
      const e = parseEffects(m[1]);
      fx.attack.push(...e);
      if (e.length) fx.watch.push({ ev: 'block', self: true, effects: e });
      continue;
    }
    // Generic triggers: life gain, draws, sacrifices, equipped creatures, other upkeeps and end steps…
    let watched = false;
    for (const [re, f] of WATCHERS) {
      if (!(m = line.match(re))) continue;
      const e = parseEffects(m[m.length - 1]);
      // (a trigger whose effect isn't read falls through to the special cases further down)
      if (!e.length) continue;
      for (const w of f(m)) fx.watch.push({ ...w, effects: e });
      watched = true;
      break;
    }
    if (watched) continue;
    if ((m = line.match(ENTER_RE))) {
      const e = parseEffects(m[6]);
      const ctl = m[4] ? (/you control/.test(m[4]) ? 'you' : 'opp') : m[5] ? (m[5] === 'your' ? 'you' : 'opp') : 'any';
      if (e.length) { fx.watch.push({ ev: 'enter', what: m[3].trim(), nontoken: !!m[2], other: /another|other/.test(m[1]) && !m[1].startsWith('~'), ctl, effects: e }); continue; }
    }
    // Looking at and playing from the top of the library
    if (/^(?:you may look at the top card of your library any time|play with the top card of your library revealed)/.test(line)) { fx.seeTop = true; continue; }
    if ((m = line.match(/^you may (?:play lands|cast ([\w ]*?)spells|play the top card of your library|play lands and cast spells) (?:from the top of your library)?/))) {
      fx.seeTop = true;
      fx.playTop = /play the top card|play lands and cast/.test(line) ? 'all' : /play lands/.test(line) ? 'land' : (m[1] || '').trim() || 'spell';
      continue;
    }
    // Static bonuses with a condition: "As long as seven or more cards are in your graveyard, ~ gets +1/+1"
    if ((m = line.match(/^(?:as long as (.+?), )?~ gets \+(\d+)\/\+(\d+)(?: and has ([\w ,]+?))?(?: as long as (.+?))?\.?$/)) && (m[1] || m[5])) {
      fx.condBuff = { cond: parseCond(m[1] || m[5]), p: +m[2], t: +m[3], kw: kwList(m[4]) };
      continue;
    }
    if ((m = line.match(/^(?:as long as (.+?), )?~ has ([\w ,]+?)(?: as long as (.+?))?\.?$/)) && (m[1] || m[3]) && kwList(m[2]).length) {
      fx.condBuff = { cond: parseCond(m[1] || m[3]), p: 0, t: 0, kw: kwList(m[2]) };
      continue;
    }
    // Ragavan and other combat-damage triggers
    if ((m = line.match(/^whenever ~ deals combat damage to a player,? (.*)/))) { fx.combatDamage.push(...parseEffects(m[1])); continue; }
    // Clones: enter as a copy of something on the battlefield
    if ((m = line.match(/^you may have ~ enter(?: the battlefield)? as a copy of (?:any|a|an|target|another) (creature|artifact or enchantment|nonland permanent|artifact|enchantment|equipment)/))) { fx.clone = m[1]; continue; }
    // Cryptolith Rite, Enduring Vitality: every creature taps for mana
    if (/^creatures you control have "\{t\}: add one mana of any color\.?"/.test(line)) { fx.manaAnthem = true; continue; }
    // Kinnan: nonland mana sources make one extra mana
    if (/^whenever you tap a nonland permanent for mana, add one mana of any type that permanent produced/.test(line)) { fx.manaBoost = true; continue; }
    if (/^untap all permanents you control during each other player's untap step/.test(line)) { fx.untapOthers = true; continue; }
    // Necropotence: pay life for cards (modelled as a burst of cards at your end step)
    if (/^pay 1 life: exile the top card of your library face down/.test(line)) { fx.necro = true; continue; }
    if (/^skip your draw step/.test(line)) { fx.skipDraw = true; continue; }
    // Opposition Agent: you control opponents while they search; their tutors come up empty
    if (/^you control your opponents while they're searching their libraries/.test(line)) { fx.searchHate = true; continue; }
    if (/^(?:this spell|~) can't be countered/.test(line)) { fx.uncounterable = true; continue; }
    if (/^spells you control can't be countered/.test(line)) { fx.protectsSpells = true; continue; }
    // Walking Ballista: remove a counter to ping
    if (/^remove a \+1\/\+1 counter from ~: (?:it|~) deals 1 damage to any target/.test(line)) { fx.pingCounters = true; continue; }
    if ((m = line.match(/^creatures can't attack you(?: or planeswalkers you control)? unless their controller pays \{(\d+)\} for each/))) { fx.attackTax = +m[1]; continue; }
    if (/^your opponents can't cast spells from anywhere other than their hands/.test(line)) { fx.handOnly = true; continue; }
    if ((m = line.match(/^flashback ((?:\{[^}]+\})+)/))) { fx.flashback = m[1].toUpperCase(); continue; }
    if ((m = line.match(/^evoke ((?:\{[^}]+\})+)/))) { fx.evoke = m[1].toUpperCase(); continue; }
    // Free spells: Force of Will style pitch costs, or "if you control a commander, ... without paying its mana cost"
    // (cleanText has already turned "this spell" into ~)
    if (/rather than pay (?:this spell|~)['’]s mana cost/.test(line)) {
      fx.altFree = /control a commander/.test(line) ? 'commander' : /exile an? \w+ card from your hand/.test(line) ? 'pitch' : /opponent cast three or more spells this turn/.test(line) ? 'storm3' : null;
      if (fx.altFree) continue;
    }
    if (/^if you control a commander, you may cast (?:this spell|~) without paying its mana cost/.test(line)) { fx.altFree = 'commander'; continue; }
    if ((m = line.match(/^(creature |noncreature |artifact |instant and sorcery |instant |sorcery |enchantment |legendary )?spells you cast cost \{(\d+)\} less to cast/))) {
      fx.costReduce = { what: (m[1] || 'any').trim(), n: +m[2] };
      continue;
    }
    // Marvin, Murderous Mimic and Necrotic Ooze: abilities borrowed from other creatures
    if ((m = line.match(/^~ has all activated abilities of (?:all )?(creatures you control|creature cards in (?:all graveyards|your graveyard)|all creatures|artifacts you control|lands you control)/))) {
      fx.borrow = { from: /graveyard/.test(m[1]) ? (/your/.test(m[1]) ? 'myGy' : 'allGy') : m[1] === 'all creatures' ? 'allCreatures' : m[1].split(' ')[0], sameName: /don't have the same name/.test(line) };
      continue;
    }
    // ---- 1.7.0 statics
    // Granted ward: "other artifacts you control have ward {2}", "commanders you control have ward {2}", "other creatures you control have "ward—pay 2 life.""
    if ((m = line.match(/^(other |each )?([\w ]+?) you control( with counters on them)? (?:have|has) "?ward(?: \{(\d+)\}|—pay (\d+) life)\.?"?\.?$/))) {
      fx.wardGrant = { other: m[1] === 'other ', what: m[2].split(' ').map(singular).join(' '), counters: !!m[3], n: +(m[4] || 0), life: +(m[5] || 0) };
      continue;
    }
    if ((m = line.match(/^ward—\{(\d+)\}, pay (\d+) life\.?$/))) { fx.ward = +m[1]; fx.wardLife = +m[2]; fx.kw.add('ward'); continue; }
    // Tribal lords: "goblins you control have haste", "other elf creatures get +1/+1 and have forestwalk", "all rats have fear"
    if ((m = line.match(/^(other |all )?((?:[\w-]+(?:, and |, | and | ))*?[\w-]+?)( creatures)?( tokens)?( you control)? (have|get \+(\d+)\/\+(\d+)(?: and have)?) ?([\w ,]*?)\.?$/))
      && !/\b(?:creatures?|permanents?|artifacts|lands|enchantments|planeswalkers|spells|players?|opponents?|your|you|each|it|they|that|~|equipped|enchanted|attacking|blocking|tapped|untapped|of|with|the)\b/.test(m[2])) {
      const kws = kwList2(m[9]);
      const rest = (m[9] || '').replace(new RegExp(`\\b(?:${KW2.join('|')})\\b`, 'g'), '').replace(/,|\band\b|\s/g, '');
      if ((m[7] || kws.length) && !rest) {
        const words = m[2].split(/, and |, | and /).map(w => w.split(' ').map(singular).join(' '));
        const single = words.length === 1 && !/[ -]/.test(words[0]) && !['legendary', 'artifact', 'enchantment', 'commander', 'nontoken', 'modified', 'colorless', 'land', 'white', 'blue', 'black', 'red', 'green', 'multicolored'].includes(words[0]);
        const what = m[4] ? words.map(w => w + ' token').join(' or ') : words.join(' or ');
        fx.anthem = { other: !!m[1] && m[1] !== 'all ', tribe: single && !m[4] ? words[0] : null, what: single && !m[4] ? null : what, p: +(m[7] || 0), t: +(m[8] || 0), kw: kws };
        continue;
      }
    }
    if ((m = line.match(/^creatures of the chosen (type|color) (?:get \+(\d+)\/\+(\d+)|have ([\w ,]+?))\.?$/))) { fx.anthem = { other: false, tribe: m[1] === 'type' ? 'chosen' : 'chosenColor', p: +(m[2] || 0), t: +(m[3] || 0), kw: kwList2(m[4]) }; continue; }
    // Locks
    if ((m = line.match(/^(your opponents|players) can't gain life/)) || /^if a player would gain life, that player gains no life instead/.test(line)) { fx.noGain = m?.[1] === 'your opponents' ? 'opp' : 'all'; continue; }
    if ((m = line.match(/^each player can't cast more than one (noncreature )?spell each turn/))) { fx.spellCap = m[1] ? 'noncreature' : 'any'; continue; }
    if (/^each player who has cast a nonartifact spell this turn can't cast additional nonartifact spells/.test(line)) { fx.spellCap = 'nonartifact'; continue; }
    if (/^spells (?:and abilities )?can't be countered/.test(line)) { fx.noCounterAll = true; continue; }
    if (/^(?:combat )?damage can't be prevented|^combat damage that would be dealt by creatures you control can't be prevented/.test(line)) { fx.noPrevent = true; continue; }
    if (/^prevent all damage that would be dealt to you\.?$/.test(line)) { fx.preventMe = true; continue; }
    if ((m = line.match(/^creatures(?: with power (\d+) or greater)? don't untap during their controllers' untap steps/))) { fx.untapLock = { what: 'creature', minPower: m[1] ? +m[1] : 0 }; continue; }
    if ((m = line.match(/^(?:as long as ~ is untapped, )?players can't untap more than one (nonbasic )?land during their untap steps/))) { fx.untapLock = { what: 'land', nonbasic: !!m[1], max: 1, whileUntapped: /untapped,/.test(line) }; continue; }
    if (/^players have no maximum hand size/.test(line)) { fx.noMaxHandAll = true; continue; }
    if ((m = line.match(/^each opponent's maximum hand size is reduced by (\w+)/))) { fx.oppHandLess = num(m[1]); continue; }
    if (/^(?:until end of turn, )?you don't lose unspent red mana as steps and phases end/.test(line)) { fx.keepRed = true; continue; }
    if ((m = line.match(/^(nonbasic lands|artifacts) your opponents control enter(?: the battlefield)? tapped/))) { fx.oppEnterTapped = m[1]; continue; }
    // Alternative costs: Flares (sacrifice a creature), Commandeer (exile two blue cards), Daze (return an Island), Solitude (evoke by exiling a card)
    if ((m = line.match(/^you may sacrifice an? (nontoken )?(white |blue |black |red |green )?creature rather than pay ~'s mana cost/))) { fx.altSac = `${m[1] || ''}${m[2] || ''}creature`; continue; }
    if ((m = line.match(/^you may exile (two|an?) (white|blue|black|red|green) cards? from your hand rather than pay ~'s mana cost/))) { fx.altPitch = { n: num(m[1]), color: COLOR_NAME[m[2]] }; continue; }
    if ((m = line.match(/^you may return an? (island|forest|swamp|mountain|plains|land) you control to its owner's hand rather than pay ~'s mana cost/))) { fx.altBounce = m[1]; continue; }
    if ((m = line.match(/^evoke—exile an? (white|blue|black|red|green) card from your hand/))) { fx.evokePitch = COLOR_NAME[m[1]]; continue; }
    // Cost changes
    if ((m = line.match(/^(colorless |creature |noncreature )?spells you cast with mana value (\d+) or greater cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: (m[1] || 'any').trim(), n: +m[3], minMv: +m[2] }; if (/can't be countered/.test(line)) fx.protectsSpells = true; continue; }
    if ((m = line.match(/^the first (creature |noncreature )?spell you cast each turn costs \{(\d+)\} less to cast/))) { fx.costReduce = { what: (m[1] || 'any').trim(), n: +m[2], first: true }; continue; }
    if ((m = line.match(/^spells you cast from your graveyard( or from exile)? cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: 'any', n: +m[2], from: m[1] ? ['graveyard', 'exile'] : ['graveyard'] }; continue; }
    if ((m = line.match(/^(?:eminence — as long as ~ is in the command zone or on the battlefield, )?other (\w+) spells you cast cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: singular(m[1]), n: +m[2], cmdZone: /eminence/.test(line) }; continue; }
    if ((m = line.match(/^(artifact and enchantment|artifact|enchantment|instant and sorcery) spells your opponents cast cost \{(\d+)\} more to cast/))) { fx.costTax = { what: m[1].replace(' and ', ' or '), n: +m[2], oppOnly: true }; continue; }
    // Power and toughness that count something
    if ((m = line.match(/^~'s (power|toughness|power and toughness)(?: is| are each) equal to (your devotion to \w+|the number of instant and sorcery cards in your graveyard|the greatest mana value among artifacts you control|the number of (\w+)s you control)\.?$/))) {
      fx[m[1] === 'power' ? 'pDyn' : m[1] === 'toughness' ? 'tDyn' : 'ptDyn'] = m[3] ? `${m[3]}s you control` : m[2].replace(/^the number of /, '');
      continue;
    }
    // When it can be cast: Savage Beating, Take the Bait, Berserk
    if ((m = line.match(/^cast ~ only (during combat on your turn|during combat on an opponent's turn|before the combat damage step)/))) { fx.castWhen = { 'during combat on your turn': 'myCombat', "during combat on an opponent's turn": 'oppCombat' }[m[1]] || 'preDamage'; continue; }
    // Boromir, Lavinia, Vexing Bauble: free spells are countered
    if ((m = line.match(/^whenever (an opponent|a player) casts a spell, if no mana was spent to cast it, counter that spell/))) { fx.freeCounter = m[1] === 'a player' ? 'any' : 'opp'; continue; }
    // Graveyard hate: Grafdigger's Cage, Soulless Jailer, Rest in Peace, Leyline-style exile replacement
    if ((m = line.match(/^(creature|permanent) cards in graveyards( and libraries)? can't enter the battlefield/))) { fx.gyLock = { what: m[1], lib: !!m[2] }; continue; }
    if (/^if a card or token would be put into a graveyard from anywhere, exile it instead/.test(line)) { fx.rip = true; continue; }
    if ((m = line.match(/^if a (nontoken )?creature an opponent controls would die, (?:exile it instead|instead exile it(?: and you gain (\d+) life)?)/))) { fx.oppDieExile = { nontoken: !!m[1], gain: +(m[2] || 0) }; continue; }
    // Archetypes: opponents' creatures lose a keyword
    if ((m = line.match(/^creatures your opponents control lose (flying|hexproof|trample) and can't have or gain \1/))) { fx.oppLoseKw = m[1]; continue; }
    if (/^if a source would deal damage to a permanent or player, it deals double that damage to that permanent or player instead/.test(line)) { fx.damageDoubleAll = true; continue; }
    if ((m = line.match(/^if an opponent would mill one or more cards, they mill (twice that many cards|that many cards plus (\w+)) instead/))) { fx.millMore = m[2] ? { plus: num(m[2]) } : { double: true }; continue; }
    if (/^at the beginning of your draw step, draw an additional card/.test(line)) { fx.watch.push({ ev: 'drawStep', effects: [{ k: 'draw', n: 1 }] }); continue; }
    if (/^~ can block only creatures with flying/.test(line)) { fx.blockFlyersOnly = true; continue; }
    if (/^when ~ dies or is put into exile from the battlefield, you may put (?:it|her|him) into (?:its|her|his) owner's library third from the top/.test(line)) { fx.godEternal = true; continue; }
    if (/^when ~ is put into a graveyard from (?:anywhere, shuffle it into its owner's library|the battlefield, its owner shuffles it into their library)/.test(line)) { fx.shuffleOnGy = true; continue; }
    if ((m = line.match(/^when ~ exploits a creature, (.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.exploitFx = e; continue; } }
    // ---- 1.6.0 statics
    // Panharmonicon, Yarok, Roaming Throne: triggered abilities trigger an additional time
    if ((m = line.match(/^if (?:a|an) ([\w ]+?) entering(?: the battlefield)? causes a triggered ability of a permanent you control to trigger, (?:that ability|it) triggers an additional time/))) { fx.trigTwice = { kind: 'enter', what: m[1].replace(/ or /g, ' or ') }; continue; }
    if (/^if a creature attacking causes a triggered ability of a permanent you control to trigger, (?:that ability|it) triggers an additional time/.test(line)) { fx.trigTwice = { kind: 'attack' }; continue; }
    if ((m = line.match(/^if a triggered ability of (a|an|another) ([\w ,-]+?) you control( of the chosen type| with power \d+ or less)? triggers, (?:it|that ability) triggers an additional time/))) {
      fx.trigTwice = { kind: /chosen type/.test(line) ? 'chosen' : 'any', what: descOf(m[2].replace(/^(?:a|an|another) /, '').replace(/ or another /g, ' or ')), with: m[3]?.trim().startsWith('with') ? m[3].trim() : null, other: m[1] === 'another' };
      continue;
    }
    // ---- 1.6.0 second batch
    if ((m = line.match(/^each land is an? (swamp|forest|island|mountain|plains) in addition to its other land types/))) { fx.allLandsAdd = { swamp: 'B', forest: 'G', island: 'U', mountain: 'R', plains: 'W' }[m[1]]; continue; }
    if ((m = line.match(/^(?:\{(\d)\}, )?\{t\}: choose a color\. add an amount of mana of that color equal to your devotion to that color/))) { fx.mana = { amount: 1, colors: ['W', 'U', 'B', 'R', 'G'], sac: false, dyn: 'devotionMax', less: +(m[1] || 0), floor: fx.mana?.amount || 0 }; continue; }
    if ((m = line.match(/^(?:\{(\d)\}, )?\{t\}: choose a creature type\. add an amount of mana of that color equal to the number of creatures you control of the chosen type|^(?:\{(\d)\}, )?\{t\}: choose a color\. add an amount of mana of that color equal to the number of creatures you control of the chosen type/))) { fx.mana = { amount: 1, colors: ['W', 'U', 'B', 'R', 'G'], sac: false, dyn: 'tribeMax', less: +(m[1] || m[2] || 0), floor: fx.mana?.amount || 0 }; continue; }
    if ((m = line.match(/^\{t\}: add \{([wubrgc])\} for each charge counter on ~/))) { fx.mana = { amount: 1, colors: [m[1].toUpperCase()], sac: false, dyn: 'charge' }; continue; }
    if (/^~ enters with a charge counter on it for each time it was kicked/.test(line)) { fx.chargeKick = true; continue; }
    if (/^if ~ would enter, you may discard a land card instead\. if you do, put ~ onto the battlefield/.test(line)) { fx.addCost = { ...parseCostText('discard a land card') }; continue; }
    if (/^at the beginning of your draw step, you may draw two additional cards\. if you do, choose two cards in your hand drawn this turn/.test(line)) { fx.watch.push({ ev: 'drawStep', effects: [{ k: 'scry', n: 2 }] }); continue; }
    if ((m = line.match(/^(?:enchanted|equipped) creature can't be blocked(?: and has ([\w ,]+?))?\.?$/))) { fx.attachBuff = { p: fx.attachBuff?.p || 0, t: fx.attachBuff?.t || 0, kw: [...(fx.attachBuff?.kw || []), 'unblockable', ...kwList(m[1])] }; continue; }
    if ((m = line.match(/^whenever enchanted (?:land|forest|plains|island|swamp|mountain) is tapped for mana, its controller adds an additional (\{[wubrgc]\}|one mana of any color|(?:one )?mana of the chosen color|one mana of any type that land produced)/))) { fx.auraMana = m[1].match(/\{([wubrgc])\}/)?.[1]?.toUpperCase() || '*'; continue; }
    if (/^treasures you control have "\{t\}, sacrifice ~: add two mana of any one color\.?"/.test(line)) { fx.treasureTwo = true; continue; }
    if (/^if a card would be put into an opponent's graveyard from anywhere, instead exile it/.test(line)) { fx.oppGyExile = true; continue; }
    if ((m = line.match(/^spells your opponents cast that target ~ cost an additional (\d+) life to cast/))) { fx.wardLife = +m[1]; continue; }
    if (/^untap ~ during each other player's untap step/.test(line)) { fx.untapSelfOthers = true; continue; }
    if (/^while an opponent is searching their library, they exile each card they find/.test(line)) { if (fx.searchHate) pending = null; fx.searchHate = true; continue; }
    if ((m = line.match(/^(?:metalcraft — )?equipment you control have equip \{0\}(?: as long as you control (\w+) or more artifacts)?/))) { fx.freeEquip = m[1] ? num(m[1]) : 0; continue; }
    if ((m = line.match(/^you may cast ~ from your graveyard(?: or from exile)?(?: as long as (.+?))?\.?$/))) { fx.gyCastSelf = { cond: m[1] ? parseCond(m[1]) : null, exile: /exile/.test(line) }; continue; }
    if ((m = line.match(/^(?:if (.+?), )?you may pay (\d+) life rather than pay ~'s mana cost/))) { fx.altLife = { n: +m[2], cond: m[1] ? parseCond(m[1]) : null }; continue; }
    if ((m = line.match(/^creatures can't attack you(?: or planeswalkers you control)? unless their controller pays \{x\} for each [^,]+, where x is the number of (\w+)s you control/))) { fx.attackTaxDyn = m[1]; continue; }
    if ((m = line.match(/^(creature|noncreature) spells you cast with power (\d+) or greater cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: m[1], n: +m[3], minPower: +m[2] }; continue; }
    if (/^escalate[— ]/.test(line)) { fx.escalate = true; if (fx.modes) fx.modes.n = 1; continue; }
    if (/^enchanted permanent is a colorless land with "\{t\}: add \{c\}" and loses all other card types and abilities/.test(line)) { fx.attachSet = { p: 0, t: 0, land: true }; continue; }
    if ((m = line.match(/^as long as you control (\w+) or more lands, lands you control have "\{t\}: add one mana of any color\.?"/))) { fx.landsAnyColor = true; fx.landsAnyColorN = num(m[1]); continue; }
    if (/^nontoken creatures you control are forest lands in addition to their other types/.test(line)) { fx.manaAnthem = 'G'; continue; }
    if (/^whenever you tap a permanent for \{c\}, add an additional \{c\}/.test(line)) { fx.landBoost = { what: 'permanent', sym: 'C', onlyC: true }; continue; }
    if (/^you may activate abilities of creatures you control as though those creatures had haste/.test(line)) { fx.hasteAbilities = true; continue; }
    if ((m = line.match(/^(other )?(artifacts|enchantments|lands|creatures and planeswalkers|planeswalkers) you control have ([\w ,]+?)\.?$/)) && kwList(m[3]).length) { fx.permAnthem = { other: !!m[1], kw: kwList(m[3]), what: m[2].replace(/s$/, '').replace(/s and /, ' or ') }; continue; }
    if (/^tokens you control have "\{t\}: add \{[wubrgc]\}\.?"/.test(line)) { fx.manaAnthem = 'tokens'; continue; }
    if (/^if ~ would be put into a graveyard from anywhere, reveal ~ and shuffle it into its owner's library instead/.test(line)) { fx.shuffleOnGy = true; continue; }
    if (/^each opponent can't draw more than one card each turn/.test(line)) { fx.drawCap = 1; continue; }
    if ((m = line.match(/^if a (red|white|blue|black|green)? ?source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead/))) { fx.damagePlus = { n: +m[2], color: m[1] ? COLOR_NAME[m[1]] : null }; continue; }
    if ((m = line.match(/^if a source would deal damage to an opponent or a permanent an opponent controls, that source deals double that damage/))) { fx.damageDouble = 2; continue; }
    if ((m = line.match(/^if a source would deal damage to you or a permanent you control, prevent half that damage/))) { fx.halveDamage = true; continue; }
    if ((m = line.match(/^~ has ([\w ,]+?) during your turn\.?$/)) && kwList(m[1]).length) { fx.condBuff = { cond: { c: 'myTurn' }, p: 0, t: 0, kw: kwList(m[1]) }; continue; }
    if ((m = line.match(/^if you tap a permanent for mana, it produces (three times|twice) as much of that mana instead/))) { fx.manaMult = m[1] === 'twice' ? 2 : 3; continue; }
    if (/^you may cast ~ as though it had flash/.test(line)) { fx.kw.add('flash'); continue; }
    if (/^(?:creature and enchantment |creature, enchantment, and planeswalker )?spells you control can't be countered/.test(line)) { fx.protectsSpells = true; continue; }
    if (/^permanents entering don't cause abilities of permanents your opponents control to trigger/.test(line)) { fx.noEtbOpp = true; continue; }
    if ((m = line.match(/^if one or more tokens would be created under your control, those tokens plus that many 1\/1 green squirrel creature tokens are created/))) { fx.extraToken = 'squirrel'; fx.extraTokenOn = 'any'; continue; }
    if (/^the "legend rule" doesn't apply to permanents you control/.test(line)) { fx.noLegendRule = true; continue; }
    if (/^(?:nonartifact )?spells you cast have improvise/.test(line)) { fx.improviseAll = true; continue; }
    if (/^bargain$/.test(line)) { fx.kw.add('bargain'); pending = null; continue; }
    if (/^hideaway lands?|^\{[wubrg]\}, \{t\}: you may play the exiled card without paying its mana cost if /.test(line)) { pending = null; continue; }
    // ---- 1.6.0 third batch
    if (/^at the beginning of your draw step, you may draw two additional cards/.test(line)) { fx.watch.push({ ev: 'drawStep', effects: [{ k: 'scry', n: 2 }] }); continue; }
    if (/^while an opponent is searching their library, they exile each card they find/.test(line)) { fx.searchHate = true; pending = null; continue; }
    if ((m = line.match(/^mobilize (\d+|x)$/))) { fx.attack.push({ k: 'token', n: num(m[1]) === 'X' ? 1 : num(m[1]), p: 1, t: 1, desc: 'red warrior', kw: [], attacking: true, temp: true }); fx.kw.add('mobilize'); continue; }
    if ((m = line.match(/^when you play another land,? (.*)/))) { const e = parseEffects(m[1]); if (e.length) { fx.watch.push({ ev: 'landPlay', who: 'you', other: true, effects: e }); continue; } }
    if (/^each opponent can cast spells only any time they could cast a sorcery/.test(line)) { fx.oppSorcery = true; continue; }
    if ((m = line.match(/^you, planeswalkers you control, and other creatures you control have (hexproof|shroud)/))) { fx.permAnthem = { other: true, kw: [m[1]], what: 'creature or planeswalker' }; fx.hexPlayer = true; continue; }
    if (/^whenever a creature you control without flying dies, return it to the battlefield under its owner's control with a flying counter on it/.test(line)) { fx.onDeath = { who: 'yours', other: false, nontoken: false, what: null, without: 'flying', effects: [{ k: 'returnTrig', kw: 'flying' }] }; continue; }
    if ((m = line.match(/^(?:as long as ~ is tapped, )?no more than (one|two|three) creatures? can attack you each combat/))) { fx.attackMeCap = { n: num(m[1]), tapped: /tapped/.test(line) }; continue; }
    if (/^if an opponent would draw a card except the first one they draw in each of their draw steps, instead that player skips that draw and you draw a card/.test(line)) { fx.notionThief = true; continue; }
    if ((m = line.match(/^if one or more tokens would be created, twice that many of those tokens are created instead/))) { fx.tokenBonusAll = true; continue; }
    if ((m = line.match(/^if one or more \+1\/\+1 counters would be put on a creature, twice that many/))) { fx.counterBonusAll = true; continue; }
    if (/^you may spend mana as though it were mana of any color(?: to cast| to activate|\.|$)/.test(line) && !/abilities of creatures/.test(line)) { fx.anyColorSpend = true; continue; }
    if (/^whenever a permanent you control enters tapped, untap it/.test(line)) { fx.landsUntapped = 'all'; continue; }
    if ((m = line.match(/^~ can't attack or block unless (.+?)\.?$/))) { fx.attackCond = parseCond(m[1]); continue; }
    if ((m = line.match(/^if a card you didn't control would be put into an opponent's graveyard from anywhere, exile it instead/))) { fx.oppGyExile = true; continue; }
    if ((m = line.match(/^(\w+)s you control get \+(\d+)\/\+(\d+) as long as (.+?)\.?$/))) { fx.anthem = { other: false, tribe: m[1], p: +m[2], t: +m[3], kw: [], cond: parseCond(m[4]) }; continue; }
    if ((m = line.match(/^\{t\}: choose a color\. add one mana of that color for each charge counter on ~/))) { fx.mana = { amount: 1, colors: ['W', 'U', 'B', 'R', 'G'], sac: false, dyn: 'charge' }; continue; }
    if ((m = line.match(/^(other )?(non-[\w]+ |[\w]+ )?creatures you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,{}]+?))?\.?$/))) {
      const tribe = (m[2] || '').trim() || null;
      const typeWord = tribe && (['legendary', 'artifact', 'enchantment', 'nontoken'].includes(tribe) || tribe.startsWith('non-'));
      fx.anthem = { other: !!m[1], tribe: tribe && !typeWord ? tribe : null, what: typeWord ? tribe : null, p: +m[3], t: +m[4], kw: kwList(m[5]) };
      continue;
    }
    if ((m = line.match(/^each creature you control with a \+1\/\+1 counter on it has ([\w ,]+?)\.?$/)) && kwList(m[1]).length) { fx.anthem = { other: false, tribe: null, desc: 'with +1/+1 counters on them', p: 0, t: 0, kw: kwList(m[1]) }; continue; }
    if (/^all creatures have haste/.test(line)) { fx.hasteAll = true; continue; }
    if ((m = line.match(/^choose (three|two|four)\. you may choose the same mode more than once\.?$/))) {
      const bullets = [];
      while (lines[li + 1]?.startsWith('•')) bullets.push(parseEffects(lines[++li].slice(1)));
      const modal = { n: num(m[1]), modes: bullets.filter(b => b.length) };
      if (type.instant || type.sorcery) fx.modes = modal; else fx.etbModes = modal;
      continue;
    }
    if (/^creature tokens you control have "\{t\}: add one mana of any color\.?"/.test(line)) { fx.manaAnthem = 'tokensAny'; continue; }
    if ((m = line.match(/^you may pay ((?:\{[^}]+\})+) rather than pay ~'s mana cost\.?$/))) { fx.altMana = m[1].toUpperCase(); continue; }
    if ((m = line.match(/^~ costs \{x\} less to cast, where x is the greatest number of (\w+)s an opponent controls/))) { fx.selfReduce = { n: 1, dyn: { dyn: 'oppMax', what: m[1] } }; continue; }
    // ---- 1.6.0 fourth batch
    if (/^nonbasic lands are mountains/.test(line)) { fx.bloodMoon = true; continue; }
    if ((m = line.match(/^spells cost \{(\d+)\} less to cast/))) { fx.costReduceAll = +m[1]; continue; }
    if ((m = line.match(/^each spell costs \{(\d+)\} more to cast except during its controller's turn/))) { fx.costTax = { what: 'any', n: +m[1], offTurn: true }; continue; }
    if ((m = line.match(/^spells your opponents cast from graveyards or from exile cost \{(\d+)\} more to cast/))) { fx.costTax = { what: 'any', n: +m[1], oppOnly: true, fromGyExile: true }; continue; }
    if (/^you can't lose the game and your opponents can't win the game/.test(line)) { fx.cantLose = true; continue; }
    if (/^you have hexproof/.test(line)) { fx.hexPlayer = true; continue; }
    if (/^your maximum hand size is (?:twenty|\d+)/.test(line)) { fx.noMaxHand = true; continue; }
    if ((m = line.match(/^if you tap a permanent for (?:mana|~), it produces (twice|three times) as much of that mana instead/))) { fx.manaMult = m[1] === 'twice' ? 2 : 3; continue; }
    if (/^if a creature you control would deal damage to a permanent or player, it deals double that damage instead/.test(line)) { fx.damageDouble = 2; fx.damageAny = true; fx.creatureDamageOnly = true; continue; }
    if ((m = line.match(/^(\w+)s you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+?))?\.?$/))) { fx.anthem = { other: false, tribe: m[1], p: +m[2], t: +m[3], kw: kwList(m[4]) }; continue; }
    if ((m = line.match(/^if one or more artifact tokens would be created under your control, those tokens plus an additional (\d)\/(\d) (?:colorless )?(\w+) artifact creature token with (\w+) are created/))) { fx.extraToken = m[3]; fx.extraTokenOn = 'artifact'; fx.extraTokenStats = { p: +m[1], t: +m[2], kw: [m[4]] }; continue; }
    if ((m = line.match(/^(\w+)s you control and other (\w+)s you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+?))?\.?$/))) { fx.anthem = { other: true, tribe: null, what: `${m[1]} or ${m[2]}`, p: +m[3], t: +m[4], kw: kwList(m[5]) }; continue; }
    if ((m = line.match(/^each (legendary|nontoken|artifact) creature you control gets \+(\d+)\/\+(\d+)\.?$/))) { fx.anthem = { other: false, tribe: null, what: m[1], p: +m[2], t: +m[3], kw: [] }; continue; }
    if (/^(?:green|blue|red|white|black) spells you control can't be countered/.test(line)) { fx.protectsSpells = true; continue; }
    if (/^equipped creature has "\{t\}: add one mana of any color\.?"/.test(line)) { fx.attachMana = true; continue; }
    if (/^enchanted permanent is a colorless forest land/.test(line)) { fx.attachSet = { p: 0, t: 0, land: true }; continue; }
    if (/^if one or more creature tokens would be created under your control, that many 4\/4 white angel creature tokens with flying(?: and vigilance)? are created instead/.test(line)) { fx.tokenAngel = true; continue; }
    if (/^creatures can't attack you or planeswalkers you control unless their controller pays \{w\/p\} for each/.test(line)) { fx.attackTax = 1; continue; }
    if (/^as long as ~ is equipped, if a triggered ability of ~ or an equipment attached to it triggers, that ability triggers an additional time/.test(line)) { fx.trigTwice = { kind: 'self' }; continue; }
    // Replacement effects ("if you would …, … instead")
    if ((m = line.match(/^if you would gain life, you gain that much life plus (\d+) instead/))) { fx.lifePlus = +m[1]; continue; }
    if ((m = line.match(/^if (?:you would put one or more counters on (?:a permanent or player|a creature or planeswalker you control or on yourself|a permanent)|an effect would put one or more counters on a permanent you control|one or more counters would be put on (?:a creature|a permanent|an artifact or creature) you control), (?:it puts |put )?(twice that many|that many plus one)/))) { fx.counterBonus = m[1].startsWith('twice') ? 'double' : 'plus'; fx.counterAny = true; continue; }
    if (/^if you would get one or more counters, you get that many plus one/.test(line)) { fx.playerCounterPlus = true; continue; }
    if ((m = line.match(/^if you would create (?:one or more )?(treasure|artifact|clue|food|a clue, food, or treasure) tokens?, instead create (?:those tokens plus an additional (\w+) token|one of each)/))) { fx.extraToken = m[2] || 'treasure'; fx.extraTokenOn = m[1]; continue; }
    if ((m = line.match(/^if one or more tokens would be created under your control, those tokens plus an additional (\w+) token are created/))) { fx.extraToken = m[1]; fx.extraTokenOn = 'any'; continue; }
    if (/^if you would draw a card except the first one you draw in each of your draw steps, draw two cards instead/.test(line)) { fx.drawDouble = true; continue; }
    if (/^if you would proliferate, proliferate twice instead/.test(line)) { fx.proliferateTwice = true; continue; }
    if (/^if you would copy a spell one or more times, instead copy it that many times plus an additional time/.test(line)) { fx.copyPlus = true; continue; }
    if (/^if you would draw a card, instead look at the top three cards of your library, then put one into your hand and the rest into your graveyard/.test(line)) { fx.lichDraw = true; continue; }
    if (/^if you would draw a card, you may instead choose land or nonland/.test(line)) { fx.abundance = true; continue; }
    if (/^if an opponent would lose life during your turn, they lose twice that much life instead/.test(line)) { fx.lossDouble = true; continue; }
    if ((m = line.match(/^if a source you control would deal noncombat damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead/))) { fx.burnPlus = +m[1]; continue; }
    // Cost reductions by color and other words: "blue spells you cast cost {1} less", "each spell you cast that's red or green costs {1} less"
    if ((m = line.match(/^((?:[a-z-]+(?:,? (?:and|or) |, | ))*?)spells you cast(?: that are [\w ]+| from exile| of the chosen type)? cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: /chosen type/.test(line) ? 'chosen' : m[1].trim().replace(/ and /g, ' or ') || 'any', n: +m[2] }; continue; }
    if ((m = line.match(/^each spell you cast that's ([\w ]+?) costs \{(\d+)\} less to cast/))) { fx.costReduce = { what: m[1], n: +m[2] }; continue; }
    if ((m = line.match(/^creature spells (?:you cast )?of the chosen type cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: 'chosen', n: +m[1] }; continue; }
    if ((m = line.match(/^~ costs \{x\} less to cast, where x is (the greatest power among creatures you control|the number of ([\w ]+?) (?:you control|in your graveyard|on the battlefield)|the total power of creatures you control|your devotion to (\w+))/))) {
      fx.selfReduce = { n: 1, dyn: m[1].startsWith('the greatest power') ? { dyn: 'maxPower' } : m[1].startsWith('the total power') ? { dyn: 'totalPower' } : m[3] ? { dyn: 'devotion', color: COLOR_NAME[m[3]] } : { dyn: 'countWhere', what: m[2].replace(/s$/, ''), where: /graveyard/.test(m[1]) ? 'gy' : /battlefield/.test(m[1]) ? 'all' : 'you' } };
      continue;
    }
    // Activated abilities cost less, or can't be activated
    if ((m = line.match(/^activated abilities of (creatures|artifacts|lands|planeswalkers|artifacts and creatures) you control cost \{(\d+)\} less to activate/))) { fx.abilityReduce = { what: m[1].replace(/s$/, '').replace(/s and /, ' or '), n: +m[2] }; continue; }
    if ((m = line.match(/^activated abilities of (creatures|artifacts|artifacts and creatures|nonland permanents|artifacts, creatures, and enchantments)( your opponents control)? can't be activated/))) { fx.abilityLock = { what: m[1], opp: !!m[2] }; continue; }
    // Zirda, the Dawnwaker: every ability you activate that isn't a mana ability (equip included)
    if ((m = line.match(/^abilities you activate that aren't mana abilities cost \{(\d+)\} less to activate/))) { fx.abilityReduce = { what: 'any', n: +m[1], nonMana: true }; continue; }
    // Power Artifact: the enchanted artifact's activated abilities
    if ((m = line.match(/^enchanted (?:artifact|permanent|creature)'s activated abilities cost \{(\d+)\} less to activate/))) { fx.attachReduce = +m[1]; continue; }
    // Vizier of Remedies: one fewer -1/-1 counter on your creatures
    if (/^if one or more -1\/-1 counters would be put on a creature you control, that many -1\/-1 counters minus one are put on it instead/.test(line)) { fx.minusLess = true; continue; }
    // Rings of Brighthearth: pay {2} to copy an activated ability that isn't a mana ability
    if (/^whenever you activate an ability, if it isn't a mana ability, you may pay \{2\}\. if you do, copy that ability/.test(line)) { fx.copyAbility = true; continue; }
    // A companion's deck-building condition (it plays as a normal card here)
    if (/^(?:companion — )?each (?:permanent )?card in your starting deck /.test(line)) { pending = null; continue; }
    // Power and toughness from counts the engine knows (Tarmogoyf and friends)
    if ((m = line.match(/^~'s power(?: and toughness are each| is) equal to (1 plus )?(?:the number of )?(cards in your opponents' graveyards|card types among cards in all graveyards|card types among cards in your opponents' graveyards|creatures on the battlefield|creature cards in all graveyards|lands on the battlefield|cards in all players' hands|artifacts and enchantments you control|cards in your library)(?: and its toughness is equal to that number plus 1)?\.?$/))) {
      fx[/toughness are each|toughness is equal/.test(line) ? 'ptDyn' : 'pDyn'] = (m[1] ? '1+' : '') + m[2];
      continue;
    }
    // Conditional equipment and auras: "As long as equipped creature is legendary, it has hexproof"
    if ((m = line.match(/^as long as (?:equipped|enchanted) creature is (legendary|an? [\w-]+), it (?:gets ([+-]\d+)\/([+-]\d+)(?: and has ([\w ,{}]+?))?|has ([\w ,{}]+?))\.?$/))) {
      fx.attachBuff2 = { needs: m[1].replace(/^an? /, ''), p: +(m[2] || 0), t: +(m[3] || 0), kw: kwList(m[4] || m[5]) };
      continue;
    }
    if ((m = line.match(/^as long as (.+?), (?:~|it) (?:gets \+(\d+)\/\+(\d+)(?: and has ([\w ,]+?))?|has ([\w ,]+?))\.?$/)) && (m[2] || kwList(m[5]).length)) {
      fx.condBuff = { cond: parseCond(m[1]), p: +(m[2] || 0), t: +(m[3] || 0), kw: kwList(m[4] || m[5]) };
      continue;
    }
    if ((m = line.match(/^as long as (.+?), (other )?creatures you control have ([\w ,]+?)\.?$/)) && kwList(m[3]).length) { fx.anthem = { other: !!m[2], tribe: null, p: 0, t: 0, kw: kwList(m[3]), cond: parseCond(m[1]) }; continue; }
    // Anthems with filters: chosen color, with flying, enchanted or equipped, with counters; and negative ones
    if ((m = line.match(/^(other )?creatures you control (of the chosen color|with flying|with \+1\/\+1 counters on them|that are enchanted or equipped|that are (\w+) and\/or tokens|with power (\d+) or less)? ?(?:also )?get ([+-]\d+)\/([+-]\d+)(?: and have ([\w ,]+?))?(?: as long as you control (\w+) or more creatures)?\.?$/))) {
      const f = m[2] || '';
      fx.anthem = { other: !!m[1], tribe: /chosen color/.test(f) ? 'chosenColor' : null, desc: /chosen color/.test(f) ? null : f || null, p: +m[5], t: +m[6], kw: kwList(m[7]), cond: m[8] ? { c: 'control', n: num(m[8]), what: 'creature' } : undefined };
      continue;
    }
    if ((m = line.match(/^creatures you control (also )?(?:get \+(\d+)\/\+(\d+) and )?have ([\w ]+?) as long as you control (\w+) or more creatures\.?$/))) { fx.anthem = { other: false, tribe: null, p: +(m[2] || 0), t: +(m[3] || 0), kw: kwList(m[4]), cond: { c: 'control', n: num(m[5]), what: 'creature' } }; continue; }
    if ((m = line.match(/^(other )?creatures you control (that are enchanted or equipped|with \+1\/\+1 counters on them|with flying) have ([\w ,]+?)\.?$/)) && kwList(m[3]).length) { fx.anthem = { other: !!m[1], tribe: null, desc: m[2], p: 0, t: 0, kw: kwList(m[3]) }; continue; }
    if ((m = line.match(/^(other )?creatures you control have (myriad|riot|exalted|melee|undying|persist|prowess|training|mentor)\.?$/))) { fx.anthem = { other: !!m[1], tribe: null, p: 0, t: 0, kw: [m[2]] }; continue; }
    if ((m = line.match(/^nontoken creatures you control have riot/))) { fx.teamRiot = true; continue; }
    if ((m = line.match(/^(other )?permanents you control have ([\w ,]+?)\.?$/)) && kwList(m[2]).length) { fx.permAnthem = { other: !!m[1], kw: kwList(m[2]) }; continue; }
    if ((m = line.match(/^creatures you control with (power or toughness|power|toughness) (\d+) or less can't be blocked(?: by creatures with power (\d+) or greater)?/))) { fx.smallEvasion = { n: +m[2], by: m[3] ? +m[3] : 0, pw: /power/.test(m[1]), tough: /toughness/.test(m[1]) }; continue; }
    if (/^creatures you control with \+1\/\+1 counters on them can't be blocked/.test(line)) { fx.counterEvasion = true; continue; }
    if (/^creatures you control can't attack/.test(line)) { fx.noAttack = true; continue; }
    if ((m = line.match(/^creatures with power less than ~'s power can't block creatures you control/))) { fx.bullyEvasion = true; continue; }
    if ((m = line.match(/^each creature you control with a counter on it has "\{t\}: add (\{[wubrgc]\}|one mana of any color)\.?"/))) { fx.manaAnthem = 'counters'; continue; }
    if (/^creatures you control have "\{t\}: add one mana of any color\. spend this mana only to cast a creature spell\.?"|^creatures you control have vigilance and "\{t\}: add one mana of any color/.test(line)) { fx.manaAnthem = true; if (/vigilance/.test(line)) fx.anthem = { other: false, tribe: null, p: 0, t: 0, kw: ['vigilance'] }; continue; }
    // Land drops, untapping, entering
    if (/^lands you control enter untapped/.test(line)) { fx.landsUntapped = true; continue; }
    if (/^each player may play an additional land on each of their turns/.test(line)) { fx.extraLandsAll = 1; continue; }
    if (/^~ doesn't untap during your untap step/.test(line)) { fx.noUntap = true; continue; }
    if (/^untap all (?:artifacts|creatures|lands|permanents|nonland permanents) you control during each other player's untap step/.test(line)) { fx.untapOthers = true; continue; }
    if ((m = line.match(/^each other creature you control (?:of the chosen type |that's a [\w ]+ )?enters with an additional \+1\/\+1 counter on it/))) { fx.teamCounter = /chosen type/.test(line) ? 'chosen' : 'any'; continue; }
    if (/^no more than one creature can attack each combat/.test(line)) { fx.attackCap = 1; continue; }
    if (/^players can't cast spells from graveyards or libraries/.test(line)) { fx.handOnly = true; continue; }
    if (/^~ can't attack or block unless you have the city's blessing/.test(line)) { fx.needsBlessing = true; continue; }
    if (/^prevent all (?:combat )?damage that would be dealt to attacking creatures you control/.test(line)) { fx.protectAttackers = true; continue; }
    // Auras that turn a creature into something small: "enchanted creature loses all abilities and is a … 3/3"
    if ((m = line.match(/^enchanted creature (?:loses all abilities and )?is an? [\w ]*?creature with base power and toughness (\d+)\/(\d+)/))) { fx.attachSet = { p: +m[1], t: +m[2] }; continue; }
    // Mana abilities that count something
    if (/^\{t\}: for each color among permanents you control, add one mana of that color/.test(line)) { fx.mana ||= { amount: 1, colors: ['W', 'U', 'B', 'R', 'G'], sac: false, dyn: 'colors' }; continue; }
    if ((m = line.match(/^(?:\{(\d)\}, )?\{t\}: choose a color\. add an amount of mana of that color equal to your devotion to that color/))) { fx.mana ||= { amount: 1, colors: ['W', 'U', 'B', 'R', 'G'], sac: false, dyn: 'devotionMax', less: +(m[1] || 0) }; continue; }
    // "{2}{R}, Discard ~: …" abilities used from the hand (like channel)
    if ((m = line.match(/^((?:\{[^}]+\})+), discard ~: (.*)/))) { const e = parseEffects(m[2]); if (e.length) { fx.channel = { cost: m[1].toUpperCase(), effects: e }; continue; } }
    // Clones of lands
    if ((m = line.match(/^you may have ~ enter(?: the battlefield)?(?: tapped)? as a copy of (?:any|a) land(?: on the battlefield)?/))) { fx.clone = 'land'; continue; }
    // ---- 1.5.2 statics
    // Anthems with a condition: "As long as ~ has seven or more quest counters on it, creatures you control get +5/+5"
    if ((m = line.match(/^as long as (.+?), (other )?creatures you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+))?\.?$/))) { fx.anthem = { other: !!m[2], tribe: null, p: +m[3], t: +m[4], kw: kwList(m[5]), cond: parseCond(m[1]) }; continue; }
    if ((m = line.match(/^(other )?creature tokens you control have ([\w ,]+?)\.?$/)) && kwList(m[2]).length) { fx.anthem = { other: !!m[1], tribe: 'token', p: 0, t: 0, kw: kwList(m[2]) }; continue; }
    // Elesh Norn-style: opponents' creatures get -N/-N
    if ((m = line.match(/^creatures your opponents control get -(\d+)\/-(\d+)\.?$/))) { fx.oppAnthem = { p: -m[1], t: -m[2] }; continue; }
    // Thalia, Sphere of Resistance: spells cost more
    if ((m = line.match(/^(noncreature |creature |artifact |instant and sorcery |)spells(?: your opponents cast| players cast)? cost \{(\d+)\} more to cast/))) { fx.costTax = { what: m[1].trim() || 'any', n: +m[2], oppOnly: /opponents/.test(line) }; continue; }
    if ((m = line.match(/^~ enters(?: the battlefield)? with (\w+) (\w+) counters? on it\.?$/)) && m[2] !== '+1/+1') { fx.entersNamed = { kind: m[2], n: num(m[1]) }; continue; }
    if (/^spree$/.test(line)) { fx.spree = []; continue; }
    if (fx.spree && (m = line.match(/^\+ ((?:\{[^}]+\})+) — (.*)/))) { const e = parseEffects(m[2]); if (e.length) fx.spree.push({ cost: m[1].toUpperCase(), effects: e, text: m[2] }); continue; }
    // ---- 1.5.1 statics from the card scan
    // Deck-building rules and pairing keywords: nothing to do once the game has started
    if (/^(?:choose a background|partner(?: with [^.]*)?|friends forever|doctor's companion|a deck can have any number of cards named ~|a deck can have up to \w+ cards named ~|companion — .*)\.?$/.test(line)) { pending = null; continue; }
    // Leylines: "If ~ is in your opening hand, you may begin the game with it on the battlefield"
    if (/^if ~ is in your opening hand(?: and you're not the starting player)?, you may begin the game with (?:it|~) on the battlefield/.test(line)) { fx.leyline = true; continue; }
    if (/^rebound$/.test(line)) { fx.rebound = true; continue; }
    if ((m = line.match(/^(other )?creature tokens you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+))?\.?$/))) { fx.anthem = { other: !!m[1], tribe: 'token', p: +m[2], t: +m[3], kw: kwList(m[4]) }; continue; }
    if (/^creatures you control are every creature type/.test(line)) { fx.allTypesTeam = true; fx.allTypes = true; continue; }
    if (/^~ is every creature type|^~ is the chosen type in addition/.test(line)) { fx.allTypes = true; continue; }
    if (/^lands you control are every basic land type in addition to their other types/.test(line)) { fx.landsAnyColor = true; continue; }
    // Anger, Wonder, Brawn: from the graveyard, with a land of the right type
    if ((m = line.match(/^as long as ~ is in your graveyard and you control an? (plains|island|swamp|mountain|forest), creatures you control have ([\w ,]+?)\.?$/))) { fx.gyAnthem = { land: m[1], kw: kwList(m[2]) }; continue; }
    if (/^if an opponent would begin an extra turn, that player skips that turn instead/.test(line)) { fx.noExtraTurns = true; continue; }
    // Teysa Karlov, Drivnod: death triggers happen twice
    if (/^if a creature dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time/.test(line)) { fx.deathTwice = true; continue; }
    // Utopia Sprawl, Wild Growth: the enchanted land makes one more
    if ((m = line.match(/^whenever enchanted land is tapped for mana, its controller adds an additional (\{[wubrgc]\}|one mana of any color|mana of the chosen color)/))) { fx.auraMana = m[1].match(/\{([wubrgc])\}/)?.[1]?.toUpperCase() || '*'; continue; }
    if (/^(?:creature )?spells you control can't be countered|^creature spells you control can't be countered/.test(line)) { fx.protectsSpells = true; continue; }
    if ((m = line.match(/^if an effect would create one or more tokens under your control, it creates (twice that many|that many plus one)/))) { fx.tokenBonus = m[1].startsWith('twice') ? 'double' : 'plus'; continue; }
    if (/^when ~ enters, you may exile an? [\w, ]*card from your hand/.test(line)) { fx.imprint = true; continue; }
    // ---- 1.5.0 statics from the card scan
    if ((m = line.match(/^as ~ enters(?: the battlefield)?, (?:you may )?choose (a color|a player|an opponent|a card type|a nonland card name|a card name|a number|[\w ,]+? or [\w ]+)/))) { fx.chooses = m[1]; continue; }
    if (/^lands you control have "\{t\}: add one mana of any color\.?"/.test(line)) { fx.landsAnyColor = true; continue; }
    if ((m = line.match(/^(?:artifacts, )?(creatures|creatures and nonbasic lands|artifacts and creatures|permanents) your opponents control enter(?: the battlefield)? tapped/))) { fx.oppEnterTapped = m[1]; continue; }
    if ((m = line.match(/^~ costs \{(\d+)\} less to cast for each ([\w ]+?)(?: on the battlefield| you control| in your graveyard| your opponents control| card in your graveyard)?\.?$/))) { fx.selfReduce = { n: +m[1], each: m[2].replace(/s$/, ''), where: /graveyard/.test(line) ? 'gy' : /on the battlefield/.test(line) ? 'all' : /opponents/.test(line) ? 'opp' : 'you' }; continue; }
    if ((m = line.match(/^~ costs \{(\d+)\} less to cast if (.+?)\.?$/))) { fx.selfReduce = { n: +m[1], cond: parseCond(m[2]) }; continue; }
    if ((m = line.match(/^~ gets \+(\d+)\/\+(\d+) for each (other )?([\w ]+?) (you control|on the battlefield|in your graveyard|card in your graveyard)\.?$/))) { fx.eachBuff = { p: +m[1], t: +m[2], other: !!m[3], what: m[4].replace(/s$/, '').replace(/ card$/, ''), where: m[5] }; continue; }
    if ((m = line.match(/^whenever (?:you tap|a player taps) an? (land|swamp|forest|island|mountain|plains|creature|permanent|nonland permanent) for mana, (?:that player |its controller )?adds? (?:an additional |one additional |one )?(\{[wubrgc]\}|mana of any type that [\w ]+ produced|one mana of any color|mana of any type that land produced)/))) { fx.landBoost = { what: m[1], sym: m[2].match(/\{([wubrgc])\}/)?.[1]?.toUpperCase() || null }; continue; }
    if (/^if you would draw a card while your library has no cards in it, you win the game instead/.test(line)) { fx.labMan = true; continue; }
    if ((m = line.match(/^if a source you control would deal damage to (an opponent or a permanent an opponent controls|a permanent or player), it deals (double|triple) that damage/))) { fx.damageDouble = m[2] === 'triple' ? 3 : 2; fx.damageAny = m[1] === 'a permanent or player'; continue; }
    if (/^during your turn, your opponents can't cast spells/.test(line)) { fx.noCastMyTurn = true; continue; }
    if (/^~ attacks each (?:combat|turn) if able/.test(line)) { fx.mustAttack = true; continue; }
    if ((m = line.match(/^(?:creature )?spells you cast of the chosen type cost \{(\d+)\} less to cast/))) { fx.costReduce = { what: 'chosen', n: +m[1] }; continue; }
    if (/^if you would gain life, you gain twice that much life instead/.test(line)) { fx.lifeDouble = true; continue; }
    if (/^your opponents can't cast spells (?:during your turn|or activate abilities of artifacts, creatures, or enchantments during your turn)/.test(line)) { fx.noCastMyTurn = true; continue; }
    if (/^ascend$/.test(line)) { fx.ascend = true; continue; }
    if (/^imprint — when ~ enters, you may exile/.test(line)) { fx.imprint = true; continue; }
    if ((m = line.match(/^as long as your devotion to ([\w ]+?) is less than (\w+), ~ isn't a creature/))) {
      fx.godDevotion = { colors: m[1].split(/ and /).map(c => COLOR_NAME[c]).filter(Boolean), n: num(m[2]) };
      continue;
    }
    // Lands that enter tapped unless a condition holds (check lands, shock lands, fast lands): the simulator
    // lets them in untapped, which is how they're played most of the time
    if (type.land && /^(?:~ enters(?: the battlefield)? tapped unless|as ~ enters(?: the battlefield)?, you may (?:pay \d+ life|reveal)|if you control two or more other lands, ~ enters tapped)/.test(line)) { pending = null; continue; }
    if (/^you have no maximum hand size/.test(line)) { fx.noMaxHand = true; continue; }
    if ((m = line.match(/^you may play (an additional land|two additional lands|any number of lands) on each of your turns/))) { fx.extraLands = m[1] === 'an additional land' ? 1 : m[1].startsWith('two') ? 2 : 9; continue; }
    // "As ~ enters, choose a creature type": the type that matters most in the deck (see Game.entered)
    if (/^as ~ enters(?: the battlefield)?, choose a creature type/.test(line)) { fx.chooseType = true; continue; }
    // Doubling Season, Anointed Procession, Parallel Lives: more tokens
    if ((m = line.match(/^if (?:one or more )?(?:creature )?tokens would be created under your control, (twice that many|that many plus one|three times that many)/))) { fx.tokenBonus = m[1].startsWith('twice') ? 'double' : m[1].startsWith('three') ? 'triple' : 'plus'; continue; }
    // Power and toughness that count something (Multani, Molimo, Psychosis Crawler)
    if ((m = line.match(/^~'s power and toughness are each equal to (?:the number of )?(cards in your hand|lands you control|creatures you control|artifacts you control|cards in your graveyard|creature cards in your graveyard|cards in all graveyards|your devotion to \w+)/))) { fx.ptDyn = m[1]; continue; }
    if ((m = line.match(/^~'s power is equal to (?:the number of )?(cards in your hand|lands you control|creatures you control|artifacts you control|cards in your graveyard|creature cards in your graveyard)/))) { fx.pDyn = m[1]; continue; }
    // Eldrazi: "When you cast ~, …" happens on casting, even if the spell is countered
    if ((m = line.match(/^when you cast ~,? (.*)/))) { const e = parseEffects(m[1]); if (e.length) fx.castSelf = e; continue; }
    if (/~ can't be blocked/.test(line)) fx.kw.add('unblockable');
    if (/^~ can't block/.test(line)) fx.kw.add('cantblock');
    if (/~ enters(?: the battlefield)? tapped/.test(line) && !/unless|you may pay|if you control/.test(line)) fx.entersTapped = true;
    if ((m = line.match(/^~ enters(?: the battlefield)? with (x|\d+|a|an|one|two|three|four|five|six|seven) \+1\/\+1 counters? on it/))) fx.entersCounters = num(m[1]);
    if (/you may exile an instant card [^.]*from your hand/.test(line)) fx.imprint = true;
    if ((m = line.match(/^(?:when|whenever) ~ enters(?: the battlefield)?(?: or attacks)?(?: and whenever [^,]+)?,? (.*)/))) {
      fx.etb.push(...parseEffects(m[1]));
      if (/or attacks/.test(line)) fx.attack.push(...parseEffects(m[1]));
      continue;
    }
    // Aristocrat-style watchers: "Whenever ~ or another creature you control dies, ..."
    if ((m = line.match(/^whenever (~ or )?(another |one or more other |one or more )?(?:a |an )?(nontoken )?([\w -]*?creature(?: or planeswalker)?|[a-z]+)s? (you control |an opponent controls |your opponents control |you don't control )?(?:dies|die|is put into a graveyard from the battlefield),? (.*)/)) && m[4] !== 'land') {
      const effects = parseEffects(m[6]);
      const what = m[4].replace(/ or planeswalker$/, '').replace(/^creature$/, '').replace(/ creature$/, '').trim() || null;
      if (effects.length) {
        fx.onDeath = { who: /you control/.test(m[5] || '') ? 'yours' : m[5] ? 'opponents' : 'any', other: !!(m[1] || m[2]), nontoken: !!m[3], what, effects };
        if (m[1]) fx.dies.push(...effects);
        continue;
      }
    }
    // "Whenever a creature or artifact you control is put into a graveyard from the battlefield / leaves the battlefield / is exiled"
    if ((m = line.match(LEAVE_RE))) {
      const effects = parseEffects(m[7]);
      const ctl = m[5] ? (/you control/.test(m[5]) && !/don't/.test(m[5]) ? 'you' : 'opp') : 'any';
      if (effects.length) { fx.watch.push({ ev: 'leaveBf', other: /another/.test(m[1]) || !!m[2], nontoken: !!m[3], what: descOf(m[4].replace(/ and\/or /g, ' or ')), ctl, toGy: /graveyard/.test(m[0]), exiled: /exiled/.test(m[0]), noDie: !!m[6], once: m[1] === 'one or more', effects }); continue; }
    }
    // Sacrifice outlets: "Sacrifice a creature: ..." with an optional mana/tap cost first
    if ((m = line.match(/^((?:\{[^}]+\})*)(?:,? ?pay \d+ life)?,? ?sacrifice (a|another) (creature|artifact|permanent|nontoken creature)[^:]*: (.*)/))) {
      fx.sacOutlet = { cost: m[1].replace(/\{t\}/g, ''), tap: /\{t\}/.test(m[1]), other: m[2] === 'another', what: m[3].replace('nontoken ', ''), effects: parseEffects(m[4]), mana: /^add /.test(m[4]), text: m[4] };
      continue;
    }
    if ((m = line.match(/^whenever ~ attacks,? (.*)/))) { fx.attack.push(...parseEffects(m[1])); continue; }
    if ((m = line.match(/^at the beginning of your upkeep,? (.*)/))) { fx.upkeep.push(...parseEffects(m[1])); continue; }
    if ((m = line.match(/^at the beginning of (?:your|each) end step,? (.*)/))) { fx.endstep.push(...parseEffects(m[1])); continue; }
    if ((m = line.match(/^when(?:ever)? ~ dies,? (.*)/))) { fx.dies.push(...parseEffects(m[1])); continue; }
    if (type.planeswalker && (m = line.match(/^([+\-−])?(\d+|x): (.*)/))) {
      const v = m[2] === 'x' ? 0 : +m[2];
      fx.pw.push({ cost: m[1] && m[1] !== '+' ? -v : v, effects: parseEffects(m[3]), text: m[3] });
      continue;
    }
    if ((m = line.match(/^equip (\{[^:]+?\})(?:\s|$)/))) { fx.equip = m[1]; continue; }
    if (type.permanent && (m = line.match(/^(other )?(?:([a-z]+) )?creatures you control(?: of the chosen type)? get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+))?\.?$/))) {
      fx.anthem = { other: !!m[1], tribe: /chosen type/.test(line) ? 'chosen' : m[2] || null, p: +m[3], t: +m[4], kw: kwList(m[5]) };
      continue;
    }
    // "Creatures you control have trample", "other elves you control have haste"
    if (type.permanent && (m = line.match(/^(other )?(?:([a-z]+) )?creatures you control(?: of the chosen type)? have ([\w ,]+?)\.?$/)) && kwList(m[3]).length) {
      fx.anthem = { other: !!m[1], tribe: /chosen type/.test(line) ? 'chosen' : m[2] || null, p: 0, t: 0, kw: kwList(m[3]) };
      continue;
    }
    if (type.permanent && (m = line.match(/^other ([a-z]+)s you control get \+(\d+)\/\+(\d+)(?: and have ([\w ,]+))?\.?$/))) {
      fx.anthem = { other: true, tribe: m[1], p: +m[2], t: +m[3], kw: kwList(m[4]) };
      continue;
    }
    if ((m = line.match(/^(?:enchanted|equipped) creature gets ([+-]\d+)\/([+-]\d+)(?: and has ([\w ,]+))?/))) {
      fx.attachBuff = { p: +m[1], t: +m[2], kw: kwList(m[3]) };
      continue;
    }
    if ((m = line.match(/^(?:enchanted|equipped) creature has ([\w ,]+)/))) { fx.attachBuff = { p: 0, t: 0, kw: kwList(m[1]) }; continue; }
    if (/^enchanted creature can't attack/.test(line)) { fx.pacify = true; continue; }
    if (/^you control enchanted (creature|permanent|artifact|land)/.test(line)) { fx.controlAura = true; continue; }
    // Mana abilities, including ones with a mana cost first (Signets: "{1}, {T}: Add {U}{B}" nets one mana)
    if ((m = line.match(/^(?:\{(\d)\}, )?\{t\}(, sacrifice ~|, pay \d+ life|, tap an untapped creature you control)?: add ([^.]+)/))) {
      if (!fx.mana) {
        const clause = m[3];
        const syms = clause.match(/\{[wubrgc]\}/g) || [];
        // ("add two mana of any one color": Shang-Chi, Gilded Lotus-style)
        const words = clause.match(/^(two|three|four|five) mana (?:of any one color|in any combination of colors|of any color)/);
        const gross = words ? num(words[1]) : /one mana|\bor\b|any/.test(clause) ? 1 : Math.max(1, syms.length);
        fx.mana = { amount: Math.max(1, gross - (+m[1] || 0)), colors: produced.length ? produced : words ? ['W', 'U', 'B', 'R', 'G'] : ['C'], sac: !!m[2]?.includes('sacrifice') };
        // Spending restrictions the engine keeps track of: only creature abilities (Shang-Chi), only creature spells
        if (/spend this mana only to activate abilities of creature/.test(line)) fx.mana.only = 'creatureAbility';
        else if (/spend this mana only to cast (?:a )?creature spells?\.?$/.test(line)) fx.mana.only = 'creatureSpell';
        // Gaea's Cradle, Elvish Archdruid: "Add {G} for each creature (elf) you control"
        const each = clause.match(/for each ([\w -]+?) you control/);
        if (each) fx.mana.dyn = each[1].replace(/s$/, '');
      }
      // (a second mana ability, a pain land's damage or a spending restriction doesn't change what it makes)
      pending = null;
      continue;
    }
    // Reassembling Skeleton, Haakon: "{1}{B}: Return ~ from your graveyard to the battlefield (tapped)"
    if ((m = line.match(/^((?:\{[^}]+\})+)(?:, [^:]+)?: return ~ from your graveyard to (the battlefield|your hand)( tapped)?/))) {
      fx.graveReturn = { cost: m[1].toUpperCase(), to: m[2] === 'your hand' ? 'hand' : 'battlefield', tapped: !!m[3] };
      continue;
    }
    // Hardened Scales, Branching Evolution: more +1/+1 counters
    if ((m = line.match(/^if one or more \+1\/\+1 counters would be put on (?:a creature|a permanent|an artifact or creature) you control, (that many plus one|twice that many)/))) { fx.counterBonus = m[1] === 'that many plus one' ? 'plus' : 'double'; continue; }
    // Activated abilities: "<costs>: <effect>", where every part of the cost is one the engine can pay
    if (type.permanent && (m = line.match(/^([^:"“]+?): (.*)/))) {
      const costs = parseCostText(m[1]);
      if (costs) {
        const effects = parseEffects(m[2]);
        if (effects.length && !effects.some(e => e.k === 'counter'))
          fx.abilities.push({
            cost: costs.mana, tap: costs.tap, effects, text: m[2], sorcery: /activate only as a sorcery/.test(m[2]), costs,
            sacSelf: costs.sacSelf || costs.exileSelf, life: costs.life, discard: costs.discard?.n || 0,
          });
        continue;
      }
    }
    if (type.instant || type.sorcery) {
      const es = parseEffects(line);
      // "Threshold — Add {B}{B}{B}{B}{B} instead if …" upgrades what the line before did
      if (es[0]?.k === 'if' && es[0].instead && !es[0].else && fx.spell.length) es[0].else = fx.spell.splice(0);
      fx.spell.push(...es);
    }
  }
  check();
  applyGate();
  applyBg();
  if (type.land) {
    if (!fx.mana && produced.length) fx.mana = { amount: 1, colors: produced, sac: false };
    if (!produced.length && /search your library for/.test(t)) fx.fetch = true;
  }
  return fx;
}

// How a counted amount reads: 3, X, "your devotion to B", "# creatures you control"
export const amount = n => (n && typeof n === 'object' ? ({ devotion: `devotion to {${n.color}}`, hand: 'cards in hand', maxPower: 'greatest power', maxToughness: 'greatest toughness', sacPower: "the sacrificed creature's power", gy: 'cards in graveyard', trigN: 'that many', trigP: "its power", trigT: "its toughness", trigMV: 'its mana value' }[n.dyn] || `# ${n.what}s you control`) : n);

const EFFECT_TEXT = {
  discard: e => `${e.who} discards ${amount(e.n)}`,
  addMana: e => `add ${e.syms.map(c => (c === '*' ? '{any}' : `{${c}}`)).join('')}`,
  silence: e => `${e.who} can't cast spells this turn`,
  adNauseam: () => 'reveal cards into your hand, paying life',
  copyToken: e => `token copy of target ${e.what}`,
  wipe: e => `${e.mode} all ${e.what}`,
  sweep: e => `${e.n} damage to each creature`,
  counter: e => `counter target ${e.what === 'any' ? '' : e.what + ' '}spell`,
  remove: e => `${e.mode} target ${e.what}`,
  bounce: e => `bounce target ${e.what}`,
  damage: e => `${e.n} damage to ${e.to}`,
  draw: e => `draw ${amount(e.n)}`,
  gain: e => `gain ${amount(e.n)} life`,
  drain: e => `each opponent loses ${amount(e.n)}`,
  loseLife: e => `target player loses ${amount(e.n)}`,
  token: e => `create ${e.n} ${e.p}/${e.t} token${e.n === 1 ? '' : 's'}`,
  treasure: e => `create ${e.n} Treasure`,
  teamPump: e => `team +${e.p}/+${e.t}`,
  pump: e => `target creature +${e.p}/+${e.t}`,
  counters: e => `${e.n} +1/+1 counter(s)`,
  reanimate: e => `reanimate a${e.types?.length ? ` ${e.types.join('/')}` : ' creature'}${e.any ? ' from any graveyard' : ''}`,
  regrow: e => `return ${e.n > 1 ? e.n + ' cards' : 'a card'}${e.types?.length ? ` (${e.types.join('/')})` : ''} from graveyard to hand`,
  edict: e => `${e.all ? 'each player sacrifices' : e.that ? 'that player sacrifices' : 'opponents sacrifice'} ${e.n > 1 ? e.n : 'a'} ${e.nontoken ? 'nontoken ' : ''}${e.what || 'creature'}${e.n > 1 ? 's' : ''}`,
  rampLand: e => `fetch ${e.n} land${e.bf ? ' to battlefield' : ''}`,
  steal: e => `gain control of target ${e.what}${e.temp ? ' until end of turn' : ''}`,
  extraTurn: () => 'take an extra turn',
  extraCombat: () => 'additional combat phase',
  flickerDelay: e => `exile target ${e.what} until the next end step`,
  counterAbility: () => 'counter target ability',
  tutor: e => `tutor ${e.types?.length ? `a ${e.types.join(' or ')} card` : 'any card'}${e.top ? ' to the top' : e.gy ? ' into your graveyard' : ''}`,
  blink: e => `blink ${e.other ? 'another ' : ''}target ${e.what} (exile and return)`,
  copySpell: () => 'copy target spell',
  protect: e => `${e.scope === 'one' ? 'target creature' : e.scope === 'self' ? 'this' : 'your permanents'} gain ${e.kw.join(', ')}`,
  mill: e => `${e.who} mills ${amount(e.n)}`,
  untapAll: e => `untap ${e.n ? `${e.n} of ` : 'all '}your ${e.what}`,
  redirect: () => 'change the target of a spell or ability',
  if: e => `if ${condText(e.cond)}: ${list(e.effects)}${e.else ? ` (otherwise ${list(e.else)})` : ''}`,
  scry: e => `scry ${amount(e.n)}`,
  surveil: e => `surveil ${amount(e.n)}`,
  dig: e => `look at the top ${e.n}, take ${e.take >= 99 ? 'all' : e.take}${e.types.length ? ` ${e.types.join('/')}` : ''}${e.bf ? ' onto the battlefield' : ''}`,
  impulse: e => `exile the top ${e.n} and play ${e.n === 1 ? 'it' : 'them'} ${e.next ? 'until next turn' : 'this turn'}`,
  artifactToken: e => `create ${e.n} ${e.kind[0].toUpperCase() + e.kind.slice(1)}`,
  fight: e => (e.bite ? 'your creature deals damage to target creature' : 'fight target creature'),
  goad: e => (e.all ? 'goad every opposing creature' : 'goad target creature'),
  proliferate: () => 'proliferate',
  populate: () => 'populate',
  monstrous: e => `monstrosity ${amount(e.n)}`,
  adapt: e => `adapt ${e.n}`,
  bolster: e => `bolster ${amount(e.n)}`,
  support: e => `support ${e.n}`,
  connive: () => 'connive',
  explore: () => 'explore',
  cascade: e => (e.discover ? `discover ${e.n}` : 'cascade'),
  regen: e => `regenerate ${e.self ? 'this' : 'target creature'}`,
  tap: e => `tap target ${e.what}`,
  tapAll: e => `tap all opposing ${e.what}`,
  drawEach: e => `each player draws ${amount(e.n)}`,
  discardSelf: e => `discard ${amount(e.n)}`,
  sacOwn: e => `sacrifice a ${e.what}`,
  minus: e => `${amount(e.n)} -1/-1 counter(s) on ${e.on}`,
  shrink: e => `target creature -${e.p}/-${e.t}`,
  shrinkAll: e => `${e.opp ? "opponents' creatures" : 'all creatures'} -${e.p}/-${e.t}`,
  loseSelf: e => `you lose ${amount(e.n)} life`,
  pumpSelf: e => `this gets ${e.p || e.t ? `+${e.p}/+${e.t}` : ''}${e.kw.length ? ` ${e.kw.join(', ')}` : ''} until end of turn`.replace('gets  ', 'gains '),
  bounceOwn: e => `return a ${e.what} you control to hand`,
  addManaN: e => `add ${amount(e.n)} mana of any colors`,
  drawThat: e => `that player draws ${e.n} more`,
  freeCast: e => `cast a ${e.types.join('/') || ''} spell with mana value ${e.maxMv} or less free`.replace('a  spell', 'a spell'),
  namedCounter: e => `${e.kind} counter on this`,
  grantFlashback: e => `${e.all ? 'instants and sorceries in your graveyard gain' : 'an instant or sorcery in your graveyard gains'} flashback this turn`,
  payFor: e => `may pay ${e.cost}: ${list(e.effects)}`,
  modal: e => `choose ${e.n >= 99 ? 'any' : e.n}: ${e.modes.map(list).join(' / ')}`,
  doubleCounters: e => `double the +1/+1 counters on ${e.on}`,
  returnSelfHand: () => 'return it to hand',
  fog: () => 'prevent all combat damage this turn',
  win: () => 'win the game',
  exileSelf: () => 'exile this',
  untapSelf: () => 'untap this',
  evade: e => `${e.self ? 'this' : 'target creature'} can't be blocked this turn`,
  kwCounter: e => `${e.kw} counter on ${e.self ? 'this' : 'target creature'}`,
  topLandOrHand: () => 'reveal the top card: a land goes onto the battlefield, anything else to hand',
  animate: e => `becomes a ${e.p}/${e.t} creature until end of turn`,
  attachSelf: () => 'attach to target creature you control',
  loseThat: e => `that player loses ${amount(e.n)} life`,
  poison: e => `${e.who} gets ${e.n} poison`,
  pact: e => `pay ${e.cost} at your next upkeep or lose the game`,
  extraLand: () => 'play an additional land this turn',
  loseAll: e => `each player loses ${amount(e.n)} life`,
  monarch: () => 'become the monarch',
  fromHand: e => `put a ${e.what} from your hand onto the battlefield`,
  reshuffle: () => 'shuffle your graveyard into your library',
  exileGy: e => (e.all ? 'exile graveyards' : 'exile a card from a graveyard'),
  massReanimate: e => `return all ${e.what} cards from ${e.all ? 'all graveyards' : 'your graveyard'}`,
  germ: e => `create a ${e.p}/${e.t} token and attach this to it`,
  modular: () => 'move its +1/+1 counters to an artifact creature',
  returnSelf: () => 'return it to the battlefield',
};
const list = es => es.map(e => (EFFECT_TEXT[e.k] || (() => e.k))(e)).join(', ');

// How much of a card the simulator understands. Lands count if they make mana; a creature whose
// text is only keywords counts too. Returns null for fully understood cards, else what's missing.
export function ignoredText(card) {
  const fx = card.fx;
  const text = cleanText(card.text, card.frontName || card.name);
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  if (fx.type.land && !fx.mana && !fx.fetch && (fx.unread?.length || !describeFx(fx).length)) return 'land ability';

  // Any line of its text the simulator couldn't read (see analyzeCard)
  if (fx.unread?.length) return `not read: ${fx.unread.map(l => l.length > 70 ? l.slice(0, 68) + '…' : l).join(' / ')}`;
  if (fx.type.land) return null;
  // Keyword-only lines ("flying, vigilance", "flash", "ward {2}") are handled
  const kwLine = l => keywordLine(l, { kw: new Set(), kwN: {}, dies: [], etb: [], abilities: [] })
    || l.split(/,\s*/).every(w => KEYWORDS.some(k => w === k || w.startsWith(k + ' ')) || /^(enchant|equip|protection from|ward|convoke|delve|evoke|flashback|cycling|kicker)\b/.test(w));
  const rest = lines.filter(l => !kwLine(l));
  if (!rest.length) return null;
  return describeFx(fx).length ? null : 'its abilities';
}

// Coverage for a whole deck: share of cards with understood text, and which ones aren't
export function coverage(deck) {
  const all = [...deck.commanders.map(c => ({ card: c, qty: 1 })), ...deck.cards];
  let total = 0, ok = 0;
  const ignored = [];
  for (const { card, qty } of all) {
    if (card.fx.type.basic) continue;
    total += qty;
    if (ignoredText(card)) ignored.push(card.name); else ok += qty;
  }
  return { pct: total ? Math.round((ok / total) * 100) : 100, ignored };
}

export function describeFx(fx) {
  const out = [];
  if (fx.mana) out.push(`mana: ${fx.mana.amount}× {${fx.mana.colors.join('/')}}${fx.mana.sac ? ' (sacrifice)' : ''}${fx.mana.discardHand ? ' (discard your hand)' : ''}${fx.mana.only === 'creatureAbility' ? ' (only for creature abilities)' : fx.mana.only === 'creatureSpell' ? ' (only for creature spells)' : ''}`);
  if (fx.breach) out.push('cards in your graveyard have escape (mana cost + exile three others)');
  if (fx.sacAtEnd) out.push('sacrificed at the end step');
  if (fx.storm) out.push('storm');
  if (fx.onOppSecondDraw) out.push(`when an opponent draws their second card each turn: ${list(fx.onOppSecondDraw)}`);
  if (fx.flashGrant) out.push(`${fx.flashGrant === 'noncreature' ? 'noncreature spells' : 'spells'} as though they had flash`);
  if (fx.lifeCost) out.push(`costs ${fx.lifeCost} life extra`);
  if (fx.fetch) out.push('fetches a land when played');
  if (fx.entersTapped) out.push('enters tapped');
  if (fx.entersCounters) out.push(`enters with ${fx.entersCounters} +1/+1 counters`);
  if (fx.spell.length) out.push(list(fx.spell));
  if (fx.modes) out.push(`choose ${fx.modes.n >= 99 ? 'any' : fx.modes.n}: ${fx.modes.modes.map(list).join(' / ')}`);
  if (fx.etbModes) out.push(`ETB choose ${fx.etbModes.n >= 99 ? 'any' : fx.etbModes.n}: ${fx.etbModes.modes.map(list).join(' / ')}`);
  if (fx.saga) out.push(fx.saga.map((c, i) => `chapter ${i + 1}: ${c?.length ? list(c) : '(not modelled)'}`).join(' · '));
  if (fx.onCast) out.push(`whenever you cast ${fx.onCast.what === 'any' ? 'a' : `${/^[aeiou]/.test(fx.onCast.what) ? 'an' : 'a'} ${fx.onCast.what}`} spell: ${list(fx.onCast.effects)}`);
  if (fx.controlAura) out.push('you control the enchanted permanent');
  if (fx.landfall.length) out.push(`landfall: ${list(fx.landfall)}`);
  if (fx.landfallModes) out.push(`landfall, choose one: ${fx.landfallModes.modes.map(list).join(' / ')}`);
  if (fx.onOppCast) out.push(`whenever an opponent casts a spell: ${list(fx.onOppCast.effects)}${fx.onOppCast.tax ? ` unless they pay {${fx.onOppCast.tax}}` : ''}`);
  if (fx.attackTax) out.push(`attacking you costs {${fx.attackTax}} per creature`);
  if (fx.handOnly) out.push('opponents can only cast spells from their hands');
  if (fx.flashback) out.push(`flashback ${fx.flashback}`);
  if (fx.evoke) out.push(`evoke ${fx.evoke}`);
  if (fx.altFree) out.push(fx.altFree === 'pitch' ? 'free by exiling a card of the same color' : 'free while you control your commander');
  if (fx.handMana) out.push(`exile from hand: add ${fx.handMana.map(c => `{${c}}`).join('')}`);
  if (fx.onOppDraw) out.push(`opponents pay {${fx.onOppDraw.tax}} per draw or you get: ${list(fx.onOppDraw.effects)}`);
  if (fx.combatDamage?.length) out.push(`on combat damage to a player: ${list(fx.combatDamage)}`);
  if (fx.clone) out.push(`enters as a copy of a ${fx.clone}`);
  if (fx.manaAnthem) out.push('your creatures tap for any color');
  if (fx.manaBoost) out.push('nonland mana sources make one extra');
  if (fx.untapOthers) out.push("untaps your permanents on others' turns");
  if (fx.necro) out.push('pay life for extra cards at your end step');
  if (fx.skipDraw) out.push('skip your draw step');
  if (fx.searchHate) out.push("opponents' tutors come up empty");
  if (fx.uncounterable) out.push("can't be countered");
  if (fx.protectsSpells) out.push("your spells can't be countered");
  if (fx.pingCounters) out.push('remove a counter: 1 damage to any target');
  if (fx.altFree === 'storm3') out.push('free after an opponent casts three spells in a turn');
  if (fx.convoke) out.push('convoke');
  if (fx.delve) out.push('delve');
  if (fx.costReduce) out.push(`${fx.costReduce.what === 'any' ? '' : fx.costReduce.what + ' '}spells cost {${fx.costReduce.n}} less`);
  if (fx.kw.has('prowess')) out.push('prowess');
  if (fx.etb.length) out.push(`ETB: ${list(fx.etb)}`);
  if (fx.attack.length) out.push(`on attack: ${list(fx.attack)}`);
  if (fx.upkeep.length) out.push(`upkeep: ${list(fx.upkeep)}`);
  if (fx.endstep.length) out.push(`end step: ${list(fx.endstep)}`);
  if (fx.dies.length) out.push(`dies: ${list(fx.dies)}`);
  if (fx.onDeath) out.push(`whenever ${fx.onDeath.other ? 'another ' : 'a '}creature${{ yours: ' you control', opponents: ' an opponent controls', any: '' }[fx.onDeath.who]} dies: ${list(fx.onDeath.effects)}`);
  if (fx.sacOutlet) out.push(`sacrifice ${fx.sacOutlet.other ? 'another' : 'a'} ${fx.sacOutlet.what}${fx.sacOutlet.cost ? ` (${fx.sacOutlet.cost})` : ''}: ${fx.sacOutlet.effects.length ? list(fx.sacOutlet.effects) : fx.sacOutlet.mana ? 'add mana' : 'other effect'}`);
  if (fx.anthem) out.push(`anthem +${fx.anthem.p}/+${fx.anthem.t}${fx.anthem.tribe ? ` (${fx.anthem.tribe})` : ''}`);
  if (fx.attachBuff) out.push(`attached: ${fx.attachBuff.p >= 0 ? '+' : ''}${fx.attachBuff.p}/${fx.attachBuff.t >= 0 ? '+' : ''}${fx.attachBuff.t}${fx.attachBuff.kw.length ? ' ' + fx.attachBuff.kw.join(', ') : ''}`);
  if (fx.pacify) out.push("enchanted creature can't attack");
  if (fx.equip) out.push(`equip ${fx.equip}`);
  for (const a of fx.abilities) out.push(`ability ${a.costs ? costText(a.costs) : `${a.cost}${a.tap ? '{T}' : ''}`}: ${list(a.effects)}`);
  if (fx.addCost) out.push(`additional cost: ${costText(fx.addCost)}`);
  for (const a of fx.pw) out.push(`[${a.cost > 0 ? '+' : ''}${a.cost}] ${a.effects.length ? list(a.effects) : '(not modelled)'}`);
  for (const k of ['unblockable', 'cantblock']) if (fx.kw.has(k)) out.push(k === 'unblockable' ? "can't be blocked" : "can't block");
  const WATCH_TEXT = {
    block: 'whenever this blocks', blocked: 'whenever this becomes blocked', damaged: 'whenever this is dealt damage', ltb: 'when this leaves the battlefield',
    selfCombat: 'whenever this deals combat damage', targeted: 'whenever this becomes a target', heroic: 'heroic', attachedAttacks: 'whenever the equipped/enchanted creature attacks',
    attachedDamage: 'whenever the equipped/enchanted creature deals combat damage', attachedDies: 'whenever the equipped/enchanted creature dies',
    youAttack: 'whenever you attack', allyAttacks: 'whenever a creature you control attacks', allyCombat: 'whenever your creatures deal combat damage to a player',
    gainLife: 'whenever {who} gain(s) life', loseLife: 'whenever {who} lose(s) life', draw: 'whenever {who} draw(s) a card', sac: 'whenever {who} sacrifice(s) a {what}',
    discard: 'whenever {who} discard(s) a card', tokenMade: 'whenever you create a token', anyCast: 'whenever a player casts a {what} spell',
    upkeep: "at the beginning of {whose} upkeep", begCombat: '{whose} beginning of combat', main1: 'at the beginning of your main phase', drawStep: 'at the beginning of your draw step',
    endStep: "at the beginning of {whose} end step", enter: 'whenever {what} enters',
  };
  const WHO = { you: 'you', opp: 'an opponent', any: 'a player' };
  for (const w of fx.watch || []) {
    const head = (WATCH_TEXT[w.ev] || w.ev).replace('{who}', WHO[w.who] || 'a player').replace('{what}', w.ev === 'enter' ? `${w.other ? 'another ' : 'a '}${w.what}${w.ctl === 'you' ? ' you control' : w.ctl === 'opp' ? ' an opponent controls' : ''}` : w.what || 'card')
      .replace('{whose}', w.whose === 'opp' ? "each opponent's" : w.whose === 'you' ? 'your' : 'each');
    out.push(`${head.replace(/\((s)\)/g, w.who === 'you' ? '' : 's').replace(/\(es\)/g, w.who === 'you' ? '' : 'es')}${w.min ? ` (with ${w.min - 1}+ others)` : ''}: ${list(w.effects)}`);
  }
  if (fx.condBuff) out.push(`while ${condText(fx.condBuff.cond)}: ${fx.condBuff.p || fx.condBuff.t ? `+${fx.condBuff.p}/+${fx.condBuff.t}` : ''}${fx.condBuff.kw.length ? ' ' + fx.condBuff.kw.join(', ') : ''}`);
  if (fx.seeTop) out.push(fx.playTop ? `play ${fx.playTop === 'all' ? 'cards' : fx.playTop === 'land' ? 'lands' : fx.playTop + ' spells'} from the top of your library` : 'look at the top card of your library');
  if (fx.mana?.dyn) out.push(`mana for each ${fx.mana.dyn} you control`);
  const cost = (k, label) => fx[k] && out.push(`${label} ${typeof fx[k] === 'string' ? fx[k] : ''}`.trim());
  cost('kicker', 'kicker'); cost('buyback', 'buyback'); cost('unearth', 'unearth'); cost('embalm', 'embalm'); cost('eternalize', 'eternalize');
  cost('dash', 'dash'); cost('blitz', 'blitz'); cost('spectacle', 'spectacle'); cost('echo', 'echo'); cost('ninjutsu', 'ninjutsu');
  if (fx.cycling) out.push(`${fx.cycling.land ? fx.cycling.land + ' ' : ''}cycling ${fx.cycling.cost}`);
  if (fx.channel) out.push(`channel ${fx.channel.cost}: ${list(fx.channel.effects)}`);
  if (fx.escape) out.push(`escape ${fx.escape.cost}, exile ${fx.escape.n}`);
  if (fx.cumulative) out.push('cumulative upkeep');
  if (fx.borrow) out.push(`has the activated abilities of ${{ creatures: 'your other creatures', artifacts: 'your artifacts', lands: 'your lands', allCreatures: 'all creatures', myGy: 'creature cards in your graveyard', allGy: 'creature cards in all graveyards' }[fx.borrow.from]}`);
  if (fx.noMaxHand) out.push('no maximum hand size');
  if (fx.leyline) out.push('may start the game on the battlefield');
  if (fx.costTax) out.push(`${fx.costTax.what === 'any' ? '' : fx.costTax.what + ' '}spells${fx.costTax.oppOnly ? ' opponents cast' : ''} cost {${fx.costTax.n}} more`);
  if (fx.oppAnthem) out.push(`opponents' creatures get ${fx.oppAnthem.p}/${fx.oppAnthem.t}`);
  if (fx.entersNamed) out.push(`enters with ${fx.entersNamed.n} ${fx.entersNamed.kind} counters`);
  if (fx.spree) out.push(`spree: ${fx.spree.map(s => `+${s.cost} ${list(s.effects)}`).join(' / ')}`);
  if (fx.anthem?.cond) out.push(`(anthem only while ${condText(fx.anthem.cond)})`);
  if (fx.rebound) out.push('rebound (cast again next upkeep)');
  if (fx.allTypes) out.push('every creature type');
  if (fx.gyAnthem) out.push(`from the graveyard, with a ${fx.gyAnthem.land}: your creatures have ${fx.gyAnthem.kw.join(', ')}`);
  if (fx.noExtraTurns) out.push('opponents skip extra turns');
  if (fx.deathTwice) out.push('death triggers happen twice');
  if (fx.auraMana) out.push('enchanted land makes one more mana');
  if (fx.chooses) out.push(`chooses ${fx.chooses} as it enters`);
  if (fx.landsAnyColor) out.push('your lands tap for any color');
  if (fx.oppEnterTapped) out.push(`opponents' ${fx.oppEnterTapped} enter tapped`);
  if (fx.selfReduce) out.push(fx.selfReduce.cond ? `costs {${fx.selfReduce.n}} less if ${condText(fx.selfReduce.cond)}` : `costs {${fx.selfReduce.n}} less per ${fx.selfReduce.each}`);
  if (fx.eachBuff) out.push(`+${fx.eachBuff.p}/+${fx.eachBuff.t} for each ${fx.eachBuff.what}`);
  if (fx.landBoost) out.push(`extra mana when a ${fx.landBoost.what} is tapped for mana`);
  if (fx.labMan) out.push('wins instead of drawing from an empty library');
  if (fx.damageDouble) out.push(`your damage${fx.damageAny ? '' : ' to opponents'} is ${fx.damageDouble === 3 ? 'tripled' : 'doubled'}`);
  if (fx.mustAttack) out.push('attacks each combat if able');
  if (fx.lifeDouble) out.push('life you gain is doubled');
  if (fx.noCastMyTurn) out.push("opponents can't cast spells during your turn");
  if (fx.ascend) out.push("ascend (city's blessing at ten permanents)");
  if (fx.godDevotion) out.push(`not a creature until devotion ${fx.godDevotion.n}`);
  if (fx.imprint) out.push('imprints a card from hand');
  if (fx.extraLands) out.push(`${fx.extraLands >= 9 ? 'any number of' : fx.extraLands} extra land${fx.extraLands === 1 ? '' : 's'} each turn`);
  if (fx.chooseType) out.push('chooses a creature type as it enters');
  if (fx.tokenBonus) out.push(fx.tokenBonus === 'double' ? 'twice as many tokens' : 'one more token');
  if (fx.ptDyn || fx.pDyn) out.push(`${fx.ptDyn ? 'power and toughness' : 'power'} = ${fx.ptDyn || fx.pDyn}`);
  if (fx.tDyn) out.push(`toughness = ${fx.tDyn}`);
  if (fx.castSelf) out.push(`when cast: ${list(fx.castSelf)}`);
  if (fx.graveReturn) out.push(`${fx.graveReturn.cost}: return from your graveyard to ${fx.graveReturn.to === 'hand' ? 'your hand' : 'the battlefield'}`);
  if (fx.counterBonus) out.push(fx.counterBonus === 'plus' ? '+1/+1 counters: one more' : '+1/+1 counters: twice as many');  if (fx.jumpstart) out.push('jump-start');
  if (fx.affinity) out.push('affinity for artifacts');
  if (fx.crew) out.push(`crew ${fx.crew}`);
  if (fx.ward || fx.wardLife) out.push(fx.wardLife ? `ward: ${fx.ward ? `{${fx.ward}} and ` : ''}pay ${fx.wardLife} life` : `ward {${fx.ward}}`);
  if (fx.prot) out.push(`protection from ${fx.prot.join(', ')}`);
  if (fx.landwalk) out.push(`${fx.landwalk}walk`);
  if (fx.splitSecond) out.push('split second');
  if (fx.cascade) out.push('cascade');
  for (const [k, n] of Object.entries(fx.kwN || {})) if (!['afterlife', 'fabricate', 'backup', 'modular', 'crew'].includes(k)) out.push(`${k} ${n}`);
  for (const k of ['fear', 'shadow', 'exalted', 'battle cry', 'flanking', 'melee', 'dethrone', 'training', 'mentor', 'evolve', 'undying', 'persist', 'decayed', 'changeling', 'extort', 'improvise', 'infect', 'wither', 'intimidate', 'skulk', 'horsemanship', 'riot']) if (fx.kw.has(k)) out.push(k);
  // ---- 1.6.0
  for (const [k, f] of Object.entries(FLAG_TEXT)) if (fx[k] != null && fx[k] !== false) out.push(f(fx[k], fx));
  if (fx.mana?.gate || fx.abilities.some(a => a.gate) || fx.watch.some(w => w.gate)) out.push(`some abilities need ${[fx.mana?.gate, ...fx.abilities.map(a => a.gate), ...fx.watch.map(w => w.gate)].filter(Boolean).map(g => `${g.kind} ${g.n}+`).join(', ')}`);
  if (fx.modes?.up || fx.etbModes?.up) out.push(`choose more modes if ${condText((fx.modes || fx.etbModes).up.cond)}`);
  return out;
}
const FLAG_TEXT = {
  trigTwice: v => `${{ enter: `a ${v.what || 'permanent'} entering`, attack: 'attacking', any: 'your creatures', chosen: 'creatures of the chosen type', self: 'it and its equipment' }[v.kind]} trigger${v.kind === 'any' || v.kind === 'chosen' || v.kind === 'self' ? 's' : 's abilities'} an additional time`,
  lifePlus: v => `life you gain: +${v}`, counterAny: () => 'counters on anything you control or yourself too', playerCounterPlus: () => 'counters you get: one more',
  extraToken: (v, fx) => `creating ${fx.extraTokenOn === 'any' ? 'tokens' : fx.extraTokenOn + ' tokens'} also makes a ${v}`, drawDouble: () => 'draws beyond the first each turn are doubled',
  proliferateTwice: () => 'proliferate twice', copyPlus: () => 'copies of spells: one more', lichDraw: () => 'draws become look at three, keep one', abundance: () => 'draws can pick land or nonland',
  lossDouble: () => "opponents lose double life on your turn", burnPlus: v => `noncombat damage to opponents +${v}`, abilityReduce: v => `${v.what === 'any' ? 'non-mana' : v.what} abilities cost {${v.n}} less (at least one mana)`,
  attachReduce: v => `enchanted permanent's abilities cost {${v}} less (at least one mana)`, minusLess: () => 'one fewer -1/-1 counter on your creatures',
  copyAbility: () => 'pay {2} to copy non-mana abilities you activate',
  abilityLock: v => `activated abilities of ${v.opp ? "opponents' " : ''}${v.what} can't be activated`, attachBuff2: v => `attached ${v.needs} creature: +${v.p}/+${v.t} ${v.kw.join(', ')}`.trim(),
  teamRiot: () => 'your nontoken creatures have riot', permAnthem: v => `${v.other ? 'other ' : ''}permanents you control have ${v.kw.join(', ')}`, smallEvasion: v => `your creatures with power ${v.n} or less can't be blocked`,
  counterEvasion: () => "your creatures with +1/+1 counters can't be blocked", noAttack: () => "your creatures can't attack", bullyEvasion: () => "smaller creatures can't block yours",
  landsUntapped: () => 'your lands enter untapped', extraLandsAll: () => 'each player may play an extra land', noUntap: () => "doesn't untap in your untap step", teamCounter: () => 'your other creatures enter with an extra +1/+1 counter',
  attackCap: () => 'only one creature can attack each combat', needsBlessing: () => "can't attack or block without the city's blessing",
  protectAttackers: () => 'damage to your attacking creatures is prevented', attachSet: v => `enchanted creature becomes a ${v.p}/${v.t} with no abilities`, stationN: v => `a creature at ${v}+ charge counters`,
  station: () => 'station (tap another creature: charge counters equal to its power)', dredge: v => `dredge ${v}`, hideaway: v => `hideaway ${v} (the hidden card goes to your hand)`, overload: v => `overload ${v}`, umbra: () => 'umbra armor',
  gift: v => `gift a ${v} (not promised)`, speed: () => 'start your engines (speed rises when opponents lose life on your turn)',
  allLandsAdd: v => `every land also taps for {${v}}`, chargeKick: () => 'a charge counter if kicked', treasureTwo: () => 'your Treasures make two mana', oppGyExile: () => "opponents' cards go to exile instead of the graveyard",
  untapSelfOthers: () => "untaps during other players' untap steps", freeEquip: v => `equip {0}${v ? ` with ${v}+ artifacts` : ''}`, gyCastSelf: v => `can be cast from your graveyard${v.exile ? ' or exile' : ''}${v.cond ? ` while ${condText(v.cond)}` : ''}`,
  altLife: v => `may pay ${v.n} life instead of its mana cost${v.cond ? ` if ${condText(v.cond)}` : ''}`, attackTaxDyn: v => `attacking you costs {1} per ${v} its owner controls`, escalate: () => 'escalate (one mode here)',
  landsAnyColorN: v => `(only with ${v}+ lands)`, hasteAbilities: () => 'your creatures can use {T} abilities right away', shuffleOnGy: () => 'shuffled into the library instead of going to the graveyard',
  drawCap: () => "opponents can't draw more than one card each turn", damagePlus: v => `${v.color ? `{${v.color}} ` : ''}damage to opponents +${v.n}`, halveDamage: () => 'damage to you and yours is halved',
  oppSorcery: () => 'opponents cast spells only at sorcery speed', hexPlayer: () => 'you have hexproof', notionThief: () => "opponents' extra draws become yours",
  tokenBonusAll: () => 'every player makes twice as many tokens', counterBonusAll: () => '+1/+1 counters on any creature are doubled', anyColorSpend: () => 'mana can be spent as any color',
  attackCond: v => `attacks or blocks only while ${condText(v)}`, attackMeCap: v => `only ${v.n} creature${v.n > 1 ? 's' : ''} can attack you each combat${v.tapped ? ' (while tapped)' : ''}`,
  hasteAll: () => 'all creatures have haste', altMana: v => `may cast for ${v} instead`,
  bloodMoon: () => 'nonbasic lands tap only for {R}', costReduceAll: v => `every spell costs {${v}} less`, cantLose: () => "you can't lose and opponents can't win", creatureDamageOnly: () => '(only damage from your creatures)',
  attachMana: () => 'equipped creature taps for any color', tokenAngel: () => 'your creature tokens are 4/4 flying Angels instead',
  manaMult: v => `mana from permanents ×${v}`, noEtbOpp: () => "permanents entering don't trigger opponents' abilities", noLegendRule: () => "the legend rule doesn't apply to you", improviseAll: () => 'your spells have improvise',
  // 1.7.0
  wardGrant: v => `${v.other ? 'other ' : ''}${v.what}s you control${v.counters ? ' with counters' : ''} have ward ${v.n ? `{${v.n}}` : ''}${v.life ? `pay ${v.life} life` : ''}`,
  noGain: v => (v === 'opp' ? "opponents can't gain life" : "players can't gain life"), spellCap: v => `each player can cast only one ${v === 'any' ? '' : v + ' '}spell each turn`,
  noCounterAll: () => "spells can't be countered", noPrevent: () => "damage can't be prevented", preventMe: () => 'damage to you is prevented',
  untapLock: v => (v.what === 'creature' ? `creatures${v.minPower ? ` with power ${v.minPower}+` : ''} don't untap` : `players untap only one ${v.nonbasic ? 'nonbasic ' : ''}land${v.whileUntapped ? ' (while this is untapped)' : ''}`),
  noMaxHandAll: () => 'no maximum hand size', oppHandLess: v => `opponents' maximum hand size −${v}`, keepRed: () => 'red mana stays in your pool between steps',
  altSac: v => `may sacrifice a ${v} instead of its mana cost`, altPitch: v => `may exile ${v.n} {${v.color}} cards from hand instead of its mana cost`, altBounce: v => `may return a ${v} you control instead of its mana cost`,
  evokePitch: v => `evoke by exiling a {${v}} card from your hand`,
  suspend: v => `suspend ${v.n} for ${v.cost}`, miracle: v => `miracle ${v} (on the turn it's your first draw)`, entwine: v => `entwine ${v}`, exploit: () => 'exploit',
  exploitFx: () => 'when it exploits: more', castWhen: v => ({ myCombat: 'cast only during combat on your turn', oppCombat: "cast only during combat on an opponent's turn", preDamage: 'cast only before combat damage' }[v]),
  freeCounter: v => `${v === 'opp' ? "opponents'" : 'all'} spells cast without mana are countered`, gyLock: v => `${v.what} cards in graveyards${v.lib ? ' and libraries' : ''} can't enter the battlefield`,
  rip: () => 'cards going to a graveyard are exiled instead', oppDieExile: v => `opponents' ${v.nontoken ? 'nontoken ' : ''}creatures are exiled instead of dying${v.gain ? ` (you gain ${v.gain})` : ''}`,
  oppLoseKw: v => `opponents' creatures lose ${v}`, damageDoubleAll: () => 'all damage is doubled', millMore: v => (v.double ? 'opponents mill twice as much' : `opponents mill ${v.plus} more`),
  blockFlyersOnly: () => 'can block only flyers', godEternal: () => 'goes third from the top of its library when it dies or is exiled',
  // 1.17.0
  combatKill: () => 'destroys creatures it deals combat damage to', strive: () => 'strive (the simulator takes one target)', cascadeGrant: v => `your spells with mana value ${v.minMv}+ have cascade`,
  convokeGrant: v => `${v === 'creature' ? 'creature spells' : 'spells cast from exile'} have convoke`, burnDouble: () => 'noncombat damage to opponents is doubled',
  gyCastOnce: v => `once each turn, cast ${v.types.length > 2 ? 'a permanent' : 'an instant or sorcery'} spell${v.maxMv != null ? ` with mana value ${v.maxMv} or less` : ''} from your graveyard`,
  gyFlashbackAll: () => 'instants and sorceries in your graveyard have flashback',
  counterHalfOpp: () => 'opponents put half as many counters', searchTop4: () => 'opponents search only the top four cards', manaMultBasic: () => '(basic lands only)', damageChosen: () => '(the chosen type only)',
  damageCounters: () => '(creatures with +1/+1 counters only)', untapOthersCond: v => `(only with ${v.n}+ ${v.kind} counters)`, fogBank: () => 'deals and takes no combat damage', noFlyAttack: () => "flyers can't attack you",
  goadNoBlock: () => "goaded opposing creatures can't block", attackTrample: () => 'creatures attacking your opponents have trample',
  landCap: () => "opponents can't cast noncreature spells costing more than their land count", auraFix: () => 'enchanted land taps for any color', blockCap: () => 'only one creature can block each combat',
  castCond: v => `castable only if ${condText(v)}`, freeTribe: v => `${v} creature spells are free`, altManaCond: v => `(only if ${condText(v)})`, escapeCounters: v => `escapes with ${v} +1/+1 counters`,
  foretell: v => `foretell ${v}`, plot: v => `plot ${v}`, encore: v => `encore ${v}`, impending: v => `impending ${v.n} for ${v.cost}`, playTopAttached: () => '(only while attached)', playTopCond: v => `(only while ${condText(v)})`,
};
Object.assign(EFFECT_TEXT, {
  doublePT: e => (e.all ? "double your creatures' power and toughness" : "double target creature's power"), pumpTrig: e => `that creature gets +${e.p}/+${e.t}${e.kw.length ? ' and ' + e.kw.join(', ') : ''}`,
  copyTrig: () => 'copy that spell', shieldSelf: () => 'you gain protection from everything until your next turn', ring: () => 'the Ring tempts you', playerCounter: e => `you get ${e.n} ${e.kind} counter${e.n === 1 ? '' : 's'}`,
  pumpAttached: e => `enchanted creature gets +${e.p}/+${e.t}${e.kw.length ? ' and ' + e.kw.join(', ') : ''}`, uncounterNext: () => "your next spell this turn can't be countered", bottomSelf: () => 'put it on the bottom of the library',
  returnTrig: () => 'return that card to the battlefield', transform: () => 'transform', bounceAll: e => `return all ${e.what} creatures to hand`, roll: e => `roll a d${e.d}${e.table?.length ? ` (${e.table.length} results)` : ''}`,
  flashTurn: () => 'cast spells as though they had flash this turn', gyCastTurn: e => `cast ${e.types.join('/') || ''} spells from your graveyard this turn`.replace('cast  spells', 'cast spells'), stealAll: e => `gain control of that player's ${e.what}s`,
  level: e => `class level ${e.n}`, station: () => 'station',
  // 1.7.0
  preventMe: () => 'prevent all damage to you this turn', millHalf: e => `${e.who} mills half their library`, doubleLife: () => "double a player's life total",
  shuffleSelf: () => 'shuffle it into its library', loseHalf: () => 'that player loses half their life', bounceOpp: () => "return all of a player's nonland permanents to hand",
  nonbasicBurn: e => `damage to each player equal to ${e.times === 2 ? 'twice ' : ''}their nonbasic lands`,
  extraTurn: e => `take ${e.n === 2 ? 'two extra turns' : 'an extra turn'}`, extraLand: e => `play ${e.n > 1 ? `${e.n} additional lands` : 'an additional land'} this turn`,
  sacUnlessPay: e => `sacrifice it unless you pay {${e.n}}`, sacUnlessTap: () => 'sacrifice it unless you tap a permanent', noBlock: e => `target creature can't ${e.attack ? 'attack or ' : ''}block this turn`,
  keepOne: e => `${e.who === 'each' ? 'each player' : 'that player'} keeps ${e.n} creature${e.n > 1 ? 's' : ''} and sacrifices the rest`, gyExileTurn: () => 'your cards going to the graveyard this turn are exiled',
  exploit: () => 'exploit (may sacrifice a creature)',
  // 1.17.0
  deadbridge: () => 'a random card from your graveyard: a creature onto the battlefield, anything else to hand', hermit: () => 'reveal until a basic land: it goes to hand, the rest to the graveyard',
  bribery: () => "put a creature from an opponent's library onto the battlefield under your control", peer: () => 'draw half your library and lose half your life',
  moveEquip: () => 'attach an equipment you control to a creature you control', tapAttached: () => 'tap the enchanted creature', doublePool: () => 'double your unspent mana',
  halfLifeDamage: () => 'damage to each player equal to half their life', lostAgain: () => 'each opponent loses the life they lost this turn again',
  copyAbility: () => 'copy a triggered or activated ability you control', grasp: () => "exile a card from an opponent's library; you may play it",
  sacUnlessEscaped: () => "sacrifice it unless it escaped", gyFreeCast: e => `cast a${e.types[0] === 'instant' ? 'n instant' : ''} card from your graveyard for free`, castCommanderFree: () => 'cast your commander free',
  reanimateTrig: () => 'put that card onto the battlefield under your control',
  becomeCopy: e => `becomes a copy of a ${e.what}${e.gy ? ' card in your graveyard' : ''}${e.eot ? ' until end of turn' : ''}`, grantRebound: () => 'that spell gains rebound',
  returnTrigHand: e => `return that card to hand${e.later ? ' at the next end step' : ''}${e.unlessLife ? ` unless an opponent pays ${e.unlessLife} life` : ''}`,
  teamBase: e => `${e.what ? e.what + 's' : 'creatures'} you control have base power and toughness ${amount(e.p)}/${amount(e.t)} until end of turn`, animateAll: e => `your noncreature artifacts become ${e.p}/${e.t} creatures until end of turn`, devour: e => `devour ${e.n}`,


});

